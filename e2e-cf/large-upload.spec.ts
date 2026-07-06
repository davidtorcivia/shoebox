import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const CHUNK = 8 * 1024 * 1024;
const TOTAL_CHUNKS = 15; // 120 MiB
const SIZE = CHUNK * TOTAL_CHUNKS;

// Deterministic per-chunk byte pattern so the sha256 pass and the upload pass
// agree without ever holding two full copies in memory.
function makeChunk(index: number): Buffer {
	const buf = Buffer.alloc(CHUNK);
	for (let j = 0; j < CHUNK; j += 1) buf[j] = (index * 7 + j) & 0xff;
	return buf;
}

async function sha256OfStream(): Promise<string> {
	const hash = createHash('sha256');
	for (let i = 0; i < TOTAL_CHUNKS; i += 1) hash.update(makeChunk(i));
	return hash.digest('hex');
}

async function uploadLargeOriginal(page: Page, sha256: string): Promise<void> {
	for (let i = 0; i < TOTAL_CHUNKS; i += 1) {
		const res = await page.request.put(`/api/upload/chunk?uploadId=${sha256}&index=${i}`, {
			data: makeChunk(i),
			headers: { 'content-type': 'application/octet-stream' },
			timeout: 120_000
		});
		expect(res.ok()).toBe(true);
	}
}

test.describe(() => {
	test.skip(!process.env.SHOEBOX_LARGE_UPLOAD, 'opt-in: SHOEBOX_LARGE_UPLOAD=1');

	test('120 MiB upload streams back via byte range on the Cloudflare target', async ({ page }) => {
		await page.goto('/');
		// Authenticate (the global fresh-D1 redirect surfaces /setup if needed).
		if (page.url().includes('/setup')) {
			const { OWNER } = await import('../e2e/helpers/auth');
			await page.getByLabel('Username').fill(OWNER.username);
			await page.getByLabel('Password').fill(OWNER.password);
			await page.getByRole('button', { name: 'Create owner' }).click();
			await page.waitForURL('/');
		}

		const sha256 = await sha256OfStream();
		const init = await page.request.post('/api/upload/init', {
			data: { sha256, sizeBytes: SIZE, mime: 'video/webm', filename: 'large.webm' }
		});
		expect(init.ok()).toBe(true);

		await uploadLargeOriginal(page, sha256);

		const meta = {
			type: 'video',
			width: 320,
			height: 180,
			duration: 60,
			title: 'Large upload probe',
			description: null,
			tapeLabel: null,
			date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
			people: [],
			tags: []
		};
		const complete = await page.request.post('/api/upload/complete', {
			headers: { origin: 'http://127.0.0.1:8788' },
			multipart: {
				uploadId: sha256,
				allowDuplicate: 'false',
				meta: JSON.stringify(meta),
				blurhash: null,
				poster: { name: 'poster.webp', mimeType: 'image/webp', buffer: Buffer.from([1, 2, 3]) },
				thumb_400: { name: 'thumb_400.webp', mimeType: 'image/webp', buffer: Buffer.from([4]) },
				thumb_800: { name: 'thumb_800.webp', mimeType: 'image/webp', buffer: Buffer.from([5]) },
				thumb_1600: { name: 'thumb_1600.webp', mimeType: 'image/webp', buffer: Buffer.from([6]) }
			},
			timeout: 120_000
		});
		expect(complete.status()).toBe(201);
		const { item } = (await complete.json()) as {
			item: { id: string; urls: { original: string } };
		};

		const detail = await page.request.get(`/api/items/${item.id}`);
		expect(detail.status()).toBe(200);

		const ranged = await page.request.get(item.urls.original, {
			headers: { range: 'bytes=0-0' },
			maxRedirects: 0
		});
		expect([206, 302]).toContain(ranged.status());
	});
});
