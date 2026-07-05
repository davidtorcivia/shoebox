import { json } from '@sveltejs/kit';
import { parseFaceBox, requireFacesAdmin } from '$lib/server/admin-faces';
import { updateFaceBox } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = await request.json().catch(() => null);
	await updateFaceBox(locals.db, params.faceId, parseFaceBox(body));
	return json({ ok: true });
};
