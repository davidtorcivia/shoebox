import { json } from '@sveltejs/kit';
import { updateFaceBox } from '$lib/server/faces';
import { parseFaceBox, requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	requireFaces(locals.platform);
	await updateFaceBox(
		locals.db,
		params.faceId,
		parseFaceBox(await request.json().catch(() => null))
	);
	return json({ ok: true });
};
