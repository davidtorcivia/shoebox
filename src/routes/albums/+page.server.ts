import { redirect } from '@sveltejs/kit';
import { listAlbums } from '$lib/server/albums';
import { favoritesSummary } from '$lib/server/favorites';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		albums: await listAlbums(locals.db, locals.platform.storage),
		saved: await favoritesSummary(locals.db, locals.platform.storage, locals.user.id),
		canCreate: ROLE_RANK[locals.user.role] >= ROLE_RANK.uploader
	};
};
