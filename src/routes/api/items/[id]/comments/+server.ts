import { error, json } from '@sveltejs/kit';
import { addComment, listComments } from '$lib/server/comments';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'user');
	return json({ comments: await listComments(locals.db, params.id, user) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	const body = (await request.json().catch(() => null)) as { body?: unknown } | null;
	if (!body || typeof body.body !== 'string') error(400, 'body is required');
	const comment = await addComment(locals.db, params.id, user, body.body);
	return json({ comment }, { status: 201 });
};
