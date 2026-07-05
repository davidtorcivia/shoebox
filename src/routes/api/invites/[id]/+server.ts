import { revokeInvite } from '$lib/server/invites';
import { requireRole } from '$lib/server/roles';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'admin');
	await revokeInvite(locals.db, params.id);
	return json({ ok: true });
};
