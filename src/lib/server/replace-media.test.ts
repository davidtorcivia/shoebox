import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { makeItem, makePerson, makeTestDb, makeUser, stubStorage } from '$lib/server/testing/db';
import { MemoryQueue, MemoryStorage } from '$lib/server/testing/memory-platform';
import { replaceCandidatesFor, replaceItemMedia } from './replace-media';

async function seedPair(db: ReturnType<typeof makeTestDb>, storage: MemoryStorage) {
	const owner = await makeUser(db);
	await makeItem(db, {
		id: 'target',
		uploadedBy: owner.id,
		status: 'ready',
		type: 'video',
		title: 'Christmas Morning',
		ingestName: 'christmas-morning.mp4',
		sha256: 'a'.repeat(64),
		captureTime: '1995-12-25T09:00:00'
	});
	await makeItem(db, {
		id: 'arrival',
		uploadedBy: owner.id,
		status: 'needs_review',
		type: 'video',
		ingestName: 'christmas-morning.mp4',
		sha256: 'b'.repeat(64),
		width: 720,
		height: 480,
		sizeBytes: 999
	});
	await db.insert(schema.itemFiles).values([
		{
			id: 'f-target',
			itemId: 'target',
			kind: 'original',
			storageKey: 'media/target/original.mp4',
			mime: 'video/mp4',
			width: 720,
			height: 480
		},
		{
			id: 'f-arrival',
			itemId: 'arrival',
			kind: 'original',
			storageKey: 'media/arrival/original.mp4',
			mime: 'video/mp4',
			width: 720,
			height: 480
		}
	]);
	await storage.put('media/target/original.mp4', new TextEncoder().encode('old-bytes'), {
		contentType: 'video/mp4'
	});
	await storage.put('media/arrival/original.mp4', new TextEncoder().encode('new-bytes'), {
		contentType: 'video/mp4'
	});
	return { owner };
}

describe('replaceCandidatesFor', () => {
	it('matches by ingest name, and by derived title for legacy items', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await makeItem(db, {
			id: 'named',
			uploadedBy: owner.id,
			status: 'ready',
			type: 'video',
			ingestName: 'tape-04.mp4'
		});
		await makeItem(db, {
			id: 'legacy',
			uploadedBy: owner.id,
			status: 'ready',
			type: 'video',
			title: 'sprinkler day',
			ingestName: null
		});
		await makeItem(db, {
			id: 'q1',
			uploadedBy: owner.id,
			status: 'needs_review',
			type: 'video',
			ingestName: 'tape-04.mp4'
		});
		await makeItem(db, {
			id: 'q2',
			uploadedBy: owner.id,
			status: 'needs_review',
			type: 'video',
			ingestName: 'sprinkler_day.mp4'
		});
		await makeItem(db, {
			id: 'q3',
			uploadedBy: owner.id,
			status: 'needs_review',
			type: 'video',
			ingestName: 'brand-new.mp4'
		});

		const out = await replaceCandidatesFor(db, stubStorage, [
			{ id: 'q1', type: 'video', ingestName: 'tape-04.mp4' },
			{ id: 'q2', type: 'video', ingestName: 'sprinkler_day.mp4' },
			{ id: 'q3', type: 'video', ingestName: 'brand-new.mp4' },
			{ id: 'q4', type: 'video', ingestName: null }
		]);

		expect(out.q1?.id).toBe('named');
		expect(out.q2?.id).toBe('legacy');
		expect(out.q3).toBeUndefined();
		expect(out.q4).toBeUndefined();
	});
});

describe('replaceItemMedia', () => {
	it('swaps the master, keeps curation, requeues derivatives, purges the arrival', async () => {
		const db = makeTestDb();
		const storage = new MemoryStorage();
		const queue = new MemoryQueue();
		await seedPair(db, storage);
		const person = await makePerson(db);
		await db
			.insert(schema.itemPeople)
			.values({ itemId: 'target', personId: person.id, source: 'manual' });

		await replaceItemMedia(db, storage, queue, 'target', 'arrival', { faces: true });

		const target = (await db.select().from(schema.items).where(eq(schema.items.id, 'target')))[0];
		expect(target.sha256).toBe('b'.repeat(64));
		expect(target.sizeBytes).toBe(999);
		expect(target.title).toBe('Christmas Morning');
		expect(target.captureTime).toBe('1995-12-25T09:00:00');
		expect(target.status).toBe('ready');

		// The new bytes live under the target's key; the arrival is fully purged.
		const swapped = await storage.get('media/target/original.mp4');
		expect(new TextDecoder().decode(await readAll(swapped!.stream))).toBe('new-bytes');
		expect(await storage.head('media/arrival/original.mp4')).toBeNull();
		expect(await db.select().from(schema.items).where(eq(schema.items.id, 'arrival'))).toEqual([]);

		// Person tag untouched; every derivative job requeued including faces.
		expect(await db.select().from(schema.itemPeople)).toHaveLength(1);
		const kinds = queue.enqueued.map((job) => job.kind).sort();
		expect(kinds).toEqual(['derivatives', 'face_scan', 'hls', 'sprite', 'transcode']);
	});

	it('refuses type mismatches and non-arrival sources', async () => {
		const db = makeTestDb();
		const storage = new MemoryStorage();
		const queue = new MemoryQueue();
		await seedPair(db, storage);
		await db.update(schema.items).set({ status: 'ready' }).where(eq(schema.items.id, 'arrival'));
		await expect(replaceItemMedia(db, storage, queue, 'target', 'arrival')).rejects.toMatchObject({
			status: 400
		});
	});
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
