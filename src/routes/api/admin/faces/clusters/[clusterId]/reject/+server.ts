import { json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { rejectCluster, rejectFaces } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	// Operate on the stable face ids the admin was shown when available, so a
	// background recluster renaming the cluster id can't 404 the reject.
	const faceIds = body?.faceIds;
	if (Array.isArray(faceIds) && faceIds.every((id) => typeof id === 'string')) {
		await rejectFaces(locals.db, faceIds as string[]);
	} else {
		await rejectCluster(locals.db, params.clusterId);
	}
	return json({ ok: true });
};
