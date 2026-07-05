import { error, redirect } from '@sveltejs/kit';
import { getPersonDetail } from '$lib/server/people';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	if (!person) error(404, 'Person not found');
	const isEditor = ROLE_RANK[locals.user.role] >= ROLE_RANK.editor;
	const isLinked = locals.user.personId === params.id;
	return {
		person,
		canEdit: isEditor,
		canEditBio: isEditor || isLinked,
		isLinked
	};
};
