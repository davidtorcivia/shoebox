import { json } from '@sveltejs/kit';
import { requireFacesAdmin } from '$lib/server/admin-faces';
import { listSuggestions } from '$lib/server/faces';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireFacesAdmin(locals);
	return json({ suggestions: await listSuggestions(locals.db, locals.platform.storage) });
};
