import { error, json } from '@sveltejs/kit';
import {
	changeRole,
	deleteUser,
	linkPerson,
	linkedPersonConflict,
	resetPassword
} from '$lib/server/admin-users';
import { users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { Role } from '$lib/server/roles';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const ROLES = ['admin', 'editor', 'uploader', 'user'] as const;

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const actor = requireRole(locals, 'admin');
	const id = params.id;
	if (!id) error(404, 'user not found');
	const body = (await request.json().catch(() => null)) as {
		role?: unknown;
		resetPassword?: unknown;
		personId?: unknown;
	} | null;
	if (!body) error(400, 'Nothing to update');

	if (body.role !== undefined) {
		if (!ROLES.includes(body.role as (typeof ROLES)[number])) error(400, 'invalid role');
		await changeRole(locals.db, actor, id, body.role as Exclude<Role, 'owner'>);
		return json({ ok: true });
	}

	if (body.resetPassword) {
		const tempPassword = await resetPassword(locals.db, actor, id);
		return json({ tempPassword });
	}

	if (body.personId !== undefined) {
		if (body.personId !== null && typeof body.personId !== 'string') {
			error(400, 'personId must be a string or null');
		}
		const personId = body.personId as string | null;
		const linked = personId ? await linkedPersonConflict(locals.db, id, personId) : null;
		if (linked) return json({ error: 'person-already-linked', userId: linked }, { status: 409 });
		await linkPerson(locals.db, id, personId);
		const user = (await locals.db.select().from(users).where(eq(users.id, id)).limit(1))[0];
		return json({ user: { id: user.id, username: user.username, personId } });
	}

	error(400, 'Nothing to update');
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const actor = requireRole(locals, 'admin');
	if (!params.id) error(404, 'user not found');
	await deleteUser(locals.db, actor, params.id);
	return new Response(null, { status: 204 });
};
