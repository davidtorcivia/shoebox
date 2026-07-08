import { error, json } from '@sveltejs/kit';
import type { Rel } from '$lib/domain/relationships';
import { applyRelationshipChanges } from '$lib/server/people';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as {
		add?: unknown;
		remove?: unknown;
	} | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'invalid body');

	const add = body.add ?? [];
	const remove = body.remove ?? [];
	if (!Array.isArray(add) || !Array.isArray(remove)) error(400, 'add and remove must be arrays');

	const family = await applyRelationshipChanges(locals.db, locals.platform.storage, params.id, {
		add: add as Rel[],
		remove: remove as Rel[]
	});
	return json({ family });
};
