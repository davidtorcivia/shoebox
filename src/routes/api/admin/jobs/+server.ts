import { json } from '@sveltejs/kit';
import { listJobs } from '$lib/server/admin-jobs';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	return json({ jobs: await listJobs(locals.db) });
};
