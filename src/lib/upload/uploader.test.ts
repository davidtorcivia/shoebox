import { describe, expect, it } from 'vitest';
import {
	apiCompleteUpload,
	apiInitUpload,
	chunkBytes,
	uploadChunks,
	type InitResponse
} from './uploader';

describe('apiInitUpload', () => {
	it('posts json and returns the init response', async () => {
		const fetchFn = async (url: RequestInfo | URL, init?: RequestInit) => {
			expect(String(url)).toBe('/api/upload/init');
			expect(init?.method).toBe('POST');
			return Response.json({
				uploadId: 'u1',
				chunkSize: 4,
				totalChunks: 1,
				receivedChunks: [],
				duplicateItemId: null
			});
		};
		await expect(
			apiInitUpload(
				{ sha256: 'a'.repeat(64), sizeBytes: 1, mime: 'video/mp4', filename: 'x' },
				fetchFn as typeof fetch
			)
		).resolves.toMatchObject({ uploadId: 'u1' });
	});
});

describe('uploadChunks', () => {
	it('skips received chunks and reports progress', async () => {
		const calls: string[] = [];
		const progress: number[] = [];
		const file = new Blob([new Uint8Array(10)]);
		const init: InitResponse = {
			uploadId: 'u1',
			chunkSize: 4,
			totalChunks: 3,
			receivedChunks: [1],
			duplicateItemId: null
		};
		const fetchFn = async (url: RequestInfo | URL) => {
			calls.push(String(url));
			return Response.json({ received: true });
		};

		await uploadChunks(file, init, (sent) => progress.push(sent), fetchFn as typeof fetch);

		expect(calls).toEqual([
			'/api/upload/chunk?uploadId=u1&index=0',
			'/api/upload/chunk?uploadId=u1&index=2'
		]);
		expect(progress).toEqual([4, 8, 10]);
	});
});

describe('apiCompleteUpload', () => {
	it('posts multipart form data', async () => {
		const fetchFn = async (url: RequestInfo | URL, init?: RequestInit) => {
			expect(String(url)).toBe('/api/upload/complete');
			expect(init?.method).toBe('POST');
			expect(init?.body).toBeInstanceOf(FormData);
			return Response.json({ item: { id: 'i1' } });
		};

		const res = await apiCompleteUpload(
			{
				uploadId: 'u1',
				allowDuplicate: false,
				meta: {
					type: 'photo',
					width: 1,
					height: 1,
					duration: null,
					title: null,
					description: null,
					tapeLabel: null,
					date: { dateStart: null, dateEnd: null, precision: 'unknown' },
					people: [],
					tags: []
				},
				blurhash: null,
				derivatives: {
					poster: new Blob(),
					thumb_400: new Blob(),
					thumb_800: new Blob(),
					thumb_1600: new Blob()
				}
			},
			fetchFn as typeof fetch
		);
		expect(res.item.id).toBe('i1');
	});
});

describe('chunkBytes', () => {
	it('returns the last partial chunk size', () => {
		expect(chunkBytes(10, 4, 2)).toBe(2);
	});
});
