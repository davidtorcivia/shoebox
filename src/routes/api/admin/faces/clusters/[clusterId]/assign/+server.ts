import { error, json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { assignCluster } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireFacesAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.personId !== 'string' || !body.personId) {
		error(400, 'personId is required');
	}
	await assignCluster(locals.db, params.clusterId, body.personId);
	return json({ ok: true });
};
