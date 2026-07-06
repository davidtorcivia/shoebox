import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureOwner } from '../e2e/helpers/auth';
import { FIXTURE_PNG, FIXTURE_PNG_2, FIXTURE_WEBM } from '../e2e/fixtures/generate';

test.describe.configure({ mode: 'serial' });

interface UploadOpts {
	fixturePath: string;
	mime: string;
	filename: string;
	title: string;
	type: 'photo' | 'video';
	width: number;
	height: number;
}

async function uploadViaApi(page: Page, opts: UploadOpts): Promise<string> {
	const bytes = await readFile(opts.fixturePath);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const init = await page.request.post('/api/upload/init', {
		data: { sha256, sizeBytes: bytes.length, mime: opts.mime, filename: opts.filename }
	});
	expect(init.ok()).toBe(true);

	const chunk = await page.request.put(`/api/upload/chunk?uploadId=${sha256}&index=0`, {
		data: Buffer.from(bytes),
		headers: { 'content-type': 'application/octet-stream' }
	});
	expect(chunk.ok()).toBe(true);

	const meta = {
		type: opts.type,
		width: opts.width,
		height: opts.height,
		duration: opts.type === 'video' ? 1 : null,
		title: opts.title,
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
			blurhash: 'LKO2?U%2Tw',
			poster: { name: 'poster.webp', mimeType: 'image/webp', buffer: Buffer.from([1, 2, 3]) },
			thumb_400: { name: 'thumb_400.webp', mimeType: 'image/webp', buffer: Buffer.from([4]) },
			thumb_800: { name: 'thumb_800.webp', mimeType: 'image/webp', buffer: Buffer.from([5]) },
			thumb_1600: { name: 'thumb_1600.webp', mimeType: 'image/webp', buffer: Buffer.from([6]) }
		}
	});
	expect(complete.status()).toBe(201);
	const body = (await complete.json()) as { item: { id: string } };
	return body.item.id;
}

test('empty D1 reaches setup and the owner is created', async ({ page }) => {
	await page.goto('/');
	// Fresh local D1 sends unauthenticated traffic to an auth page; ensureOwner
	// tolerates either setup (fresh) or login (owner from a partial prior attempt).
	await expect(page).toHaveURL(/\/(setup|login)$/);
	await ensureOwner(page);
});

test('Cloudflare hides worker-only features', async ({ page }) => {
	await ensureOwner(page);
	const nav = page.getByRole('navigation', { name: 'Primary' });
	await expect(nav.getByRole('link', { name: 'Arrivals' })).toHaveCount(0);

	const arrivals = await page.goto('/arrivals');
	// No Arrivals UI renders on the Cloudflare target (no ingestion worker).
	await expect(page.getByTestId('arrivals-row')).toHaveCount(0);
	expect(arrivals?.status()).toBeGreaterThanOrEqual(400);

	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Faces' })).toHaveCount(0);
});

test('photo upload creates an item visible on the 1994 timeline and item page', async ({
	page
}) => {
	await ensureOwner(page);
	const id = await uploadViaApi(page, {
		fixturePath: FIXTURE_PNG,
		mime: 'image/png',
		filename: 'lake.png',
		title: 'Lake afternoon',
		type: 'photo',
		width: 640,
		height: 480
	});
	expect(id).toBeTruthy();

	await page.goto('/?y=1994');
	await expect(page.getByRole('button', { name: 'Open Lake afternoon' })).toBeVisible();

	await page.goto(`/item/${id}`);
	await expect(page.getByText('June 14, 1994')).toBeVisible();
});

test('search finds the uploaded photo by title', async ({ page }) => {
	await ensureOwner(page);
	await page.goto('/search?q=Lake');
	await expect(page.getByRole('button', { name: 'Open Lake afternoon' })).toBeVisible();
});

test('video upload creates a client-postered item with a player', async ({ page }) => {
	await ensureOwner(page);
	const id = await uploadViaApi(page, {
		fixturePath: FIXTURE_WEBM,
		mime: 'video/webm',
		filename: 'sprinkler.webm',
		title: 'Sprinkler run',
		type: 'video',
		width: 320,
		height: 180
	});

	await page.goto('/?y=1994');
	await expect(page.getByRole('button', { name: 'Open Sprinkler run' })).toBeVisible();

	await page.goto(`/item/${id}`);
	await expect(page.locator('video')).toHaveCount(1);
});

test('media streams by byte range without a redirect loop', async ({ page }) => {
	await ensureOwner(page);
	const id = await uploadViaApi(page, {
		fixturePath: FIXTURE_PNG_2,
		mime: 'image/png',
		filename: 'range.png',
		title: 'Range probe',
		type: 'photo',
		width: 640,
		height: 480
	});
	const thumbUrl = `/media/media/${id}/thumb_400.webp`;

	const ranged = await page.request.get(thumbUrl, { headers: { range: 'bytes=0-0' } });
	expect(ranged.status()).toBe(206);
	expect(ranged.headers()['content-range']).toMatch(/^bytes 0-0\//);

	// When presign secrets are configured the same asset redirects to a signed R2 URL.
	if (
		process.env.R2_ACCOUNT_ID &&
		process.env.R2_ACCESS_KEY_ID &&
		process.env.R2_SECRET_ACCESS_KEY &&
		process.env.R2_BUCKET_NAME
	) {
		const redirected = await page.request.get(thumbUrl, { maxRedirects: 0 });
		expect(redirected.status()).toBe(302);
		expect(redirected.headers()['location']).toContain('.r2.cloudflarestorage.com');
	}
});
