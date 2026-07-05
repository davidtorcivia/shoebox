import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { initUpload, type InitUploadInput } from '$lib/server/upload';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const body = (await request.json()) as InitUploadInput;
	return json(await initUpload(locals.db, locals.platform.storage, user.id, body));
};

