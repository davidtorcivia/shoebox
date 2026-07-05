import { error, redirect } from '@sveltejs/kit';
import { parseRange } from '$lib/server/http-range';
import { canAccessMedia } from '$lib/server/media-access';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const key = params.key;
	if (!(await canAccessMedia(locals, key))) throw error(403, 'Media not allowed');

	if (locals.platform.name === 'cloudflare') {
		throw redirect(302, await locals.platform.storage.mediaUrl(key));
	}

	const head = await locals.platform.storage.head(key);
	if (!head) throw error(404, 'media not found');

	const range = parseRange(request.headers.get('range'), head.size);
	const got = await locals.platform.storage.get(key, range ?? undefined);
	if (!got) throw error(404, 'media not found');

	const headers = new Headers({
		'accept-ranges': 'bytes',
		'content-type': got.contentType,
		'content-length': String(range ? range.end - range.start + 1 : head.size)
	});
	if (range) {
		headers.set('content-range', `bytes ${range.start}-${range.end}/${head.size}`);
	}

	return new Response(got.stream, { status: range ? 206 : 200, headers });
};
