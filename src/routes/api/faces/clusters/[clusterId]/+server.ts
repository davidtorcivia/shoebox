import { error, json } from '@sveltejs/kit';
import { assignCluster, rejectCluster, splitCluster } from '$lib/server/faces';
import { requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	requireFaces(locals.platform);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.action !== 'string') error(400, 'action is required');

	if (body.action === 'assign') {
		if (typeof body.personId !== 'string' || !body.personId) error(400, 'personId is required');
		await assignCluster(locals.db, params.clusterId, body.personId);
		return json({ ok: true });
	}
	if (body.action === 'reject') {
		await rejectCluster(locals.db, params.clusterId);
		return json({ ok: true });
	}
	if (body.action === 'not-same') {
		const faceIds = body.faceIds;
		if (!Array.isArray(faceIds) || !faceIds.every((id) => typeof id === 'string')) {
			error(400, 'faceIds is required');
		}
		return json({ clusterId: await splitCluster(locals.db, faceIds) });
	}

	error(400, 'unknown action');
};
