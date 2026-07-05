import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { saveChunk } from '$lib/server/upload';
import type { RequestHandler } from './$types';

async function handleChunk({ locals, request, url }: Parameters<RequestHandler>[0]) {
	requireRole(locals, 'uploader');
	const uploadId = url.searchParams.get('uploadId') ?? '';
	const index = Number(url.searchParams.get('index'));
	const data = new Uint8Array(await request.arrayBuffer());
	return json(await saveChunk(locals.platform.storage, uploadId, index, data));
}

export const POST: RequestHandler = handleChunk;
export const PUT: RequestHandler = handleChunk;
