import { json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { rejectFace } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	requireFacesAdmin(locals);
	await rejectFace(locals.db, params.faceId);
	return json({ ok: true });
};
