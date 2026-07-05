import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { saveChunk } from '$lib/server/upload';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ locals, request, url }) => {
	requireRole(locals, 'uploader');
	const uploadId = url.searchParams.get('uploadId') ?? '';
	const index = Number(url.searchParams.get('index'));
	const data = new Uint8Array(await request.arrayBuffer());
	return json(await saveChunk(locals.platform.storage, uploadId, index, data));
};
