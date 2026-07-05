import { error } from '@sveltejs/kit';
import { getPersonDetail, listPeople, resolvePersonId } from '$lib/server/people';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireRole(locals, 'editor');
	const personId = await resolvePersonId(locals.db, params.id);
	if (!personId) error(404, 'Person not found');
	const person = await getPersonDetail(locals.db, locals.platform.storage, personId);
	if (!person) error(404, 'Person not found');
	const all = await listPeople(locals.db, locals.platform.storage);
	return {
		person,
		others: all
			.filter((candidate) => candidate.id !== person.id)
			.map(({ id, slug, name, accentColor }) => ({ id, slug, name, accentColor })),
		isAdmin: ROLE_RANK[user.role] >= ROLE_RANK.admin
	};
};
