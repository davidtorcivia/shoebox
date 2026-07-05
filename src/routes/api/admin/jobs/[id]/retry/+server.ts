import { json } from '@sveltejs/kit';
import { retryJob } from '$lib/server/admin-jobs';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'admin');
	return json({ retried: await retryJob(locals.db, params.id) });
};
