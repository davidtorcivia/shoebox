import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/auth';
import { createUserWithRole } from './helpers/auth';
import { readFile } from 'node:fs/promises';
import { FIXTURE_PNG } from './fixtures/generate';

test.describe.configure({ mode: 'serial' });

let ownerPage: Page;
let photoId: string;

async function uploadPhoto(page: Page, title: string): Promise<string> {
	const bytes = new Uint8Array(await readFile(FIXTURE_PNG));
	const sha = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.repeat(2)
		.slice(0, 64);
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
	const { item } = (await res.json()) as { item: { id: string } };
	return item.id;
}

test.beforeAll(async ({ browser }) => {
	ownerPage = await browser.newContext().then((c) => c.newPage());
	await ensureOwner(ownerPage);
	photoId = await uploadPhoto(ownerPage, 'Permissions photo');
});

test.afterAll(async () => {
	await ownerPage.close();
});

test('plain user is denied write APIs and upload nav', async ({ browser }) => {
	const { page, context } = await createUserWithRole(browser, 'user');
	const init = await page.request.post('/api/upload/init', {
		data: { sha256: 'a'.repeat(64), sizeBytes: 1, mime: 'image/png', filename: 'x.png' }
	});
	expect(init.status()).toBe(403);
	expect(
		(await page.request.patch(`/api/items/${photoId}`, { data: { title: 'no' } })).status()
	).toBe(403);
	expect((await page.request.delete(`/api/items/${photoId}`)).status()).toBe(403);
	expect(
		(
			await page.request.post('/api/shares', { data: { targetType: 'item', targetId: photoId } })
		).status()
	).toBe(403);
	expect((await page.request.post('/api/invites', { data: { role: 'user' } })).status()).toBe(403);
	expect((await page.request.get('/api/admin/users')).status()).toBe(403);

	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Primary' });
	await expect(nav.getByRole('link', { name: 'Upload' })).toHaveCount(0);
	await expect(nav.getByRole('link', { name: 'Arrivals' })).toHaveCount(0);
	await context.close();
});

test('uploader can init uploads and comment', async ({ browser }) => {
	const { page, context } = await createUserWithRole(browser, 'uploader');
	const init = await page.request.post('/api/upload/init', {
		data: { sha256: 'b'.repeat(64), sizeBytes: 1, mime: 'image/png', filename: 'y.png' }
	});
	expect(init.status()).toBe(200);
	const comment = await page.request.post(`/api/items/${photoId}/comments`, {
		data: { body: 'uploader comment' }
	});
	expect(comment.status()).toBe(201);
	await context.close();
});

test('editor can edit another user item but not mint invites or review arrivals', async ({
	browser
}) => {
	const { page, context } = await createUserWithRole(browser, 'editor');
	const patch = await page.request.patch(`/api/items/${photoId}`, { data: { title: 'Edited' } });
	expect(patch.ok()).toBe(true);
	expect((await page.request.post('/api/invites', { data: { role: 'user' } })).status()).toBe(403);
	// Arrivals review is admin-only.
	expect((await page.request.get('/api/arrivals')).status()).toBe(403);
	await context.close();
});

test('admin can list invites, users, and arrivals', async ({ browser }) => {
	const { page, context } = await createUserWithRole(browser, 'admin');
	expect((await page.request.get('/api/invites')).status()).toBe(200);
	expect((await page.request.get('/api/admin/users')).status()).toBe(200);
	expect((await page.request.get('/api/arrivals')).status()).toBe(200);
	await context.close();
});
