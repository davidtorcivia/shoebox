import { beforeEach, describe, expect, it } from 'vitest';
import { HOLIDAY_OPTIONS } from '$lib/server/admin-settings';
import {
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { GET, PATCH } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/admin/settings', {
			method: body ? 'PATCH' : 'GET',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		})
	} as never;
}

describe('GET /api/admin/settings', () => {
	it('requires admin and returns defaults', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(GET(evt(editor))).rejects.toMatchObject({ status: 403 });

		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const res = await GET(evt(admin));
		const body = await res.json();
		expect(body).toEqual({
			siteName: 'Shoebox',
			holidaySet: HOLIDAY_OPTIONS.map((holiday) => holiday.id)
		});
	});
});

describe('PATCH /api/admin/settings', () => {
	it('updates settings and rejects invalid holiday ids', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const res = await PATCH(
			evt(admin, { siteName: 'Family Box', holidaySet: ['christmas', 'thanksgiving'] })
		);
		expect(await res.json()).toEqual({
			siteName: 'Family Box',
			holidaySet: ['christmas', 'thanksgiving']
		});
		await expect(PATCH(evt(admin, { holidaySet: ['made-up'] }))).rejects.toMatchObject({
			status: 400
		});
	});
});
