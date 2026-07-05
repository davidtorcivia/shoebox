import { beforeEach, describe, expect, it } from 'vitest';
import { items as itemsTable } from '$lib/server/db/schema';
import {
	makeItem,
	makeTestDb,
	makeUser,
	sessionUser,
	type TestDb
} from '$lib/server/testing/db';
import { addComment, deleteComment, listComments } from './comments';

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

async function fixture() {
	const uploader = sessionUser(await makeUser(db, { role: 'uploader', accentColor: '#FA7B62' }));
	const viewer = sessionUser(await makeUser(db, { role: 'user', accentColor: '#FFD9A8' }));
	const editor = sessionUser(await makeUser(db, { role: 'editor', accentColor: '#A8D8EA' }));
	const item = await makeItem(db, { uploadedBy: uploader.id });
	return { uploader, viewer, editor, item };
}

describe('comments service', () => {
	it('lists oldest first with accent user identity and delete permissions', async () => {
		const { uploader, viewer, item } = await fixture();
		await addComment(db, item.id, viewer, 'First memory');
		await addComment(db, item.id, uploader, 'Second memory');
		const listed = await listComments(db, item.id, viewer);
		expect(listed.map((comment) => comment.body)).toEqual(['First memory', 'Second memory']);
		expect(listed[0].user).toEqual({
			id: viewer.id,
			username: viewer.username,
			accentColor: viewer.accentColor
		});
		expect(listed.map((comment) => comment.canDelete)).toEqual([true, false]);
	});

	it('rejects blank and oversized comments', async () => {
		const { viewer, item } = await fixture();
		await expect(addComment(db, item.id, viewer, '   ')).rejects.toMatchObject({ status: 400 });
		await expect(addComment(db, item.id, viewer, 'x'.repeat(2001))).rejects.toMatchObject({
			status: 400
		});
	});

	it('refuses missing or deleted items', async () => {
		const { viewer, item } = await fixture();
		await expect(addComment(db, 'missing', viewer, 'Nope')).rejects.toMatchObject({ status: 404 });
		await db.update(itemsTable).set({ deletedAt: new Date() });
		await expect(addComment(db, item.id, viewer, 'Nope')).rejects.toMatchObject({ status: 404 });
	});

	it('lets authors and editor+ soft-delete, but denies unrelated users', async () => {
		const { uploader, viewer, editor, item } = await fixture();
		const own = await addComment(db, item.id, viewer, 'Mine');
		const other = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(deleteComment(db, own.id, other)).rejects.toMatchObject({ status: 403 });
		await deleteComment(db, own.id, viewer);
		expect(await listComments(db, item.id, viewer)).toEqual([]);

		const editorDeleted = await addComment(db, item.id, uploader, 'Editor can remove this');
		await deleteComment(db, editorDeleted.id, editor);
		expect(await listComments(db, item.id, viewer)).toEqual([]);
	});
});
