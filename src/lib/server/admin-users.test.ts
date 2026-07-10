import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from './auth';
import { changeRole, deleteUser, linkPerson, listUsers, resetPassword } from './admin-users';
import type { Db } from './db';
import { createTestDb } from './db/test-db';
import { albums, comments, items, people, sessions, users } from './db/schema';

let db: Db;
const owner = {
	id: 'u_owner0000001',
	username: 'gran',
	role: 'owner',
	accentColor: '#FA7B62',
	avatarStorageKey: null,
	personId: null,
	comfortMode: false,
	theme: 'system',
	tourVersion: 0
} as const;
const admin = {
	id: 'u_admin0000001',
	username: 'ada',
	role: 'admin',
	accentColor: '#FFD700',
	avatarStorageKey: null,
	personId: null,
	comfortMode: false,
	theme: 'system',
	tourVersion: 0
} as const;
const uploaderId = 'u_up0000000001';

async function expectStatus(fn: () => Promise<unknown>, status: number): Promise<void> {
	try {
		await fn();
		expect.unreachable();
	} catch (err) {
		expect(isHttpError(err) && err.status === status).toBe(true);
	}
}

beforeEach(async () => {
	db = createTestDb();
	const now = new Date();
	await db.insert(users).values([
		{
			...owner,
			passwordHash: 'x',
			createdAt: now
		},
		{
			...admin,
			passwordHash: 'x',
			createdAt: now
		},
		{
			id: uploaderId,
			username: 'kid',
			passwordHash: 'x',
			role: 'uploader',
			accentColor: '#A8D8EA',
			personId: null,
			comfortMode: false,
			theme: 'system',
			createdAt: now
		}
	]);
	await db.insert(people).values({
		id: 'p_1',
		name: 'Mom',
		slug: 'mom',
		nickname: null,
		birthdate: null,
		deathDate: null,
		birthPlace: null,
		bio: null,
		avatarItemId: null,
		avatarCrop: null,
		accentColor: '#FFB11B',
		createdAt: now
	});
});

describe('listUsers', () => {
	it('lists with linked person names and no password hashes', async () => {
		await linkPerson(db, uploaderId, 'p_1');
		const rows = await listUsers(db);
		expect(rows).toHaveLength(3);
		expect(rows.find((row) => row.id === uploaderId)?.personName).toBe('Mom');
		expect(JSON.stringify(rows)).not.toContain('passwordHash');
	});
});

describe('changeRole', () => {
	it('admin may move a non-admin among user/uploader/editor', async () => {
		await changeRole(db, admin, uploaderId, 'editor');
		expect((await listUsers(db)).find((row) => row.id === uploaderId)?.role).toBe('editor');
	});

	it('only owner promotes to admin or demotes an admin', async () => {
		await expectStatus(() => changeRole(db, admin, uploaderId, 'admin'), 403);
		await expectStatus(() => changeRole(db, admin, admin.id, 'editor'), 403);
		await changeRole(db, owner, uploaderId, 'admin');
		await changeRole(db, owner, admin.id, 'editor');
	});

	it('owner role is immutable; nobody becomes owner', async () => {
		await expectStatus(() => changeRole(db, owner, owner.id, 'admin'), 403);
		await expectStatus(() => changeRole(db, owner, uploaderId, 'owner' as never), 400);
	});
});

describe('resetPassword', () => {
	it('returns a temp password that verifies, and kills sessions', async () => {
		await db
			.insert(sessions)
			.values({ id: 'sess1', userId: uploaderId, expiresAt: new Date(Date.now() + 10_000_000) });
		const temp = await resetPassword(db, admin, uploaderId);
		expect(temp.length).toBeGreaterThanOrEqual(12);
		const row = (await db.select().from(users).where(eq(users.id, uploaderId)))[0];
		expect(await verifyPassword(temp, row.passwordHash)).toBe(true);
		expect(await db.select().from(sessions).where(eq(sessions.userId, uploaderId))).toHaveLength(0);
	});

	it('admin cannot reset admin/owner passwords', async () => {
		await expectStatus(() => resetPassword(db, admin, admin.id), 403);
		await expectStatus(() => resetPassword(db, admin, owner.id), 403);
	});
});

describe('deleteUser', () => {
	it('reassigns content to the owner and removes the account', async () => {
		const now = new Date();
		await db.insert(items).values({
			id: 'it_1',
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
			sha256: 'a'.repeat(64),
			source: 'upload',
			tapeLabel: null,
			status: 'ready',
			uploadedBy: uploaderId,
			deletedAt: null,
			createdAt: now
		});
		await db.insert(albums).values({
			id: 'al_1',
			title: 'A',
			description: null,
			coverItemId: null,
			createdBy: uploaderId,
			createdAt: now,
			deletedAt: null
		});
		await db.insert(comments).values({
			id: 'c_1',
			itemId: 'it_1',
			userId: uploaderId,
			body: 'hi',
			createdAt: now,
			deletedAt: null
		});

		await deleteUser(db, admin, uploaderId);
		expect((await db.select().from(users)).map((user) => user.id)).not.toContain(uploaderId);
		expect((await db.select().from(items))[0].uploadedBy).toBe(owner.id);
		expect((await db.select().from(albums))[0].createdBy).toBe(owner.id);
		expect((await db.select().from(comments))[0].userId).toBe(owner.id);
	});

	it('guards: no owner, no self, admins only by owner', async () => {
		await expectStatus(() => deleteUser(db, admin, owner.id), 403);
		await expectStatus(() => deleteUser(db, admin, admin.id), 400);
		await expectStatus(() => deleteUser(db, { ...admin, id: 'u_admin0000002' }, admin.id), 403);
	});
});
