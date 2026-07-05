import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	if (!locals.platform.features.serverDerivatives) {
		return json({ reason: 'export requires the Docker deployment' }, { status: 501 });
	}
	const { exportAlbumZip } = await import('$lib/server/platform/node-export');
	return exportAlbumZip(locals.db, locals.platform.storage, params.id);
};
