import { error, json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { splitCluster } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const faceIds = body?.faceIds;
	if (!Array.isArray(faceIds) || !faceIds.every((id) => typeof id === 'string')) {
		error(400, 'faceIds is required');
	}
	const clusterId = await splitCluster(locals.db, params.clusterId, faceIds);
	return json({ clusterId });
};
