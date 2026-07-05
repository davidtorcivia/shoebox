import { beforeEach, describe, expect, it } from 'vitest';
import {
	addThumbs,
	makeItem,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { createAlbum, getAlbumDetail } from '$lib/server/albums';
import { PATCH, POST } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, id: string, body: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/albums/${id}/items`, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('/api/albums/[id]/items', () => {
	it('adds, removes, and reorders for the creator', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const album = await createAlbum(db, editor, { title: 'Lake' });
		const i1 = await makeItem(db, { uploadedBy: editor.id });
		const i2 = await makeItem(db, { uploadedBy: editor.id });
		await addThumbs(db, i1.id);
		await addThumbs(db, i2.id);
		await POST(evt(editor, album.id, { add: [i1.id, i2.id] }));
		await PATCH(
			evt(editor, album.id, {
				positions: [
					{ itemId: i2.id, position: 0 },
					{ itemId: i1.id, position: 1 }
				]
			})
		);
		const detail = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(detail.itemIds).toEqual([i2.id, i1.id]);
		await POST(evt(editor, album.id, { remove: [i2.id] }));
		expect((await getAlbumDetail(db, stubStorage, album.id))!.itemIds).toEqual([i1.id]);
	});

	it('403s for a non-creator below editor', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		const album = await createAlbum(db, editor, { title: 'Lake' });
		await expect(POST(evt(uploader, album.id, { add: [] }))).rejects.toMatchObject({
			status: 403
		});
	});
});
