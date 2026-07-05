import { error, json } from '@sveltejs/kit';
import { createAlbum, listAlbums } from '$lib/server/albums';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	return json({ albums: await listAlbums(locals.db, locals.platform.storage) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.title !== 'string' || !body.title.trim()) {
		error(400, 'title is required');
	}
	const album = await createAlbum(locals.db, user, {
		title: body.title,
		description: typeof body.description === 'string' ? body.description : null
	});
	return json({ album }, { status: 201 });
};
