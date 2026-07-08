import { listFavorites } from '$lib/server/favorites';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireRole(locals, 'user');
	return { items: await listFavorites(locals.db, locals.platform.storage, user.id) };
};
