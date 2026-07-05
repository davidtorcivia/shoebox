import { json } from '@sveltejs/kit';
import { contextFromParams, neighborsOf } from '$lib/server/neighbors';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireRole(locals, 'user');
	return json(await neighborsOf(locals.db, params.id, contextFromParams(url.searchParams)));
};
