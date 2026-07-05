import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { GET, POST } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/albums', {
			method: body ? 'POST' : 'GET',
			body: body ? JSON.stringify(body) : undefined,
			headers: body ? { 'content-type': 'application/json' } : undefined
		})
	} as never;
}

describe('/api/albums', () => {
	it('401s without a session and 403s creation below uploader', async () => {
		await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(POST(evt(viewer, { title: 'X' }))).rejects.toMatchObject({ status: 403 });
	});

	it('uploader creates an album; anyone signed in lists it', async () => {
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		const res = await POST(evt(uploader, { title: 'Summer at the Lake' }));
		expect(res.status).toBe(201);
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		const { albums } = (await (await GET(evt(viewer))).json()) as { albums: { title: string }[] };
		expect(albums).toHaveLength(1);
		expect(albums[0].title).toBe('Summer at the Lake');
	});

	it('400s on a blank title', async () => {
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		await expect(POST(evt(uploader, { title: ' ' }))).rejects.toMatchObject({ status: 400 });
	});
});
