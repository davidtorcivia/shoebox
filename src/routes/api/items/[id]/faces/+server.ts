import { json } from '@sveltejs/kit';
import { confirmedFacesForItem } from '$lib/server/faces';
import { requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	requireFaces(locals.platform);
	return json({ faces: await confirmedFacesForItem(locals.db, params.id) });
};
