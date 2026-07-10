import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { makeTestDb, makeUser, sessionUser, type TestDb } from '$lib/server/testing/db';
import { POST } from './+server';

let db: TestDb;
let user: ReturnType<typeof sessionUser>;

beforeEach(async () => {
	db = makeTestDb();
	user = sessionUser(await makeUser(db, { username: 'grandma' }));
});

function event(caller: typeof user | null, body: unknown) {
	return {
		locals: { db, user: caller },
		request: new Request('http://test/api/onboarding', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never;
}

async function userRow() {
	return (await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1))[0];
}

describe('POST /api/onboarding', () => {
	it('rejects unauthenticated callers', async () => {
		await expect(POST(event(null, { action: 'complete', version: 1 }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('rejects unknown actions and bad payloads', async () => {
		await expect(POST(event(user, { action: 'reset' }))).rejects.toMatchObject({ status: 400 });
		await expect(POST(event(user, { action: 'complete', version: 0 }))).rejects.toMatchObject({
			status: 400
		});
		await expect(POST(event(user, { action: 'comfort', enabled: 'yes' }))).rejects.toMatchObject({
			status: 400
		});
	});

	it('complete stamps tour_completed_at and tour_version', async () => {
		const res = await POST(event(user, { action: 'complete', version: 1 }));
		expect(res.status).toBe(200);
		const row = await userRow();
		expect(row.tourVersion).toBe(1);
		expect(row.tourCompletedAt).toBeInstanceOf(Date);
	});

	it('the tour version never moves backwards', async () => {
		await POST(event(user, { action: 'complete', version: 3 }));
		await POST(event(user, { action: 'complete', version: 1 }));
		expect((await userRow()).tourVersion).toBe(3);
	});

	it('comfort persists the comfort mode preference', async () => {
		await POST(event(user, { action: 'comfort', enabled: true }));
		expect((await userRow()).comfortMode).toBe(true);
		await POST(event(user, { action: 'comfort', enabled: false }));
		expect((await userRow()).comfortMode).toBe(false);
	});
});
