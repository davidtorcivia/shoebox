import { error, json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { assignCluster, assignFaces } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.personId !== 'string' || !body.personId) {
		error(400, 'personId is required');
	}
	// Prefer the explicit face ids the admin was shown: they're stable even when
	// the worker reclusters (and renames cluster ids) between load and click.
	const faceIds = body.faceIds;
	if (Array.isArray(faceIds) && faceIds.every((id) => typeof id === 'string')) {
		await assignFaces(locals.db, faceIds as string[], body.personId);
	} else {
		await assignCluster(locals.db, params.clusterId, body.personId);
	}
	return json({ ok: true });
};
