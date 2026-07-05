import { beforeEach, describe, expect, it } from 'vitest';
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
		request: new Request(`http://test/api/people/${id}/relationships`, {
			method: 'PATCH',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('PATCH /api/people/[id]/relationships', () => {
	it('403s below editor', async () => {
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(uploader, meg.id, { add: [] }))).rejects.toMatchObject({ status: 403 });
	});

	it('adds rels and returns the derived family', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, { name: 'Margaret' });
		const frank = await makePerson(db, { name: 'Frank' });
		const carol = await makePerson(db, { name: 'Carol' });
		const res = await PATCH(
			evt(editor, meg.id, {
				add: [
					{ personA: meg.id, personB: frank.id, type: 'spouse-of' },
					{ personA: meg.id, personB: carol.id, type: 'parent-of' }
				]
			})
		);
		const { family } = await res.json();
		expect(family.spouses.map((person: { name: string }) => person.name)).toEqual(['Frank']);
		expect(family.children.map((person: { name: string }) => person.name)).toEqual(['Carol']);
	});

	it('400s on a malformed body', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(editor, meg.id, { add: 'nope' }))).rejects.toMatchObject({
			status: 400
		});
	});
});
