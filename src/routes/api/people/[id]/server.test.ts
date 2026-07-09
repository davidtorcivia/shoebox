import { beforeEach, describe, expect, it } from 'vitest';
import {
	makeItem,
	makePerson,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	tagPerson,
	type TestDb
} from '$lib/server/testing/db';
import { DELETE, GET, PATCH } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, id: string, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/people/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body ?? {}),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('GET /api/people/[id]', () => {
	it('404s for a missing person', async () => {
		const user = sessionUser(await makeUser(db, {}));
		await expect(GET(evt(user, 'nope'))).rejects.toMatchObject({ status: 404 });
	});

	it('returns the detail DTO', async () => {
		const user = sessionUser(await makeUser(db, {}));
		const meg = await makePerson(db, { name: 'Margaret' });
		const res = await GET(evt(user, meg.id));
		expect((await res.json()).person.name).toBe('Margaret');
	});
});

describe('PATCH /api/people/[id]', () => {
	it('lets an editor patch any field', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		const res = await PATCH(
			evt(editor, meg.id, { name: 'Margaret', birthPlace: 'Brooklyn, New York' })
		);
		expect((await res.json()).person.birthPlace).toBe('Brooklyn, New York');
	});

	it('lets the linked user patch bio and birthPlace only', async () => {
		const meg = await makePerson(db, {});
		const linked = sessionUser(await makeUser(db, { role: 'user', personId: meg.id }));
		const res = await PATCH(evt(linked, meg.id, { bio: 'My story.' }));
		expect((await res.json()).person.bio).toBe('My story.');
		await expect(PATCH(evt(linked, meg.id, { name: 'Nope' }))).rejects.toMatchObject({
			status: 403
		});
	});

	it('403s for an unlinked non-editor', async () => {
		const meg = await makePerson(db, {});
		const user = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(PATCH(evt(user, meg.id, { bio: 'x' }))).rejects.toMatchObject({ status: 403 });
	});

	it('400s on unknown fields', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(editor, meg.id, { nickname: 'Grandma' }))).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('DELETE /api/people/[id]', () => {
	it('403s below admin', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(DELETE(evt(editor, meg.id))).rejects.toMatchObject({ status: 403 });
	});

	it('409s with the count when the person is tagged', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const editor = await makeUser(db, { role: 'editor' });
		const meg = await makePerson(db, {});
		const item = await makeItem(db, { uploadedBy: editor.id });
		await tagPerson(db, item.id, meg.id);
		const res = await DELETE(evt(admin, meg.id));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'person-in-use', count: 1 });
	});

	it('deletes an untagged person', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const meg = await makePerson(db, {});
		const res = await DELETE(evt(admin, meg.id));
		expect(await res.json()).toEqual({ ok: true });
	});
});
