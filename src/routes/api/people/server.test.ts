import { beforeEach, describe, expect, it } from 'vitest';
import {
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { GET, POST } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/people', {
			method: body ? 'POST' : 'GET',
			body: body ? JSON.stringify(body) : undefined,
			headers: body ? { 'content-type': 'application/json' } : undefined
		}),
		url: new URL('http://test/api/people')
	} as never;
}

describe('GET /api/people', () => {
	it('401s without a session', async () => {
		await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });
	});

	it('lists people for any signed-in user', async () => {
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		const res = await GET(evt(viewer));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ people: [] });
	});
});

describe('POST /api/people', () => {
	it('403s below editor', async () => {
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		await expect(POST(evt(uploader, { name: 'X' }))).rejects.toMatchObject({ status: 403 });
	});

	it('400s on a blank name', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(POST(evt(editor, { name: '  ' }))).rejects.toMatchObject({ status: 400 });
	});

	it('creates and returns 201 for editors', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const res = await POST(evt(editor, { name: 'Margaret Torcivia', birthdate: '1941-03-15' }));
		expect(res.status).toBe(201);
		const { person } = await res.json();
		expect(person.name).toBe('Margaret Torcivia');
		expect(person.accentColor).toMatch(/^#/);
	});
});
