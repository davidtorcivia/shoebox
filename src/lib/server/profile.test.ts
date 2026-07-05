import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from './auth';
import { users } from './db/schema';
import { makeTestDb, makeUser, type TestDb } from './testing/db';
import { changePassword, changeUsername, updateAppearance } from './profile';

let db: TestDb;
let userId: string;

beforeEach(async () => {
	db = makeTestDb();
	userId = (await makeUser(db, { username: 'me', passwordHash: await hashPassword('current-pw') }))
		.id;
	await makeUser(db, { username: 'taken' });
});

describe('changeUsername', () => {
	it('requires the current password', async () => {
		expect(await changeUsername(db, userId, 'wrong', 'newname')).toEqual({
			ok: false,
			error: 'Current password is incorrect'
		});
	});

	it('rejects taken and invalid usernames', async () => {
		expect((await changeUsername(db, userId, 'current-pw', 'taken')).ok).toBe(false);
		expect((await changeUsername(db, userId, 'current-pw', 'a')).ok).toBe(false);
	});

	it('changes the username', async () => {
		expect(await changeUsername(db, userId, 'current-pw', 'grandkid')).toEqual({ ok: true });
		expect((await db.select().from(users).where(eq(users.id, userId)))[0].username).toBe(
			'grandkid'
		);
	});
});

describe('changePassword', () => {
	it('requires the current password and a sane new one', async () => {
		expect((await changePassword(db, userId, 'wrong', 'longenough1')).ok).toBe(false);
		expect((await changePassword(db, userId, 'current-pw', 'short')).ok).toBe(false);
	});

	it('re-hashes', async () => {
		expect(await changePassword(db, userId, 'current-pw', 'my new password')).toEqual({
			ok: true
		});
		const row = (await db.select().from(users).where(eq(users.id, userId)))[0];
		expect(await verifyPassword('my new password', row.passwordHash)).toBe(true);
	});
});

describe('updateAppearance', () => {
	it('sets accent, theme, and comfort mode', async () => {
		await updateAppearance(db, userId, {
			accentColor: '#FFD700',
			theme: 'dark',
			comfortMode: true
		});
		const row = (await db.select().from(users).where(eq(users.id, userId)))[0];
		expect(row.accentColor).toBe('#FFD700');
		expect(row.theme).toBe('dark');
		expect(row.comfortMode).toBe(true);
	});

	it('rejects an accent outside ACCENTS and invalid themes', async () => {
		await expect(updateAppearance(db, userId, { accentColor: '#123456' })).rejects.toThrow();
		await expect(updateAppearance(db, userId, { theme: 'midnight' as 'dark' })).rejects.toThrow();
	});
});
