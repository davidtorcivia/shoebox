import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from './types';

const BODY = new TextEncoder().encode('shoebox-contract-body-0123456789');

export function runStorageContract(name: string, factory: () => Promise<StorageAdapter>): void {
	describe(`StorageAdapter contract: ${name}`, () => {
		it('put + get round-trips bytes, size and contentType', async () => {
			const storage = await factory();
			await storage.put('media/test/original.webp', BODY, { contentType: 'image/webp' });
			const got = await storage.get('media/test/original.webp');
			expect(got).not.toBeNull();
			const bytes = new Uint8Array(await new Response(got!.stream).arrayBuffer());
			expect(bytes).toEqual(BODY);
			expect(got!.size).toBe(BODY.length);
			expect(got!.contentType).toBe('image/webp');
		});

		it('get honors byte ranges (inclusive end) and still reports total size', async () => {
			const storage = await factory();
			await storage.put('media/test/range.webp', BODY, { contentType: 'image/webp' });
			const got = await storage.get('media/test/range.webp', { start: 8, end: 15 });
			const bytes = new Uint8Array(await new Response(got!.stream).arrayBuffer());
			expect(bytes).toEqual(BODY.slice(8, 16));
			expect(got!.size).toBe(BODY.length);
		});

		it('get with an open-ended range reads to the end', async () => {
			const storage = await factory();
			await storage.put('media/test/tail.webp', BODY, { contentType: 'image/webp' });
			const got = await storage.get('media/test/tail.webp', { start: BODY.length - 4 });
			const bytes = new Uint8Array(await new Response(got!.stream).arrayBuffer());
			expect(bytes).toEqual(BODY.slice(BODY.length - 4));
		});

		it('head reports size and contentType; missing keys are null', async () => {
			const storage = await factory();
			await storage.put('media/test/head.webp', BODY, { contentType: 'image/webp' });
			expect(await storage.head('media/test/head.webp')).toEqual({
				size: BODY.length,
				contentType: 'image/webp'
			});
			expect(await storage.head('media/test/missing.webp')).toBeNull();
			expect(await storage.get('media/test/missing.webp')).toBeNull();
		});

		it('delete removes the object and is idempotent', async () => {
			const storage = await factory();
			await storage.put('media/test/gone.webp', BODY, { contentType: 'image/webp' });
			await storage.delete('media/test/gone.webp');
			expect(await storage.head('media/test/gone.webp')).toBeNull();
			await storage.delete('media/test/gone.webp');
		});

		it('put accepts a ReadableStream body', async () => {
			const storage = await factory();
			const stream = new Response(BODY).body!;
			await storage.put('media/test/stream.webp', stream, {
				contentType: 'image/webp',
				sizeHint: BODY.length
			});
			const got = await storage.get('media/test/stream.webp');
			expect(got!.size).toBe(BODY.length);
		});

		it('mediaUrl contains the key', async () => {
			const storage = await factory();
			expect(await storage.mediaUrl('media/test/original.webp')).toContain(
				'media/test/original.webp'
			);
		});
	});
}
