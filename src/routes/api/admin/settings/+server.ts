import { error, json } from '@sveltejs/kit';
import { getSiteSettings, updateSiteSettings } from '$lib/server/admin-settings';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	return json(await getSiteSettings(locals.db));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	try {
		return json(await updateSiteSettings(locals.db, await request.json()));
	} catch (err) {
		error(400, err instanceof Error ? err.message : 'Invalid settings');
	}
};
