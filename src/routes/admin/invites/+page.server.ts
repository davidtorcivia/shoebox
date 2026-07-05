import { listInvites } from '$lib/server/invites';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	return { invites: await listInvites(locals.db) };
};
