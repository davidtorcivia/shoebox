import { redirect } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	redirect(302, '/admin/users');
};
