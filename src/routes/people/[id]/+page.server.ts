import { error, redirect } from '@sveltejs/kit';
import { getPersonDetail, resolvePersonId } from '$lib/server/people';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');
	const personId = await resolvePersonId(locals.db, params.id);
	if (!personId) error(404, 'Person not found');
	const person = await getPersonDetail(locals.db, locals.platform.storage, personId);
	if (!person) error(404, 'Person not found');
	const isEditor = ROLE_RANK[locals.user.role] >= ROLE_RANK.editor;
	const isLinked = locals.user.personId === person.id;
	return {
		person,
		canEdit: isEditor,
		canEditBio: isEditor || isLinked,
		isLinked
	};
};
