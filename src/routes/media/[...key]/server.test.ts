import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from '$lib/server/platform/types';
import { GET } from './+server';

function chunkStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
			controller.close();
		}
	});
}

function storageWith(contentType: string, size = 100): StorageAdapter {
	return {
		put: vi.fn(),
		get: vi.fn(async () => ({ stream: chunkStream(), size, contentType })),
		head: vi.fn(async () => ({ size, contentType })),
		delete: vi.fn(),
		mediaUrl: vi.fn(async (key: string) => `/media/${key}`)
	};
}

function event(
	user: { id: string } | null,
	key: string,
	contentType: string,
	init: { range?: string } = {}
) {
	return {
		locals: {
			db: undefined as never,
			user,
			platform: { storage: storageWith(contentType) },
			shareTokens: [] as string[]
		},
		params: { key },
		url: new URL(`http://test/media/${key}`),
		request: new Request(`http://test/media/${key}`, {
			headers: init.range ? { range: init.range } : undefined
		})
	} as never;
}

const sessionUser = { id: 'u_me' } as never;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /media/[...key]', () => {
	it('denies anonymous requests with no share', async () => {
		try {
			await GET(event(null, 'media/it_1/thumb_800.webp', 'image/webp'));
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(isHttpError(e)).toBe(true);
			expect((e as { status: number }).status).toBe(403);
		}
	});

	it('sets nosniff and clamps an executable content-type to octet-stream', async () => {
		const res = await GET(event(sessionUser, 'media/it_1/evil.html', 'text/html'));
		expect(res.status).toBe(200);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
	});

	it('neutralizes SVG so it cannot execute as a top-level document', async () => {
		const res = await GET(event(sessionUser, 'media/it_1/x.svg', 'image/svg+xml'));
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('preserves a safe raster image content-type', async () => {
		const res = await GET(event(sessionUser, 'media/it_1/thumb_800.webp', 'image/webp'));
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('streams a 206 partial response for a byte range', async () => {
		const res = await GET(
			event(sessionUser, 'media/it_1/thumb_800.webp', 'image/webp', { range: 'bytes=0-9' })
		);
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 0-9/100');
		expect(res.headers.get('content-length')).toBe('10');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.body).not.toBeNull();
	});
});
