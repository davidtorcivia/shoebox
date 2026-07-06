import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureOwner } from './helpers/auth';
import { FIXTURE_PNG_3 } from './fixtures/generate';

test.describe.configure({ mode: 'serial' });

async function uploadPhoto(
	page: Page,
	fixturePath: string,
	title: string
): Promise<{
	id: string;
	sha: string;
}> {
	const bytes = await readFile(fixturePath);
	const sha = createHash('sha256').update(bytes).digest('hex');
	await page.request.post('/api/upload/init', {
		data: { sha256: sha, sizeBytes: bytes.length, mime: 'image/png', filename: `${title}.png` }
	});
	await page.request.put(`/api/upload/chunk?uploadId=${sha}&index=0`, {
		data: Buffer.from(bytes),
		headers: { 'content-type': 'application/octet-stream' }
	});
	const res = await page.request.post('/api/upload/complete', {
		headers: { origin: 'http://localhost:4173' },
		multipart: {
			uploadId: sha,
			allowDuplicate: 'false',
			meta: JSON.stringify({
				type: 'photo',
				width: 640,
				height: 480,
				duration: null,
				title,
				description: null,
				tapeLabel: null,
				date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
				people: [],
				tags: []
			}),
			blurhash: '',
			poster: { name: 'poster.webp', mimeType: 'image/webp', buffer: Buffer.from([1]) },
			thumb_400: { name: 'thumb_400.webp', mimeType: 'image/webp', buffer: Buffer.from([2]) },
			thumb_800: { name: 'thumb_800.webp', mimeType: 'image/webp', buffer: Buffer.from([3]) },
			thumb_1600: { name: 'thumb_1600.webp', mimeType: 'image/webp', buffer: Buffer.from([4]) }
		}
	});
	expect(res.status()).toBe(201);
	const { item } = (await res.json()) as { item: { id: string } };
	return { id: item.id, sha };
}

let page: Page;
let created: { id: string; sha: string };

test.beforeAll(async ({ browser }) => {
	page = await browser.newContext().then((c) => c.newPage());
	await ensureOwner(page);
	created = await uploadPhoto(page, FIXTURE_PNG_3, 'Lifecycle photo');
});

test.afterAll(async () => {
	await page.close();
});

test('soft delete hides the item from search and surfaces it in trash', async () => {
	expect((await page.request.delete(`/api/items/${created.id}`)).ok()).toBe(true);

	const search = await page.request.get(`/api/items?q=${encodeURIComponent('Lifecycle photo')}`);
	const { items } = (await search.json()) as { items: { id: string }[] };
	expect(items.find((i) => i.id === created.id)).toBeUndefined();

	await page.goto('/admin/trash');
	await expect(page.getByTestId('trash-item')).toHaveCount(1);
});

test('restore brings the item back', async () => {
	expect(
		(await page.request.post(`/api/items/${created.id}`, { data: { action: 'restore' } })).ok()
	).toBe(true);
	expect((await page.request.get(`/api/items/${created.id}`)).status()).toBe(200);
});

test('empty trash hard-deletes after typing the confirmation', async () => {
	await page.request.delete(`/api/items/${created.id}`);
	await page.goto('/admin/trash');
	await expect(page.getByTestId('trash-item')).toHaveCount(1);
	await page.locator('#confirm-empty').fill('empty the trash');
	await page.getByRole('button', { name: 'Empty trash' }).click();
	await expect(page.getByText('The trash is empty.')).toBeVisible();
	expect((await page.request.get(`/api/items/${created.id}`)).status()).toBe(404);
});

test('re-uploading identical bytes reports a duplicate id', async () => {
	// Upload a fresh photo, then re-init its sha: the server must report the duplicate.
	const first = await uploadPhoto(page, FIXTURE_PNG_3, 'Dedupe anchor');
	const again = await page.request.post('/api/upload/init', {
		data: { sha256: first.sha, sizeBytes: 1, mime: 'image/png', filename: 'again.png' }
	});
	expect((await again.json()).duplicateItemId).toBe(first.id);
});
