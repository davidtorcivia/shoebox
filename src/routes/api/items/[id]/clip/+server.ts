import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { itemFiles, items } from '$lib/server/db/schema';
import { canAccessItem } from '$lib/server/media-access';
import { clipStem, validateClip, type ClipFormat } from '$lib/domain/clip';
import type { RequestHandler } from './$types';

// Extract a [start,end] segment of a video as an MP4 or GIF and stream it back as
// a download. Runs ffmpeg inline (node-only); short caps keep the response fast.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const id = params.id;

	// Logged-in users always; otherwise a share viewer whose share covers this item
	// and permits downloads.
	if (!locals.user) {
		const ok = await canAccessItem(locals, id, { requireDownload: true });
		if (!ok) error(403, 'Not allowed');
	}

	const formatRaw = url.searchParams.get('format') ?? 'mp4';
	if (formatRaw !== 'mp4' && formatRaw !== 'gif') {
		error(400, 'format must be mp4 or gif');
	}
	const format: ClipFormat = formatRaw;
	const start = Number(url.searchParams.get('start'));
	const end = Number(url.searchParams.get('end'));

	const item = (
		await locals.db
			.select({ id: items.id, type: items.type, title: items.title, duration: items.duration })
			.from(items)
			.where(and(eq(items.id, id), isNull(items.deletedAt)))
			.limit(1)
	)[0];
	if (!item) error(404, 'Not found');
	if (item.type !== 'video') error(400, 'Clips are only available for videos');

	const valid = validateClip(start, end, item.duration, format);
	if (!valid.ok) error(400, valid.error ?? 'Invalid selection');

	// Prefer the progressive playback file (already H.264, ≤1920, faststart) as the
	// source — smaller and faster to re-encode than a large original.
	const files = await locals.db
		.select({ kind: itemFiles.kind, storageKey: itemFiles.storageKey })
		.from(itemFiles)
		.where(eq(itemFiles.itemId, id));
	const sourceKey =
		files.find((f) => f.kind === 'playback')?.storageKey ??
		files.find((f) => f.kind === 'original')?.storageKey;
	if (!sourceKey) error(409, 'This video has no downloadable source yet');

	const mediaPath = process.env.MEDIA_PATH ?? './data/media';
	let rendered;
	try {
		const { renderClip } = await import('$lib/server/media/clip');
		rendered = await renderClip({
			mediaPath,
			sourceKey,
			start: valid.start,
			end: valid.end,
			format
		});
	} catch (err) {
		if (err instanceof Error && err.message.includes('ffmpeg binary unavailable')) {
			error(501, 'Clip export is not available on this server');
		}
		console.error('clip render failed', err);
		error(500, 'Could not render clip');
	}

	const filename = `${clipStem(item.title, valid.start, valid.end)}.${rendered.ext}`;
	return new Response(rendered.data as unknown as BodyInit, {
		headers: {
			'content-type': rendered.contentType,
			'content-length': String(rendered.data.byteLength),
			'content-disposition': `attachment; filename="${filename}"`,
			'cache-control': 'private, max-age=0, no-store'
		}
	});
};
