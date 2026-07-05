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
import { addAlbumItems, createAlbum } from '$lib/server/albums';
import { DELETE, GET, PATCH } from './+server';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(user: unknown, id: string, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/albums/${id}`, {
			method: body ? 'PATCH' : 'GET',
			body: body ? JSON.stringify(body) : undefined,
			headers: body ? { 'content-type': 'application/json' } : undefined
		})
	} as never;
}

describe('/api/albums/[id]', () => {
	it('GET 404s for a missing album', async () => {
		const user = sessionUser(await makeUser(db, {}));
		await expect(GET(evt(user, 'nope'))).rejects.toMatchObject({ status: 404 });
	});

	it('returns album detail items in position order', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const album = await createAlbum(db, editor, { title: 'Lake' });
		const i1 = await makeItem(db, { uploadedBy: editor.id });
		const i2 = await makeItem(db, { uploadedBy: editor.id });
		await addThumbs(db, i1.id);
		await addThumbs(db, i2.id);
		await addAlbumItems(db, album.id, [i2.id, i1.id]);
		const res = await GET(evt(editor, album.id));
		const body = (await res.json()) as { items: { id: string }[] };
		expect(body.items.map((item) => item.id)).toEqual([i2.id, i1.id]);
	});

	it('creator can PATCH and DELETE their own album; strangers cannot', async () => {
		const uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
		const stranger = sessionUser(await makeUser(db, { role: 'uploader' }));
		const album = await createAlbum(db, uploader, { title: 'Mine' });
		await expect(PATCH(evt(stranger, album.id, { title: 'Stolen' }))).rejects.toMatchObject({
			status: 403
		});
		const res = await PATCH(evt(uploader, album.id, { title: 'Mine Renamed' }));
		expect(((await res.json()) as { album: { title: string } }).album.title).toBe('Mine Renamed');
		const del = await DELETE(evt(uploader, album.id));
		expect(await del.json()).toEqual({ ok: true });
		await expect(GET(evt(uploader, album.id))).rejects.toMatchObject({ status: 404 });
	});
});
