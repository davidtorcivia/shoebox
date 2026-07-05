import { listJobs } from '$lib/server/admin-jobs';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	return { jobs: await listJobs(locals.db) };
};
