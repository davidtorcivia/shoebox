import { error, redirect } from '@sveltejs/kit';
import { parseRange } from '$lib/server/http-range';
import { canAccessMedia } from '$lib/server/media-access';
import type { RequestHandler } from './$types';

/**
 * Media is served from the app origin, so the declared content-type must never
 * be something a browser would execute (HTML/JS/SVG). Storage content-type can
 * be attacker-influenced (e.g. R2 httpMetadata set at upload); clamp anything
 * that is not a raster image or video to a download-only octet-stream. With
 * `X-Content-Type-Options: nosniff` this blocks stored XSS via uploaded files.
 */
function safeContentType(contentType: string): string {
	const lower = (contentType ?? '').toLowerCase();
	if (lower.startsWith('image/svg')) return 'application/octet-stream';
	if (lower.startsWith('image/') || lower.startsWith('video/')) return contentType;
	return 'application/octet-stream';
}

export const GET: RequestHandler = async ({ locals, params, request, url: requestUrl }) => {
	const key = params.key;
	if (!(await canAccessMedia(locals, key))) throw error(403, 'Media not allowed');

	const url = await locals.platform.storage.mediaUrl(key);
	if (/^https?:\/\//.test(url)) throw redirect(302, url);

	const head = await locals.platform.storage.head(key);
	if (!head) throw error(404, 'media not found');

	const range = parseRange(request.headers.get('range'), head.size);
	const got = await locals.platform.storage.get(key, range ?? undefined);
	if (!got) throw error(404, 'media not found');

	// Versioned URLs (?v=<content hash>) may cache forever — the URL changes when
	// the bytes do (media replacement, new poster frame). Unversioned requests
	// must revalidate: media CAN change under a stable key, and heuristic caching
	// was replaying old audio after an in-place replacement.
	const cacheControl = requestUrl.searchParams.has('v')
		? 'private, max-age=31536000, immutable'
		: 'private, no-cache';

	const headers = new Headers({
		'accept-ranges': 'bytes',
		'cache-control': cacheControl,
		'content-type': safeContentType(got.contentType),
		'content-length': String(range ? range.end - range.start + 1 : head.size),
		'x-content-type-options': 'nosniff'
	});
	if (range) {
		headers.set('content-range', `bytes ${range.start}-${range.end}/${head.size}`);
	}

	return new Response(got.stream, { status: range ? 206 : 200, headers });
};
