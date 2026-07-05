import { beforeEach, describe, expect, it } from 'vitest';
import {
	addThumbs,
	makeItem,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from './testing/db';
import {
	addAlbumItems,
	canEditAlbum,
	createAlbum,
	getAlbumDetail,
	listAlbums,
	removeAlbumItems,
	reorderAlbum,
	softDeleteAlbum,
	updateAlbum
} from './albums';

let db: TestDb;
let editor: ReturnType<typeof sessionUser>;
let uploader: ReturnType<typeof sessionUser>;

beforeEach(async () => {
	db = makeTestDb();
	editor = sessionUser(await makeUser(db, { role: 'editor' }));
	uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
});

async function threeItems() {
	const out = [];
	for (let i = 0; i < 3; i += 1) {
		const item = await makeItem(db, { uploadedBy: editor.id });
		await addThumbs(db, item.id);
		out.push(item);
	}
	return out;
}

describe('create/list', () => {
	it('creates an album and lists it with creator identity and count', async () => {
		const album = await createAlbum(db, uploader, { title: 'Summer at the Lake' });
		expect(album.title).toBe('Summer at the Lake');
		expect(album.createdBy.id).toBe(uploader.id);
		const [listed] = await listAlbums(db, stubStorage);
		expect(listed.itemCount).toBe(0);
		expect(listed.coverUrl).toBeNull();
	});

	it('excludes soft-deleted albums', async () => {
		const album = await createAlbum(db, editor, { title: 'Gone' });
		await softDeleteAlbum(db, album.id);
		expect(await listAlbums(db, stubStorage)).toEqual([]);
		expect(await getAlbumDetail(db, stubStorage, album.id)).toBeNull();
	});

	it('rejects blank titles', async () => {
		await expect(createAlbum(db, uploader, { title: '   ' })).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('membership and cover', () => {
	it('appends with increasing positions, skips duplicates, auto-sets cover', async () => {
		const [i1, i2, i3] = await threeItems();
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, album.id, [i1.id, i2.id]);
		await addAlbumItems(db, album.id, [i2.id, i3.id]);
		const detail = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(detail.itemIds).toEqual([i1.id, i2.id, i3.id]);
		expect(detail.album.coverItemId).toBe(i1.id);
		expect(detail.album.coverUrl).toBe(`/media/media/${i1.id}/thumb_400.webp`);
		expect(detail.album.itemCount).toBe(3);
	});

	it('reassigns the cover when the cover item is removed', async () => {
		const [i1, i2] = await threeItems();
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, album.id, [i1.id, i2.id]);
		await removeAlbumItems(db, album.id, [i1.id]);
		const detail = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(detail.itemIds).toEqual([i2.id]);
		expect(detail.album.coverItemId).toBe(i2.id);
	});

	it('validates an explicit cover is a member', async () => {
		const [i1, i2] = await threeItems();
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, album.id, [i1.id]);
		await expect(updateAlbum(db, album.id, { coverItemId: i2.id })).rejects.toMatchObject({
			status: 400
		});
		await updateAlbum(db, album.id, { coverItemId: i1.id, title: 'Lake Days' });
		const detail = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(detail.album.title).toBe('Lake Days');
	});
});

describe('reorder', () => {
	it('applies a batched position update', async () => {
		const [i1, i2, i3] = await threeItems();
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, album.id, [i1.id, i2.id, i3.id]);
		await reorderAlbum(db, album.id, [
			{ itemId: i3.id, position: 0 },
			{ itemId: i1.id, position: 1 },
			{ itemId: i2.id, position: 2 }
		]);
		const detail = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(detail.itemIds).toEqual([i3.id, i1.id, i2.id]);
	});

	it('rejects positions for non-members', async () => {
		const [i1, , i3] = await threeItems();
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, album.id, [i1.id]);
		await expect(
			reorderAlbum(db, album.id, [{ itemId: i3.id, position: 0 }])
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('canEditAlbum', () => {
	it('allows editor+ and the creator, denies others', async () => {
		const album = await createAlbum(db, uploader, { title: 'Mine' });
		const stranger = sessionUser(await makeUser(db, { role: 'uploader' }));
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		expect(canEditAlbum(editor, album)).toBe(true);
		expect(canEditAlbum(uploader, album)).toBe(true);
		expect(canEditAlbum(stranger, album)).toBe(false);
		expect(canEditAlbum(viewer, album)).toBe(false);
	});
});
