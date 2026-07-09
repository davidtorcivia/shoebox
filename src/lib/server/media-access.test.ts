import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema';
import type { Db } from './db';
import { createTestDb } from './db/test-db';
import { canAccessItem, canAccessMedia, getCoveringShare } from './media-access';
import { createShare, setShareClip } from './shares';

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

	it('album share grants members thumbnails, but the original only with download', async () => {
		const view = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_in/thumb_800.webp')).toBe(
			true
		);
		// View-only: the full-res original is NOT downloadable.
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_in/original.jpg')).toBe(
			false
		);
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_out/thumb_800.webp')).toBe(
			false
		);

		const download = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			allowDownload: true,
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [download.token]), 'media/it_in/original.jpg')).toBe(
			true
		);
	});

	it('item share grants the item, gating the original behind download', async () => {
		const view = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_in/thumb_800.webp')).toBe(
			true
		);
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_in/original.jpg')).toBe(
			false
		);
		expect(await canAccessMedia(locals(null, [view.token]), 'media/it_out/thumb_800.webp')).toBe(
			false
		);

		const download = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			allowDownload: true,
			createdBy: OWNER_ID
		});
		expect(await canAccessMedia(locals(null, [download.token]), 'media/it_in/original.jpg')).toBe(
			true
		);
	});

	it('a pre-cut segment share serves only the clip and low-res — never the full video', async () => {
		await db.insert(schema.itemFiles).values([
			{
				id: 'if_pb',
				itemId: 'it_in',
				kind: 'playback',
				storageKey: 'media/it_in/playback.mp4',
				mime: 'video/mp4',
				width: 1920,
				height: 1080
			},
			{
				id: 'if_hls',
				itemId: 'it_in',
				kind: 'hls',
				storageKey: 'media/it_in/hls/master.m3u8',
				mime: 'application/vnd.apple.mpegurl',
				width: null,
				height: null
			}
		]);
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			allowDownload: true,
			segmentStart: 2,
			segmentEnd: 5,
			createdBy: OWNER_ID
		});
		await setShareClip(db, share.id, 'media/it_in/shareclips/x.mp4');
		const l = locals(null, [share.token]);

		// The clip and the poster/thumbnails are fine.
		expect(await canAccessMedia(l, 'media/it_in/shareclips/x.mp4')).toBe(true);
		expect(await canAccessMedia(l, 'media/it_in/thumb_800.webp')).toBe(true);
		// The full-resolution video is off-limits — even with allowDownload on.
		expect(await canAccessMedia(l, 'media/it_in/playback.mp4')).toBe(false);
		expect(await canAccessMedia(l, 'media/it_in/hls/master.m3u8')).toBe(false);
		expect(await canAccessMedia(l, 'media/it_in/original.jpg')).toBe(false);
		// A different share's clip key isn't reachable.
		expect(await canAccessMedia(l, 'media/it_in/shareclips/other.mp4')).toBe(false);
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

describe('getCoveringShare / canAccessItem', () => {
	it('returns the covering item share, including its segment bounds', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			allowDownload: true,
			segmentStart: 2,
			segmentEnd: 5,
			createdBy: OWNER_ID
		});
		const found = await getCoveringShare(locals(null, [share.token]), 'it_in', {
			requireDownload: true
		});
		expect(found?.targetId).toBe('it_in');
		expect(found?.segmentStart).toBe(2);
		expect(found?.segmentEnd).toBe(5);
	});

	it('excludes a download-required check when the share is view-only', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			allowDownload: false,
			createdBy: OWNER_ID
		});
		expect(
			await getCoveringShare(locals(null, [share.token]), 'it_in', { requireDownload: true })
		).toBeNull();
		// ...but plain item access (no download requirement) still resolves it.
		expect(await canAccessItem(locals(null, [share.token]), 'it_in')).toBe(true);
	});

	it('does not cover a different item, and always allows a session user', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_in',
			createdBy: OWNER_ID
		});
		expect(await getCoveringShare(locals(null, [share.token]), 'it_out')).toBeNull();
		expect(await canAccessItem(locals(sessionUser), 'it_out')).toBe(true);
	});
});
