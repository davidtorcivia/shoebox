import { error, json } from '@sveltejs/kit';
import { toggleReaction } from '$lib/server/reactions';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	const body = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
	if (!body || typeof body.emoji !== 'string') error(400, 'emoji is required');
	const reactions = await toggleReaction(locals.db, params.id, user.id, body.emoji);
	return json({ reactions });
};
