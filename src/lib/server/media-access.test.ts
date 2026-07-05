import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema';
import type { Db } from './db';
import { createTestDb } from './db/test-db';
import { canAccessMedia } from './media-access';
import { createShare } from './shares';

let db: Db;
const OWNER_ID = 'u_owner000001';
const sessionUser = {
	id: OWNER_ID,
	username: 'gran',
	role: 'owner',
	accentColor: '#FA7B62',
	avatarStorageKey: null,
	personId: null,
	comfortMode: false,
	theme: 'system'
} as const;

function locals(user: typeof sessionUser | null, shareTokens: string[] = []): App.Locals {
	return { db, user, shareTokens, platform: undefined as never } as unknown as App.Locals;
}

beforeEach(async () => {
	db = createTestDb();
	const now = new Date();
	await db.insert(schema.users).values({
		id: OWNER_ID,
		username: 'gran',
		passwordHash: 'x',
		role: 'owner',
		accentColor: '#FA7B62',
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: now
	});
	await db.insert(schema.items).values([
		{
			id: 'it_in',
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
			uploadedBy: OWNER_ID,
			deletedAt: null,
			createdAt: now
		},
		{
			id: 'it_out',
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
			sha256: 'b'.repeat(64),
			source: 'upload',
			tapeLabel: null,
			status: 'ready',
			uploadedBy: OWNER_ID,
			deletedAt: null,
			createdAt: now
		},
		{
			id: 'it_dead',
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
			sha256: 'c'.repeat(64),
			source: 'upload',
			tapeLabel: null,
			status: 'ready',
			uploadedBy: OWNER_ID,
			deletedAt: now,
			createdAt: now
		}
	]);
	await db.insert(schema.itemFiles).values([
		{
			id: 'if_1',
			itemId: 'it_in',
			kind: 'thumb_800',
			storageKey: 'media/it_in/thumb_800.webp',
			mime: 'image/webp',
			width: 800,
			height: 600
		},
		{
			id: 'if_2',
			itemId: 'it_in',
			kind: 'original',
			storageKey: 'media/it_in/original.jpg',
			mime: 'image/jpeg',
			width: 4000,
			height: 3000
		},
		{
			id: 'if_3',
			itemId: 'it_out',
			kind: 'thumb_800',
			storageKey: 'media/it_out/thumb_800.webp',
			mime: 'image/webp',
			width: 800,
			height: 600
		},
		{
			id: 'if_4',
			itemId: 'it_dead',
			kind: 'thumb_800',
			storageKey: 'media/it_dead/thumb_800.webp',
			mime: 'image/webp',
			width: 800,
			height: 600
		}
	]);
	await db.insert(schema.albums).values({
		id: 'al_1',
		title: 'Xmas',
		description: null,
		coverItemId: null,
		createdBy: OWNER_ID,
		createdAt: now,
		deletedAt: null
	});
	await db.insert(schema.albumItems).values({ albumId: 'al_1', itemId: 'it_in', position: 0 });
});

describe('canAccessMedia', () => {
	it('always allows a session user', async () => {
		expect(await canAccessMedia(locals(sessionUser), 'media/it_out/thumb_800.webp')).toBe(true);
	});

	it('denies signed-out with no share cookies', async () => {
		expect(await canAccessMedia(locals(null), 'media/it_in/thumb_800.webp')).toBe(false);
	});

	it('album share grants exactly its album members, including originals', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [share.token]), 'media/it_in/thumb_800.webp')).toBe(
			true
		);
		expect(await canAccessMedia(locals(null, [share.token]), 'media/it_in/original.jpg')).toBe(
			true
		);
		expect(await canAccessMedia(locals(null, [share.token]), 'media/it_out/thumb_800.webp')).toBe(
			false
		);
	});

	it('item share grants only that item', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [share.token]), 'media/it_in/original.jpg')).toBe(
			true
		);
		expect(await canAccessMedia(locals(null, [share.token]), 'media/it_out/thumb_800.webp')).toBe(
			false
		);
	});

	it('denies expired shares, deleted items, and forged keys', async () => {
		const expired = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			expiresAt: new Date('2000-01-01')
		});
		expect(await canAccessMedia(locals(null, [expired.token]), 'media/it_in/thumb_800.webp')).toBe(
			false
		);

		const dead = await createShare(db, {
			targetType: 'item',
			targetId: 'it_dead',
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [dead.token]), 'media/it_dead/thumb_800.webp')).toBe(
			false
		);

		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			createdBy: OWNER_ID
		});
		expect(
			await canAccessMedia(locals(null, [share.token]), 'media/it_in/not_a_real_file.bin')
		).toBe(false);
		expect(await canAccessMedia(locals(null, [share.token]), 'not-media/it_in/original.jpg')).toBe(
			false
		);
	});
});
