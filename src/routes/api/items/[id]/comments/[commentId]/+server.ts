import { json } from '@sveltejs/kit';
import { deleteComment } from '$lib/server/comments';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'user');
	await deleteComment(locals.db, params.commentId, user);
	return json({ ok: true });
};
