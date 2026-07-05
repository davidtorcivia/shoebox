import { redirect } from '@sveltejs/kit';
import { listPeople } from '$lib/server/people';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		people: await listPeople(locals.db, locals.platform.storage),
		canCreate: ROLE_RANK[locals.user.role] >= ROLE_RANK.editor
	};
};
