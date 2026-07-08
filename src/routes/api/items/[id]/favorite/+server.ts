import { json } from '@sveltejs/kit';
import { toggleFavorite } from '$lib/server/favorites';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'user');
	const favorited = await toggleFavorite(locals.db, user.id, params.id);
	return json({ favorited });
};
