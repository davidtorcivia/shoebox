import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { makeTestDb, makeUser, sessionUser, type TestDb } from '$lib/server/testing/db';
import { actions } from './+page.server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [key, value] of Object.entries(fields)) fd.set(key, value);
	return {
		locals: { db, user },
		request: new Request('http://test/profile', { method: 'POST', body: fd })
	} as never;
}

describe('profile actions', () => {
	it('account rejects a taken username', async () => {
		await makeUser(db, { username: 'taken' });
		const me = sessionUser(await makeUser(db, { username: 'me' }));
		const result = (await actions.account(evt(me, { username: 'taken' }))) as { status?: number };
		expect(result.status).toBe(400);
	});

	it('account renames the user', async () => {
		const me = sessionUser(await makeUser(db, { username: 'me' }));
		await actions.account(evt(me, { username: 'renamed' }));
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.username).toBe('renamed');
	});

	it('password requires the current password', async () => {
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { passwordHash: stored }));
		const bad = (await actions.password(
			evt(me, { current: 'wrong', next: 'new-password-1' })
		)) as { status?: number };
		expect(bad.status).toBe(400);
		const ok = await actions.password(
			evt(me, { current: 'old-password-1', next: 'new-password-1' })
		);
		expect(ok).toEqual({ saved: 'password' });
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(await verifyPassword('new-password-1', row.passwordHash)).toBe(true);
	});

	it('appearance validates the accent and persists theme/comfort', async () => {
		const me = sessionUser(await makeUser(db, {}));
		const bad = (await actions.appearance(
			evt(me, { accentColor: '#000000', theme: 'dark' })
		)) as { status?: number };
		expect(bad.status).toBe(400);
		await actions.appearance(
			evt(me, { accentColor: '#FFD9A8', theme: 'dark', comfortMode: 'on' })
		);
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.accentColor).toBe('#FFD9A8');
		expect(row.theme).toBe('dark');
		expect(row.comfortMode).toBe(true);
	});
});
