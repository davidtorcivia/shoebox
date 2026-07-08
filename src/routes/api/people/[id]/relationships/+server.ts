import { error, json } from '@sveltejs/kit';
import type { Rel } from '$lib/domain/relationships';
import { applyRelationshipChanges } from '$lib/server/people';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	// Editors manage anyone's family; a linked user manages their own.
	if (ROLE_RANK[user.role] < ROLE_RANK.editor && user.personId !== params.id) {
		error(403, 'not allowed to edit these relationships');
	}
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
