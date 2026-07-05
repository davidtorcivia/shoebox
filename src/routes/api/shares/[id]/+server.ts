import { requireRole } from '$lib/server/roles';
import { revokeShare } from '$lib/server/shares';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'editor');
	await revokeShare(locals.db, params.id);
	return new Response(null, { status: 204 });
};
