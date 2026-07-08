import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { itemFiles, items, items as itemsTable } from '$lib/server/db/schema';
import type { UploadMeta } from '$lib/types';
import { findDuplicate } from './dedupe';
import {
	CHUNK_SIZE,
	chunkKey,
	completeUpload,
	expectedChunkSize,
	initUpload,
	MAX_DERIVATIVE_BYTES,
	MAX_UPLOAD_BYTES,
	readManifest,
	saveChunk,
	validateUploadMeta
} from './upload';
import { memoryDb, seedUser } from './testing/memory-db';
import { MemoryQueue, MemoryStorage } from './testing/memory-platform';

type Db = App.Locals['db'];

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

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
			{ ...input, filename: '' },
			{ ...input, sizeBytes: MAX_UPLOAD_BYTES + 1 },
			{ ...input, filename: 'x'.repeat(256) }
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
	it('uses the 8 MiB contract chunk size', () => {
		expect(CHUNK_SIZE).toBe(8 * 1024 * 1024);
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

describe('completeUpload', () => {
	const queue = () => new MemoryQueue();

	function meta(over: Partial<UploadMeta> = {}): UploadMeta {
		return {
			type: 'video',
			width: 192,
			height: 108,
			duration: 1,
			title: 'Tiny clip',
			description: null,
			tapeLabel: null,
			date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
			people: [],
			tags: [],
			...over
		};
	}

	const webp = (n: number) => ({ data: new Uint8Array(n).fill(7), mime: 'image/webp' });

	const sniffVideo = async (): Promise<{ mime: string }> => ({ mime: 'video/mp4' });

	function derivatives() {
		return {
			poster: webp(40),
			thumb_400: webp(10),
			thumb_800: webp(20),
			thumb_1600: webp(30)
		};
	}

	async function uploadAll(bytes: Uint8Array, sha: string) {
		const user = await seedUser(db, {
			id: `u_${sha.slice(0, 4)}`,
			username: `up_${sha.slice(0, 4)}`
		});
		const init = await initUpload(db, storage, user.id, {
			sha256: sha,
			sizeBytes: bytes.length,
			mime: 'video/mp4',
			filename: 'tiny.mp4'
		});
		await saveChunk(storage, init.uploadId, 0, bytes);
		return { user, uploadId: init.uploadId };
	}

	it('assembles chunks into media/<itemId>/original.<ext> and creates the item', async () => {
		const bytes = new Uint8Array(24).map((_, i) => i);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		const q = queue();
		const dto = await completeUpload(
			db,
			storage,
			q,
			user,
			{
				uploadId,
				allowDuplicate: false,
				meta: meta(),
				blurhash: 'LKO2?U%2Tw',
				derivatives: derivatives()
			},
			sniffVideo
		);

		// Uploads land in arrivals for review before reaching the timeline.
		expect(dto.status).toBe('needs_review');
		expect(dto.urls.original).toBe(`/media/media/${dto.id}/original.mp4`);
		const stored = await storage.get(`media/${dto.id}/original.mp4`);
		expect(new Uint8Array(await new Response(stored!.stream).arrayBuffer())).toEqual(bytes);
		for (const key of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600']) {
			expect(await storage.head(`media/${dto.id}/${key}.webp`)).not.toBeNull();
		}
		const t400 = (await db.select().from(itemFiles).where(eq(itemFiles.itemId, dto.id))).find(
			(file) => file.kind === 'thumb_400'
		);
		expect([t400!.width, t400!.height]).toEqual([192, 108]);
		expect(await storage.head(`tmp/${uploadId}/manifest.json`)).toBeNull();
		expect(await storage.head(`tmp/${uploadId}/0`)).toBeNull();
		expect(q.enqueued.map((job) => job.kind)).toEqual([
			'derivatives',
			'sprite',
			'transcode',
			'hls'
		]);
	});

	it('accepts a photo with no client derivatives (HEIC/RAW) and defers to the worker', async () => {
		// HEIC bytes the browser could not decode: only the original is uploaded.
		const heic = new TextEncoder().encode('fake-heic-bytes');
		const user = await seedUser(db, { id: 'u_heic', username: 'heic' });
		const init = await initUpload(db, storage, user.id, {
			sha256: SHA_C,
			sizeBytes: heic.length,
			mime: 'image/heic',
			filename: 'IMG_0001.heic'
		});
		await saveChunk(storage, init.uploadId, 0, heic);
		const q = queue();
		const dto = await completeUpload(
			db,
			storage,
			q,
			user,
			{
				uploadId: init.uploadId,
				allowDuplicate: false,
				meta: meta({ type: 'photo', duration: null }),
				blurhash: null,
				derivatives: {}
			},
			async () => ({ mime: 'image/heic' })
		);

		expect(dto.status).toBe('needs_review');
		expect(dto.originalWebSafe).toBe(false);
		expect(await storage.head(`media/${dto.id}/original.heic`)).not.toBeNull();
		// No client thumbnails were stored; the worker builds them.
		for (const key of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600']) {
			expect(await storage.head(`media/${dto.id}/${key}.webp`)).toBeNull();
		}
		expect(q.enqueued.map((job) => job.kind)).toEqual(['derivatives']);
	});

	it('multi-chunk assembly preserves byte order', async () => {
		const user = await seedUser(db, { id: 'u_mc', username: 'mc' });
		const manifest = {
			sha256: SHA_B,
			sizeBytes: 10,
			mime: 'video/mp4',
			filename: 't.mp4',
			chunkSize: 4,
			totalChunks: 3,
			createdBy: user.id,
			createdAt: new Date().toISOString()
		};
		await storage.put(
			`tmp/${SHA_B}/manifest.json`,
			new TextEncoder().encode(JSON.stringify(manifest)),
			{ contentType: 'application/json' }
		);
		await saveChunk(storage, SHA_B, 0, new Uint8Array([0, 1, 2, 3]));
		await saveChunk(storage, SHA_B, 1, new Uint8Array([4, 5, 6, 7]));
		await saveChunk(storage, SHA_B, 2, new Uint8Array([8, 9]));
		const dto = await completeUpload(
			db,
			storage,
			queue(),
			user,
			{
				uploadId: SHA_B,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			},
			sniffVideo
		);
		const stored = await storage.get(`media/${dto.id}/original.mp4`);
		expect(new Uint8Array(await new Response(stored!.stream).arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
		);
	});

	it('409s when chunks are missing', async () => {
		const user = await seedUser(db, { id: 'u_ms', username: 'ms' });
		await initUpload(db, storage, user.id, {
			sha256: SHA,
			sizeBytes: 20,
			mime: 'video/mp4',
			filename: 'c.mp4'
		});
		await expect(
			completeUpload(db, storage, queue(), user, {
				uploadId: SHA,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			})
		).rejects.toMatchObject({ status: 409 });
	});

	it('409s on duplicate unless allowDuplicate, then stores the same true sha twice', async () => {
		const bytes = new Uint8Array(24).fill(1);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		const first = await completeUpload(
			db,
			storage,
			queue(),
			user,
			{
				uploadId,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			},
			sniffVideo
		);
		const init2 = await initUpload(db, storage, user.id, {
			sha256: SHA,
			sizeBytes: bytes.length,
			mime: 'video/mp4',
			filename: 'tiny.mp4'
		});
		expect(init2.duplicateItemId).toBe(first.id);
		await saveChunk(storage, uploadId, 0, bytes);
		await expect(
			completeUpload(db, storage, queue(), user, {
				uploadId,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			})
		).rejects.toMatchObject({ status: 409 });
		const second = await completeUpload(
			db,
			storage,
			queue(),
			user,
			{
				uploadId,
				allowDuplicate: true,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			},
			sniffVideo
		);
		const rows = await db.select().from(itemsTable).where(eq(itemsTable.sha256, SHA));
		expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
	});

	it('rejects meta whose type contradicts the uploaded mime', async () => {
		const bytes = new Uint8Array(8).fill(2);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		await expect(
			completeUpload(
				db,
				storage,
				queue(),
				user,
				{
					uploadId,
					allowDuplicate: false,
					meta: meta({ type: 'photo' }),
					blurhash: null,
					derivatives: derivatives()
				},
				sniffVideo
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects non-media content even when the declared mime is allowed', async () => {
		const bytes = new Uint8Array(32).map((_, i) => i); // not real media bytes
		const { user, uploadId } = await uploadAll(bytes, SHA);
		await expect(
			completeUpload(db, storage, queue(), user, {
				uploadId,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			})
		).rejects.toMatchObject({ status: 400 });
		expect((await db.select().from(itemsTable)).length).toBe(0);
	});

	it('trusts the sniffed type over the client-declared mime', async () => {
		const bytes = new Uint8Array(16);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		const dto = await completeUpload(
			db,
			storage,
			queue(),
			user,
			{
				uploadId,
				allowDuplicate: false,
				meta: meta(),
				blurhash: null,
				derivatives: derivatives()
			},
			async () => ({ mime: 'video/quicktime' })
		);
		expect(dto.urls.original).toBe(`/media/media/${dto.id}/original.mov`);
		const original = (await db.select().from(itemFiles).where(eq(itemFiles.itemId, dto.id))).find(
			(f) => f.kind === 'original'
		);
		expect(original!.mime).toBe('video/quicktime');
	});

	it('rejects an oversized derivative before storing the original', async () => {
		const bytes = new Uint8Array(8);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		const tooBig = { data: new Uint8Array(MAX_DERIVATIVE_BYTES + 1), mime: 'image/webp' };
		await expect(
			completeUpload(
				db,
				storage,
				queue(),
				user,
				{
					uploadId,
					allowDuplicate: false,
					meta: meta(),
					blurhash: null,
					derivatives: {
						poster: tooBig,
						thumb_400: webp(10),
						thumb_800: webp(20),
						thumb_1600: webp(30)
					}
				},
				sniffVideo
			)
		).rejects.toMatchObject({ status: 400 });
		expect((await db.select().from(itemsTable)).length).toBe(0);
	});

	it('forbids a different user from completing the upload', async () => {
		const bytes = new Uint8Array(8);
		const { uploadId } = await uploadAll(bytes, SHA);
		const other = await seedUser(db, { id: 'u_other', username: 'other' });
		await expect(
			completeUpload(
				db,
				storage,
				queue(),
				other,
				{
					uploadId,
					allowDuplicate: false,
					meta: meta(),
					blurhash: null,
					derivatives: derivatives()
				},
				sniffVideo
			)
		).rejects.toMatchObject({ status: 403 });
	});

	it('serializes concurrent same-sha completions so exactly one wins', async () => {
		const bytes = new Uint8Array(12);
		const { user, uploadId } = await uploadAll(bytes, SHA);
		const results = await Promise.allSettled([
			completeUpload(
				db,
				storage,
				queue(),
				user,
				{
					uploadId,
					allowDuplicate: false,
					meta: meta(),
					blurhash: null,
					derivatives: derivatives()
				},
				sniffVideo
			),
			completeUpload(
				db,
				storage,
				queue(),
				user,
				{
					uploadId,
					allowDuplicate: false,
					meta: meta(),
					blurhash: null,
					derivatives: derivatives()
				},
				sniffVideo
			)
		]);
		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(fulfilled.length).toBe(1);
		expect(rejected.length).toBe(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
	});
});

describe('validateUploadMeta', () => {
	const good = {
		type: 'photo',
		width: 640,
		height: 480,
		duration: null,
		title: ' Hello ',
		description: null,
		tapeLabel: null,
		date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
		people: [],
		tags: ['xmas']
	};

	it('normalizes strings and passes valid meta', () => {
		const meta = validateUploadMeta(good);
		expect(meta.title).toBe('Hello');
		expect(meta.tags).toEqual(['xmas']);
	});

	it('rejects invalid payloads with 400', () => {
		for (const bad of [
			null,
			{ ...good, type: 'gif' },
			{ ...good, width: 0 },
			{ ...good, height: -5 },
			{ ...good, duration: -1 },
			{
				...good,
				date: { dateStart: '1994-06-14', dateEnd: '1994-06-15', precision: 'day' }
			},
			{ ...good, date: undefined }
		]) {
			expect(() => validateUploadMeta(bad)).toThrow();
		}
	});
});
