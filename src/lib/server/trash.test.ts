import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db';
import { createTestDb } from './db/test-db';
import { albumItems, albums, comments, itemFiles, items, users } from './db/schema';
import { TRASH_RETENTION_DAYS, emptyTrash, listTrash, purgeExpired, restoreTrash } from './trash';

let db: Db;
const OWNER_ID = 'u_owner0000001';
const NOW = new Date('2026-07-04T12:00:00Z');
const DAYS_40_AGO = new Date(NOW.getTime() - 40 * 86_400_000);
const DAYS_5_AGO = new Date(NOW.getTime() - 5 * 86_400_000);

const deleted: string[] = [];
const storage = {
	put: vi.fn(),
	get: vi.fn(),
	head: vi.fn(),
	delete: vi.fn(async (key: string) => {
		deleted.push(key);
	}),
	mediaUrl: vi.fn(async (key: string) => `/media/${key}`)
};

beforeEach(async () => {
	db = createTestDb();
	deleted.length = 0;
	await db.insert(users).values({
		id: OWNER_ID,
		username: 'gran',
		passwordHash: 'x',
		role: 'owner',
		accentColor: '#FA7B62',
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: NOW
	});
	await db.insert(items).values([
		{
			id: 'it_old',
			type: 'photo',
			title: 'Old',
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
			deletedAt: DAYS_40_AGO,
			createdAt: NOW
		},
		{
			id: 'it_new',
			type: 'photo',
			title: 'New',
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
			deletedAt: DAYS_5_AGO,
			createdAt: NOW
		},
		{
			id: 'it_live',
			type: 'photo',
			title: 'Live',
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
			deletedAt: null,
			createdAt: NOW
		}
	]);
	await db.insert(itemFiles).values([
		{
			id: 'if_1',
			itemId: 'it_old',
			kind: 'original',
			storageKey: 'media/it_old/original.jpg',
			mime: 'image/jpeg',
			width: 1,
			height: 1
		},
		{
			id: 'if_2',
			itemId: 'it_old',
			kind: 'thumb_800',
			storageKey: 'media/it_old/thumb_800.webp',
			mime: 'image/webp',
			width: 1,
			height: 1
		}
	]);
	await db.insert(albums).values([
		{
			id: 'al_old',
			title: 'Old album',
			description: null,
			coverItemId: null,
			createdBy: OWNER_ID,
			createdAt: NOW,
			deletedAt: DAYS_40_AGO
		},
		{
			id: 'al_live',
			title: 'Live album',
			description: null,
			coverItemId: null,
			createdBy: OWNER_ID,
			createdAt: NOW,
			deletedAt: null
		}
	]);
	await db.insert(albumItems).values({ albumId: 'al_old', itemId: 'it_live', position: 0 });
	await db.insert(comments).values([
		{
			id: 'c_old',
			itemId: 'it_live',
			userId: OWNER_ID,
			body: 'old comment',
			createdAt: NOW,
			deletedAt: DAYS_40_AGO
		},
		{
			id: 'c_new',
			itemId: 'it_live',
			userId: OWNER_ID,
			body: 'new comment',
			createdAt: NOW,
			deletedAt: DAYS_5_AGO
		}
	]);
});

describe('listTrash', () => {
	it('lists only soft-deleted rows', async () => {
		const trash = await listTrash(db);
		expect(trash.items.map((item) => item.id).sort()).toEqual(['it_new', 'it_old']);
		expect(trash.albums.map((album) => album.id)).toEqual(['al_old']);
		expect(trash.comments.map((comment) => comment.id).sort()).toEqual(['c_new', 'c_old']);
	});
});

describe('restoreTrash', () => {
	it('clears deletedAt', async () => {
		await restoreTrash(db, 'item', 'it_new');
		await restoreTrash(db, 'comment', 'c_new');
		const trash = await listTrash(db);
		expect(trash.items.map((item) => item.id)).toEqual(['it_old']);
		expect(trash.comments.map((comment) => comment.id)).toEqual(['c_old']);
	});
});

describe('purgeExpired', () => {
	it('hard-deletes only rows older than 30 days, including storage objects', async () => {
		expect(TRASH_RETENTION_DAYS).toBe(30);
		const result = await purgeExpired(db, storage, NOW);
		expect(result).toEqual({ items: 1, albums: 1, comments: 1 });
		expect(deleted.sort()).toEqual(['media/it_old/original.jpg', 'media/it_old/thumb_800.webp']);
		const trash = await listTrash(db);
		expect(trash.items.map((item) => item.id)).toEqual(['it_new']);
		expect(trash.albums).toEqual([]);
		expect(trash.comments.map((comment) => comment.id)).toEqual(['c_new']);
		expect((await db.select().from(items)).map((item) => item.id).sort()).toEqual([
			'it_live',
			'it_new'
		]);
		expect(await db.select().from(itemFiles)).toHaveLength(0);
	});
});

describe('emptyTrash', () => {
	it('hard-deletes everything soft-deleted regardless of age', async () => {
		const result = await emptyTrash(db, storage);
		expect(result).toEqual({ items: 2, albums: 1, comments: 2 });
		expect(await listTrash(db)).toEqual({ items: [], albums: [], comments: [] });
		expect((await db.select().from(items)).map((item) => item.id)).toEqual(['it_live']);
	});
});
