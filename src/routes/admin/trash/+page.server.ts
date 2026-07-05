import { listTrash, purgeExpired } from '$lib/server/trash';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	const swept = await purgeExpired(locals.db, locals.platform.storage);
	return { trash: await listTrash(locals.db), swept };
};
