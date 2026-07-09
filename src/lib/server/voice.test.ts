import { beforeEach, describe, expect, it } from 'vitest';
import { makeItem, makeTestDb, makeUser, type TestDb } from './testing/db';
import { addVoiceNote, deleteVoiceNote, listVoiceNotes, MAX_VOICE_BYTES } from './voice';
import type { StorageAdapter } from '$lib/server/platform/types';

function memStorage(): StorageAdapter {
	const store = new Map<string, Uint8Array>();
	const adapter: StorageAdapter = {
		async mediaUrl(key) {
			return `/media/${key}`;
		},
		async put(key, data) {
			store.set(key, data as Uint8Array);
		},
		async get() {
			return null;
		},
		async head(key) {
			return store.has(key)
				? { size: store.get(key)!.byteLength, contentType: 'audio/webm' }
				: null;
		},
		async delete(key) {
			store.delete(key);
		}
	};
	return adapter;
}

let db: TestDb;
let storage: StorageAdapter;
let owner: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
	db = makeTestDb();
	storage = memStorage();
	owner = await makeUser(db, { role: 'editor' });
});

describe('voice notes', () => {
	it('adds, lists (mine flag), and deletes own note', async () => {
		const item = await makeItem(db, { uploadedBy: owner.id });
		const note = await addVoiceNote(db, storage, owner.id, item.id, {
			data: new Uint8Array([1, 2, 3]),
			mime: 'audio/webm',
			duration: 4.2
		});
		expect(note.mine).toBe(true);
		expect(note.author).toBe(owner.username);

		const viewer = await makeUser(db, { role: 'user' });
		const asViewer = await listVoiceNotes(db, storage, item.id, viewer.id);
		expect(asViewer).toHaveLength(1);
		expect(asViewer[0].mine).toBe(false);

		await deleteVoiceNote(db, storage, owner.id, false, note.id);
		expect(await listVoiceNotes(db, storage, item.id, owner.id)).toHaveLength(0);
	});

	it("surfaces the author's avatar when they have uploaded one", async () => {
		const withAvatar = await makeUser(db, { role: 'user', avatarStorageKey: 'avatars/gran.webp' });
		const item = await makeItem(db, { uploadedBy: owner.id });
		const note = await addVoiceNote(db, storage, withAvatar.id, item.id, {
			data: new Uint8Array([1]),
			mime: 'audio/webm',
			duration: 1
		});
		expect(note.authorAvatarUrl).toBe('/media/avatars/gran.webp');
		expect(note.authorAccentColor).toBe(withAvatar.accentColor);

		const noAvatar = await makeUser(db, { role: 'user' });
		const plain = await addVoiceNote(db, storage, noAvatar.id, item.id, {
			data: new Uint8Array([2]),
			mime: 'audio/webm',
			duration: 1
		});
		expect(plain.authorAvatarUrl).toBeNull();
	});

	it('rejects oversized and unsupported audio', async () => {
		const item = await makeItem(db, { uploadedBy: owner.id });
		await expect(
			addVoiceNote(db, storage, owner.id, item.id, {
				data: new Uint8Array(MAX_VOICE_BYTES + 1),
				mime: 'audio/webm',
				duration: 1
			})
		).rejects.toMatchObject({ status: 400 });
		await expect(
			addVoiceNote(db, storage, owner.id, item.id, {
				data: new Uint8Array([1]),
				mime: 'application/pdf',
				duration: 1
			})
		).rejects.toMatchObject({ status: 400 });
	});

	it('forbids a non-author non-editor from deleting', async () => {
		const item = await makeItem(db, { uploadedBy: owner.id });
		const note = await addVoiceNote(db, storage, owner.id, item.id, {
			data: new Uint8Array([9]),
			mime: 'audio/webm',
			duration: 1
		});
		const other = await makeUser(db, { role: 'user' });
		await expect(deleteVoiceNote(db, storage, other.id, false, note.id)).rejects.toMatchObject({
			status: 403
		});
	});
});
