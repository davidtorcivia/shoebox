import { redirect } from '@sveltejs/kit';
import { listAlbums } from '$lib/server/albums';
import { ROLE_RANK } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		albums: await listAlbums(locals.db, locals.platform.storage),
		canCreate: ROLE_RANK[locals.user.role] >= ROLE_RANK.uploader
	};
};
