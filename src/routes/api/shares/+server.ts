import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { albums, itemFiles, items } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import { createShare, listShares, setShareClip } from '$lib/server/shares';
import type { RequestHandler } from './$types';

/**
 * Pre-cut the shared segment so a segment-share viewer only ever receives the
 * clip, never the full video. Best-effort: needs ffmpeg (node), so on a runtime
 * without it the share still works, bounded client-side. Returns the clip key.
 */
async function renderShareClip(
	locals: App.Locals,
	shareId: string,
	itemId: string,
	start: number,
	end: number
): Promise<string | null> {
	const item = (
		await locals.db
			.select({ duration: items.duration, type: items.type })
			.from(items)
			.where(eq(items.id, itemId))
			.limit(1)
	)[0];
	if (!item || item.type !== 'video') return null;

	const limit = item.duration && item.duration > 0 ? item.duration : end;
	const s = Math.max(0, Math.min(start, limit));
	const e = Math.max(0, Math.min(end, limit));
	if (e - s < 0.2) return null;

	const files = await locals.db
		.select({ kind: itemFiles.kind, storageKey: itemFiles.storageKey })
		.from(itemFiles)
		.where(eq(itemFiles.itemId, itemId));
	const sourceKey =
		files.find((f) => f.kind === 'playback')?.storageKey ??
		files.find((f) => f.kind === 'original')?.storageKey;
	if (!sourceKey) return null;

	const mediaPath = process.env.MEDIA_PATH ?? './data/media';
	const { renderClip } = await import('$lib/server/media/clip');
	const rendered = await renderClip({ mediaPath, sourceKey, start: s, end: e, format: 'mp4' });
	const clipKey = `media/${itemId}/shareclips/${shareId}.mp4`;
	await locals.platform.storage.put(clipKey, rendered.data, { contentType: 'video/mp4' });
	await setShareClip(locals.db, shareId, clipKey);
	return clipKey;
}

type ShareTarget = 'album' | 'item' | 'favorites';

function expiresAtFrom(expiry: string | undefined | null): Date | null {
	if (!expiry || expiry === 'never') return null;
	if (expiry === '7d') return new Date(Date.now() + 7 * 86_400_000);
	if (expiry === '30d') return new Date(Date.now() + 30 * 86_400_000);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
		error(400, 'expiry must be never, 7d, 30d, or YYYY-MM-DD');
	}
	const date = new Date(`${expiry}T23:59:59Z`);
	if (Number.isNaN(date.getTime())) error(400, 'Invalid expiry date');
	return date;
}

async function assertTargetExists(
	db: Db,
	targetType: ShareTarget,
	targetId: string
): Promise<void> {
	const found =
		targetType === 'album'
			? await db
					.select({ id: albums.id })
					.from(albums)
					.where(and(eq(albums.id, targetId), isNull(albums.deletedAt)))
					.limit(1)
			: await db
					.select({ id: items.id })
					.from(items)
					.where(and(eq(items.id, targetId), isNull(items.deletedAt)))
					.limit(1);
	if (found.length === 0) error(404, 'Share target not found');
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const targetType = url.searchParams.get('targetType');
	// Anyone may manage shares of their OWN saved collection; album/item shares
	// remain editor-only. A favorites listing is always scoped to the caller.
	if (targetType === 'favorites') {
		const user = requireRole(locals, 'user');
		return json({
			shares: await listShares(locals.db, { targetType: 'favorites', targetId: user.id })
		});
	}
	requireRole(locals, 'editor');
	const targetId = url.searchParams.get('targetId');
	const target: { targetType: ShareTarget; targetId: string } | undefined =
		(targetType === 'album' || targetType === 'item') && targetId
			? { targetType, targetId }
			: undefined;
	return json({ shares: await listShares(locals.db, target) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await request.json().catch(() => null)) as {
		targetType?: unknown;
		targetId?: unknown;
		password?: unknown;
		expiry?: unknown;
		allowDownload?: unknown;
		segmentStart?: unknown;
		segmentEnd?: unknown;
	} | null;

	if (
		body?.targetType !== 'album' &&
		body?.targetType !== 'item' &&
		body?.targetType !== 'favorites'
	) {
		error(400, 'targetType (album|item|favorites) and targetId are required');
	}
	if (body.expiry !== undefined && body.expiry !== null && typeof body.expiry !== 'string') {
		error(400, 'expiry must be a string');
	}

	// A saved-collection share is always the caller's own and needs no elevated
	// role; its target is the user id, so a link can never expose someone else's
	// saves. Album/item shares stay editor-gated and must point at a real row.
	let user;
	let targetId: string;
	if (body.targetType === 'favorites') {
		user = requireRole(locals, 'user');
		targetId = user.id;
	} else {
		user = requireRole(locals, 'editor');
		if (typeof body.targetId !== 'string' || body.targetId.length === 0) {
			error(400, 'targetId is required');
		}
		await assertTargetExists(locals.db, body.targetType, body.targetId);
		targetId = body.targetId;
	}

	const password = typeof body.password === 'string' && body.password.trim() ? body.password : null;

	// An optional video segment [start,end] (seconds) is only meaningful on an item
	// share; both bounds must be finite, ordered, and non-negative.
	let segmentStart: number | null = null;
	let segmentEnd: number | null = null;
	if (body.segmentStart != null || body.segmentEnd != null) {
		if (body.targetType !== 'item') error(400, 'segments are only valid on item shares');
		const s = Number(body.segmentStart);
		const e = Number(body.segmentEnd);
		if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
			error(400, 'segmentStart and segmentEnd must be 0 <= start < end');
		}
		segmentStart = s;
		segmentEnd = e;
	}

	const share = await createShare(locals.db, {
		targetType: body.targetType,
		targetId,
		password,
		expiresAt: expiresAtFrom(body.expiry),
		allowDownload: body.allowDownload === true,
		segmentStart,
		segmentEnd,
		createdBy: user.id
	});

	if (segmentStart != null && segmentEnd != null) {
		try {
			const clipKey = await renderShareClip(locals, share.id, targetId, segmentStart, segmentEnd);
			if (clipKey) share.clipKey = clipKey;
		} catch (err) {
			console.error('share clip render failed', err);
		}
	}

	return json({ share, url: `/share/${share.token}` }, { status: 201 });
};
