import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isRedirect } from '@sveltejs/kit';
import * as schema from '$lib/server/db/schema';
import { SESSION_COOKIE, hashPassword, verifyPassword } from '$lib/server/auth';
import { makeTestDb, makeUser, sessionUser, type TestDb } from '$lib/server/testing/db';
import { MemoryStorage } from '$lib/server/testing/memory-platform';
import { actions } from './+page.server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, fields: Record<string, string | File>, storage = new MemoryStorage()) {
	const fd = new FormData();
	for (const [key, value] of Object.entries(fields)) fd.set(key, value);
	return {
		locals: { db, user, platform: { storage } },
		cookies: { delete: () => undefined },
		request: new Request('http://test/profile', { method: 'POST', body: fd })
	} as never;
}

describe('profile actions', () => {
	it('account requires the current password', async () => {
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { username: 'me', passwordHash: stored }));
		const result = (await actions.account(evt(me, { username: 'renamed', current: 'wrong' }))) as {
			status?: number;
		};
		expect(result.status).toBe(400);
	});

	it('account rejects a taken username', async () => {
		await makeUser(db, { username: 'taken' });
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { username: 'me', passwordHash: stored }));
		const result = (await actions.account(
			evt(me, { username: 'taken', current: 'old-password-1' })
		)) as { status?: number };
		expect(result.status).toBe(400);
	});

	it('account renames the user', async () => {
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { username: 'me', passwordHash: stored }));
		await actions.account(evt(me, { username: 'renamed', current: 'old-password-1' }));
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.username).toBe('renamed');
	});

	it('password requires the current password', async () => {
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { passwordHash: stored }));
		const bad = (await actions.password(evt(me, { current: 'wrong', next: 'new-password-1' }))) as {
			status?: number;
		};
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
		const bad = (await actions.appearance(evt(me, { accentColor: '#000000', theme: 'dark' }))) as {
			status?: number;
		};
		expect(bad.status).toBe(400);
		await actions.appearance(evt(me, { accentColor: '#FFD9A8', theme: 'dark', comfortMode: 'on' }));
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.accentColor).toBe('#FFD9A8');
		expect(row.theme).toBe('dark');
		expect(row.comfortMode).toBe(true);
	});

	it('uploads an avatar image for the signed-in user', async () => {
		const storage = new MemoryStorage();
		const me = sessionUser(await makeUser(db, {}));
		const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' });

		await actions.avatar(evt(me, { avatar: file }, storage));

		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.avatarStorageKey).toMatch(new RegExp(`^avatars/users/${me.id}/.+\\.png$`));
		expect(row.avatarMime).toBe('image/png');
		expect(storage.files.get(row.avatarStorageKey!)?.contentType).toBe('image/png');
	});

	it('deletes the signed-in user avatar', async () => {
		const storage = new MemoryStorage();
		await storage.put('avatars/users/me/avatar.png', new Uint8Array([1, 2, 3]), {
			contentType: 'image/png'
		});
		const row = await makeUser(db, {
			id: 'me',
			avatarStorageKey: 'avatars/users/me/avatar.png',
			avatarMime: 'image/png'
		});
		const me = sessionUser(row);

		await actions.deleteAvatar(evt(me, {}, storage));

		const after = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(after.avatarStorageKey).toBeNull();
		expect(after.avatarMime).toBeNull();
		expect(storage.files.has('avatars/users/me/avatar.png')).toBe(false);
	});

	it('deleteAccount rejects the owner account', async () => {
		const owner = sessionUser(await makeUser(db, { role: 'owner' }));
		const result = (await actions.deleteAccount(evt(owner, { current: 'anything' }))) as {
			status?: number;
		};
		expect(result.status).toBe(400);
	});

	it('deleteAccount requires the current password', async () => {
		await makeUser(db, { role: 'owner' });
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { passwordHash: stored }));
		const result = (await actions.deleteAccount(evt(me, { current: 'wrong' }))) as {
			status?: number;
		};
		expect(result.status).toBe(400);
	});

	it('deleteAccount reassigns authored records to owner, removes sessions, and signs out', async () => {
		const owner = await makeUser(db, { id: 'owner-delete', role: 'owner' });
		const stored = await hashPassword('old-password-1');
		const row = await makeUser(db, { id: 'user-delete', passwordHash: stored });
		const me = sessionUser(row);
		await db.insert(schema.sessions).values({
			id: 'session-delete',
			userId: row.id,
			expiresAt: new Date(Date.now() + 60_000)
		});
		await db.insert(schema.items).values({
			id: 'item-delete',
			type: 'photo',
			title: null,
			description: null,
			dateStart: null,
			dateEnd: null,
			datePrecision: 'unknown',
			sortDate: null,
			duration: null,
			width: 1,
			height: 1,
			sizeBytes: 1,
			sha256: 'd'.repeat(64),
			source: 'upload',
			tapeLabel: null,
			status: 'ready',
			uploadedBy: row.id,
			deletedAt: null,
			createdAt: new Date()
		});
		await db.insert(schema.albums).values({
			id: 'album-delete',
			title: 'Mine',
			description: null,
			coverItemId: null,
			createdBy: row.id,
			createdAt: new Date(),
			deletedAt: null
		});
		await db.insert(schema.comments).values({
			id: 'comment-delete',
			itemId: 'item-delete',
			userId: row.id,
			body: 'memory',
			createdAt: new Date(),
			deletedAt: null
		});
		const deletedCookies: Array<{ name: string; opts: { path: string } }> = [];
		const event = evt(me, { current: 'old-password-1' }) as {
			cookies: { delete: (name: string, opts: { path: string }) => void };
		};
		event.cookies.delete = (name, opts) => deletedCookies.push({ name, opts });

		await expect(actions.deleteAccount(event as never)).rejects.toSatisfy(
			(err: unknown) => isRedirect(err) && err.location === '/login'
		);

		expect((await db.select().from(schema.users).where(eq(schema.users.id, row.id))).length).toBe(
			0
		);
		expect(
			(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, row.id))).length
		).toBe(0);
		expect(
			(await db.select().from(schema.items).where(eq(schema.items.id, 'item-delete')))[0].uploadedBy
		).toBe(owner.id);
		expect(
			(await db.select().from(schema.albums).where(eq(schema.albums.id, 'album-delete')))[0]
				.createdBy
		).toBe(owner.id);
		expect(
			(await db.select().from(schema.comments).where(eq(schema.comments.id, 'comment-delete')))[0]
				.userId
		).toBe(owner.id);
		expect(deletedCookies).toEqual([{ name: SESSION_COOKIE, opts: { path: '/' } }]);
	});
});
