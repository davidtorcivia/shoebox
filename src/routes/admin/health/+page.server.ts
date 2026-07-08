import { loadHealth } from '$lib/server/health';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	return {
		health: await loadHealth(locals.db),
		features: locals.platform.features
	};
};
