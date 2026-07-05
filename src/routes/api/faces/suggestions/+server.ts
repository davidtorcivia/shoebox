import { json } from '@sveltejs/kit';
import { listSuggestions } from '$lib/server/faces';
import { requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'editor');
	requireFaces(locals.platform);
	return json({ suggestions: await listSuggestions(locals.db, locals.platform.storage) });
};
