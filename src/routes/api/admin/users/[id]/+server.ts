import { error, json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { people, users } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
	if (!body || !('personId' in body) || (body.personId !== null && typeof body.personId !== 'string')) {
		error(400, 'personId must be a string or null');
	}
	const personId = body.personId as string | null;

	const target = (await locals.db.select().from(users).where(eq(users.id, params.id)).limit(1))[0];
	if (!target) error(404, 'user not found');

	if (personId !== null) {
		const person = (
			await locals.db.select({ id: people.id }).from(people).where(eq(people.id, personId)).limit(1)
		)[0];
		if (!person) error(400, 'unknown person');
		const linked = (
			await locals.db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.personId, personId), ne(users.id, params.id)))
				.limit(1)
		)[0];
		if (linked) return json({ error: 'person-already-linked', userId: linked.id }, { status: 409 });
	}

	await locals.db.update(users).set({ personId }).where(eq(users.id, params.id));
	return json({ user: { id: target.id, username: target.username, personId } });
};
