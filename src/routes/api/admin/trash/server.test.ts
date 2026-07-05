import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import {
	makeItem,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { DELETE, GET, POST } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/admin/trash', {
			method: body ? 'POST' : 'GET',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		})
	} as never;
}

describe('GET /api/admin/trash', () => {
	it('rejects users below admin', async () => {
		const user = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(GET(evt(user))).rejects.toMatchObject({ status: 403 });
	});

	it('lists soft-deleted rows for admins', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		await makeItem(db, {
			id: 'it_deleted',
			uploadedBy: admin.id,
			title: 'Deleted photo',
			deletedAt: new Date('2026-07-01T00:00:00Z')
		});

		const res = await GET(evt(admin));
		const body = await res.json();
		expect(body.items).toMatchObject([{ id: 'it_deleted', title: 'Deleted photo' }]);
		expect(body.albums).toEqual([]);
		expect(body.comments).toEqual([]);
	});
});

describe('POST /api/admin/trash', () => {
	it('restores a trashed item', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		await makeItem(db, {
			id: 'it_deleted',
			uploadedBy: admin.id,
			deletedAt: new Date('2026-07-01T00:00:00Z')
		});

		const res = await POST(evt(admin, { action: 'restore', kind: 'item', id: 'it_deleted' }));
		expect(res.status).toBe(200);
		const listed = await (await GET(evt(admin))).json();
		expect(listed.items).toEqual([]);
	});
});

describe('DELETE /api/admin/trash', () => {
	it('requires the typed confirmation before emptying trash', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		await makeItem(db, {
			id: 'it_deleted',
			uploadedBy: admin.id,
			deletedAt: new Date('2026-07-01T00:00:00Z')
		});

		await expect(DELETE(evt(admin, { confirm: 'empty' }))).rejects.toMatchObject({
			status: 400
		});
		const res = await DELETE(evt(admin, { confirm: 'empty the trash' }));
		expect(await res.json()).toEqual({ items: 1, albums: 0, comments: 0 });
		expect(await db.select().from(schema.items)).toEqual([]);
	});
});
