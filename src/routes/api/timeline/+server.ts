import { json } from '@sveltejs/kit';
import { timelineYears } from '$lib/server/aggregates';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	return json(await timelineYears(locals.db));
};
