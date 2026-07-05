import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import {
	makePerson,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { PATCH } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, id: string, body: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/admin/users/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('PATCH /api/admin/users/[id]', () => {
	it('403s below admin', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const target = await makeUser(db, {});
		await expect(PATCH(evt(editor, target.id, { personId: null }))).rejects.toMatchObject({
			status: 403
		});
	});

	it('links and unlinks a person', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const target = await makeUser(db, {});
		const person = await makePerson(db, {});
		const res = await PATCH(evt(admin, target.id, { personId: person.id }));
		expect(await res.json()).toEqual({
			user: { id: target.id, username: target.username, personId: person.id }
		});
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, target.id)))[0];
		expect(row.personId).toBe(person.id);
		await PATCH(evt(admin, target.id, { personId: null }));
		const after = (await db.select().from(schema.users).where(eq(schema.users.id, target.id)))[0];
		expect(after.personId).toBeNull();
	});

	it('400s on an unknown person and 404s on an unknown user', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const target = await makeUser(db, {});
		await expect(PATCH(evt(admin, target.id, { personId: 'nope' }))).rejects.toMatchObject({
			status: 400
		});
		await expect(PATCH(evt(admin, 'nope', { personId: null }))).rejects.toMatchObject({
			status: 404
		});
	});

	it('409s when the person is already linked to another user', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const person = await makePerson(db, {});
		const linked = await makeUser(db, { personId: person.id });
		const target = await makeUser(db, {});
		const res = await PATCH(evt(admin, target.id, { personId: person.id }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'person-already-linked', userId: linked.id });
	});
});
