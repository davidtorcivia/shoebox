import { listUsers } from '$lib/server/admin-users';
import { people } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	const allPeople = await locals.db.select({ id: people.id, name: people.name }).from(people);
	return { users: await listUsers(locals.db), people: allPeople };
};
