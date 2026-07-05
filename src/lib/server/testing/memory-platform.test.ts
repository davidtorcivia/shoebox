import { describe, expect, it } from 'vitest';
import { users } from '$lib/server/db/schema';
import { memoryDb, seedPerson, seedUser } from './memory-db';
import { MemoryQueue, MemoryStorage } from './memory-platform';

describe('MemoryStorage', () => {
	it('put/head/get/delete roundtrip with Uint8Array', async () => {
		const storage = new MemoryStorage();
		const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

		await storage.put('media/x/original.mp4', data, { contentType: 'video/mp4' });

		expect(await storage.head('media/x/original.mp4')).toEqual({
			size: 10,
			contentType: 'video/mp4'
		});
		const got = await storage.get('media/x/original.mp4');
		expect(got).not.toBeNull();
		expect(new Uint8Array(await new Response(got!.stream).arrayBuffer())).toEqual(data);
		await storage.delete('media/x/original.mp4');
		expect(await storage.head('media/x/original.mp4')).toBeNull();
		expect(await storage.get('missing')).toBeNull();
	});

	it('accepts a ReadableStream body', async () => {
		const storage = new MemoryStorage();
		const stream = new Blob([new Uint8Array([9, 9, 9])]).stream();
		await storage.put('k', stream, { contentType: 'application/octet-stream', sizeHint: 3 });
		expect((await storage.head('k'))!.size).toBe(3);
	});

	it('serves inclusive byte ranges', async () => {
		const storage = new MemoryStorage();
		await storage.put('k', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
			contentType: 'x/y'
		});
		const ranged = await storage.get('k', { start: 2, end: 4 });
		expect(new Uint8Array(await new Response(ranged!.stream).arrayBuffer())).toEqual(
			new Uint8Array([2, 3, 4])
		);
		const openEnd = await storage.get('k', { start: 8 });
		expect(new Uint8Array(await new Response(openEnd!.stream).arrayBuffer())).toEqual(
			new Uint8Array([8, 9])
		);
		expect(ranged!.size).toBe(10);
	});

	it('mediaUrl follows the node contract', async () => {
		const storage = new MemoryStorage();
		expect(await storage.mediaUrl('media/abc/poster.webp')).toBe('/media/media/abc/poster.webp');
	});
});

describe('MemoryQueue', () => {
	it('records enqueued jobs', async () => {
		const queue = new MemoryQueue();
		await queue.enqueue('derivatives', { itemId: 'i1' });
		await queue.enqueue('sprite', { itemId: 'i1' });
		expect(queue.enqueued).toEqual([
			{ kind: 'derivatives', payload: { itemId: 'i1' } },
			{ kind: 'sprite', payload: { itemId: 'i1' } }
		]);
	});
});

describe('memoryDb', () => {
	it('runs migrations and seeds users/people', async () => {
		const db = memoryDb();
		const user = await seedUser(db, { role: 'uploader' });
		expect(user.role).toBe('uploader');
		const person = await seedPerson(db, { name: 'Mom' });
		expect(person.name).toBe('Mom');
		const rows = await db.select().from(users);
		expect(rows).toHaveLength(1);
	});
});

