import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { saveChunk } from '$lib/server/upload';
import type { RequestHandler } from './$types';

async function handleChunk({ locals, request, url }: Parameters<RequestHandler>[0]) {
	requireRole(locals, 'uploader');
	const uploadId = url.searchParams.get('uploadId') ?? '';
	const indexParam = url.searchParams.get('index');
	const index = Number(indexParam);
	if (indexParam === null || !Number.isInteger(index) || index < 0) {
		return json({ message: 'invalid index' }, { status: 400 });
	}
	const data = new Uint8Array(await request.arrayBuffer());
	return json(await saveChunk(locals.platform.storage, uploadId, index, data));
}

export const POST: RequestHandler = handleChunk;
export const PUT: RequestHandler = handleChunk;
