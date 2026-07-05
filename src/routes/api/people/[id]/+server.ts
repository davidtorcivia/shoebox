import { error, json } from '@sveltejs/kit';
import {
	PERSON_PATCH_KEYS,
	deletePersonGuarded,
	getPersonDetail,
	updatePerson,
	type PersonPatch
} from '$lib/server/people';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

const LINKED_USER_KEYS = ['bio', 'birthPlace'] as const;

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	if (!person) error(404, 'person not found');
	return json({ person });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	const isEditor = ROLE_RANK[user.role] >= ROLE_RANK.editor;
	const isLinkedUser = user.personId === params.id;
	if (!isEditor && !isLinkedUser) error(403, 'not allowed to edit this person');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'invalid body');

	const allowedKeys: readonly string[] = isEditor ? PERSON_PATCH_KEYS : LINKED_USER_KEYS;
	for (const key of Object.keys(body)) {
		if (!(PERSON_PATCH_KEYS as readonly string[]).includes(key)) error(400, `unknown field: ${key}`);
		if (!allowedKeys.includes(key)) {
			error(403, `linked users may only edit: ${LINKED_USER_KEYS.join(', ')}`);
		}
	}

	await updatePerson(locals.db, params.id, body as PersonPatch);
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	return json({ person });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'admin');
	const result = await deletePersonGuarded(locals.db, params.id);
	if (!result.ok) return json({ error: 'person-in-use', count: result.taggedCount }, { status: 409 });
	return json({ ok: true });
};
