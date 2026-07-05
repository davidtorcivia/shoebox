import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { items } from '$lib/server/db/schema';
import { findDuplicate } from './dedupe';
import {
	CHUNK_SIZE,
	chunkKey,
	expectedChunkSize,
	initUpload,
	readManifest,
	saveChunk
} from './upload';
import { memoryDb, seedUser } from './testing/memory-db';
import { MemoryStorage } from './testing/memory-platform';

type Db = App.Locals['db'];

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

let db: Db;
let storage: MemoryStorage;
let userId: string;

async function insertItemWithSha(sha256: string, deletedAt: Date | null = null): Promise<string> {
	const id = nanoid(12);
	await db.insert(items).values({
		id,
		type: 'video',
		datePrecision: 'unknown',
		width: 192,
		height: 108,
		sizeBytes: 10,
		sha256,
		source: 'upload',
		status: 'needs_review',
		uploadedBy: userId,
		deletedAt,
		createdAt: new Date()
	});
	return id;
}

beforeEach(async () => {
	db = memoryDb();
	storage = new MemoryStorage();
	userId = (await seedUser(db)).id;
});

describe('findDuplicate', () => {
	it('matches the exact sha and ignores trashed items', async () => {
		expect(await findDuplicate(db, SHA)).toBeNull();
		const id = await insertItemWithSha(SHA);
		expect(await findDuplicate(db, SHA)).toEqual({ itemId: id });
		await insertItemWithSha(SHA_B, new Date());
		expect(await findDuplicate(db, SHA_B)).toBeNull();
	});
});

describe('initUpload', () => {
	const input = { sha256: SHA, sizeBytes: 20, mime: 'video/mp4', filename: 'clip.mp4' };

	it('rejects bad input with 400', async () => {
		for (const bad of [
			{ ...input, sha256: 'nothex' },
			{ ...input, sizeBytes: 0 },
			{ ...input, sizeBytes: 1.5 },
			{ ...input, mime: 'application/zip' },
			{ ...input, filename: '' }
		]) {
			await expect(initUpload(db, storage, userId, bad)).rejects.toMatchObject({ status: 400 });
		}
	});

	it('creates a manifest keyed by sha256 and reports chunk plan', async () => {
		const res = await initUpload(db, storage, userId, input);
		expect(res).toEqual({
			uploadId: SHA,
			chunkSize: CHUNK_SIZE,
			totalChunks: 1,
			receivedChunks: [],
			duplicateItemId: null
		});
		const manifest = await readManifest(storage, SHA);
		expect(manifest).toMatchObject({
			sha256: SHA,
			sizeBytes: 20,
			mime: 'video/mp4',
			filename: 'clip.mp4',
			chunkSize: CHUNK_SIZE,
			totalChunks: 1,
			createdBy: userId
		});
	});

	it('computes multi-chunk plans', async () => {
		const res = await initUpload(db, storage, userId, {
			...input,
			sizeBytes: CHUNK_SIZE * 2 + 5
		});
		expect(res.totalChunks).toBe(3);
		expect(expectedChunkSize(CHUNK_SIZE * 2 + 5, 2, CHUNK_SIZE)).toBe(5);
	});

	it('reports the duplicate item id', async () => {
		const id = await insertItemWithSha(SHA);
		const res = await initUpload(db, storage, userId, input);
		expect(res.duplicateItemId).toBe(id);
	});

	it('re-init reports already-received chunks', async () => {
		await initUpload(db, storage, userId, input);
		await saveChunk(storage, SHA, 0, new Uint8Array(20));
		const again = await initUpload(db, storage, userId, input);
		expect(again.receivedChunks).toEqual([0]);
	});
});

describe('saveChunk', () => {
	it('validates uploadId, index and exact chunk size', async () => {
		await expect(saveChunk(storage, SHA, 0, new Uint8Array(1))).rejects.toMatchObject({
			status: 404
		});
		await initUpload(db, storage, userId, {
			sha256: SHA,
			sizeBytes: 20,
			mime: 'video/mp4',
			filename: 'c.mp4'
		});
		await expect(saveChunk(storage, SHA, 1, new Uint8Array(20))).rejects.toMatchObject({
			status: 400
		});
		await expect(saveChunk(storage, SHA, 0, new Uint8Array(19))).rejects.toMatchObject({
			status: 400
		});
		expect(await saveChunk(storage, SHA, 0, new Uint8Array(20))).toEqual({ received: true });
		expect((await storage.head(chunkKey(SHA, 0)))!.size).toBe(20);
	});
});

