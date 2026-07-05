import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { sessions, users } from './db/schema';
import { openNodeDb } from './platform/db-node';
import {
	createSession,
	destroySession,
	hashPassword,
	validateSession,
	verifyPassword
} from './auth';

async function seedOwner(db: Db): Promise<string> {
	const id = nanoid(12);
	await db.insert(users).values({
		id,
		username: `owner-${id}`,
		passwordHash: 'unused',
		role: 'owner',
		accentColor: '#FA7B62',
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});
	return id;
}

describe('password hashing (WebCrypto PBKDF2)', () => {
	it('produces the contracted format and round-trips', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(stored).toMatch(/^pbkdf2\$310000\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
		expect(await verifyPassword('correct horse battery', stored)).toBe(true);
		expect(await verifyPassword('wrong password', stored)).toBe(false);
	});

	it('salts: two hashes of the same password differ', async () => {
		expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
	});

	it('rejects malformed stored values without throwing', async () => {
		expect(await verifyPassword('x', 'garbage')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$notanumber$a$b')).toBe(false);
		expect(await verifyPassword('x', '')).toBe(false);
	});
});

describe('sessions', () => {
	it('creates a ~30-day session and validates it to a SessionUser', async () => {
		const db = openNodeDb(':memory:');
		const userId = await seedOwner(db);
		const { token, expiresAt } = await createSession(db, userId);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
		const user = await validateSession(db, token);
		expect(user).not.toBeNull();
		expect(user!.id).toBe(userId);
		expect(user!.role).toBe('owner');
		expect(user!.accentColor).toBe('#FA7B62');
		expect(user!.personId).toBeNull();
	});

	it('stores sha256(token) as the session id, never the token', async () => {
		const db = openNodeDb(':memory:');
		const userId = await seedOwner(db);
		const { token } = await createSession(db, userId);
		const rows = await db.select().from(sessions);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).not.toBe(token);
		expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
	});

	it('returns null for unknown tokens and expired sessions (and prunes them)', async () => {
		const db = openNodeDb(':memory:');
		const userId = await seedOwner(db);
		expect(await validateSession(db, 'f'.repeat(64))).toBeNull();
		const { token } = await createSession(db, userId);
		await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
		expect(await validateSession(db, token)).toBeNull();
		expect(await db.select().from(sessions)).toHaveLength(0);
	});

	it('destroySession invalidates the token', async () => {
		const db = openNodeDb(':memory:');
		const userId = await seedOwner(db);
		const { token } = await createSession(db, userId);
		await destroySession(db, token);
		expect(await validateSession(db, token)).toBeNull();
	});
});
