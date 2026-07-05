import { json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { rejectCluster } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	requireFacesAdmin(locals);
	await rejectCluster(locals.db, params.clusterId);
	return json({ ok: true });
};
