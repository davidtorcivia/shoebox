import { error, json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { assignFaces } from '$lib/server/faces';
import type { RequestHandler } from './$types';

// Assign a single face to a person — the path for unmatched (noise) faces that
// have no cluster to act through.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.personId !== 'string' || !body.personId) {
		error(400, 'personId is required');
	}
	await assignFaces(locals.db, [params.faceId], body.personId);
	return json({ ok: true });
};
