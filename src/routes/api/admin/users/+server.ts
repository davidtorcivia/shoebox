import { json } from '@sveltejs/kit';
import { listUsers } from '$lib/server/admin-users';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	return json({ users: await listUsers(locals.db) });
};
