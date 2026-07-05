import { expect, test, type Page } from '@playwright/test';
import { ensureOwner, OWNER, seedPlayerRoom } from './helpers/seed-player';

test.describe.configure({ mode: 'serial' });

let seeded:
	| {
			videoId: string;
			photoId: string;
			personId: string;
			albumId: string;
	  }
	| undefined;

async function ensureSeeded(page: Page): Promise<NonNullable<typeof seeded>> {
	await ensureOwner(page);
	if (!seeded) seeded = await seedPlayerRoom(page);
	return seeded;
}

async function createShareViaApi(
	page: Page,
	body: {
		targetType: 'album' | 'item';
		targetId: string;
		password?: string;
		expiry?: string;
		allowDownload?: boolean;
	}
): Promise<{ token: string; id: string }> {
	const res = await page.request.post('/api/shares', { data: body });
	expect(res.status()).toBe(201);
	const out = (await res.json()) as { share: { token: string; id: string } };
	return { token: out.share.token, id: out.share.id };
}

test.beforeEach(async ({ page }) => {
	await ensureSeeded(page);
});

test('password share opens a read-only public album without app nav', async ({ page, browser }) => {
	const ids = await ensureSeeded(page);
	await page.goto(`/albums/${ids.albumId}`);
	await page.getByTestId('share-button').click();
	await page.getByLabel('Require a password').check();
	await page.getByPlaceholder('Password').fill('cranberry');
	await page.getByRole('button', { name: 'Create share link' }).click();
	const url = await page.getByTestId('share-link').inputValue();
	expect(url).toContain('/share/');

	const anonCtx = await browser.newContext();
	const anon = await anonCtx.newPage();
	await anon.goto(url);
	await expect(anon.getByRole('heading', { name: /protected/i })).toBeVisible();
	await expect(anon.locator('nav')).toHaveCount(0);

	await anon.getByLabel('Password').fill('cranberry');
	await anon.getByRole('button', { name: 'Open' }).click();
	await expect(anon.getByTestId('share-wordmark')).toBeVisible();
	await expect(anon.getByRole('heading', { name: 'Player E2E Album' })).toBeVisible();
	await expect(anon.locator('nav')).toHaveCount(0);
	await expect(anon.getByPlaceholder('Add a memory…')).toHaveCount(0);
	await anonCtx.close();
});

test('wrong share password rate limits after repeated failures', async ({ page, browser }) => {
	const ids = await ensureSeeded(page);
	const { token } = await createShareViaApi(page, {
		targetType: 'album',
		targetId: ids.albumId,
		password: 'right-pw'
	});

	const anonCtx = await browser.newContext();
	const anon = await anonCtx.newPage();
	await anon.goto(`/share/${token}`);
	for (let i = 0; i < 6; i += 1) {
		await anon.getByLabel('Password').fill('wrong-pw');
		await anon.getByRole('button', { name: 'Open' }).click();
		await expect(anon.getByRole('alert')).toContainText(/not right/i);
	}
	await anon.getByLabel('Password').fill('wrong-pw');
	await anon.getByRole('button', { name: 'Open' }).click();
	await expect(anon.getByRole('alert')).toContainText(/too many tries/i);
	await anonCtx.close();
});

test('expired share shows the expired page', async ({ page, browser }) => {
	const ids = await ensureSeeded(page);
	const { token } = await createShareViaApi(page, {
		targetType: 'album',
		targetId: ids.albumId,
		expiry: '2000-01-01'
	});

	const anonCtx = await browser.newContext();
	const anon = await anonCtx.newPage();
	await anon.goto(`/share/${token}`);
	await expect(anon.getByRole('heading', { name: /expired/i })).toBeVisible();
	await anonCtx.close();
});

test('item share respects allowDownload', async ({ page, browser }) => {
	const ids = await ensureSeeded(page);
	const withDownload = await createShareViaApi(page, {
		targetType: 'item',
		targetId: ids.videoId,
		allowDownload: true
	});
	const withoutDownload = await createShareViaApi(page, {
		targetType: 'item',
		targetId: ids.videoId
	});

	const anonCtx = await browser.newContext();
	const anon = await anonCtx.newPage();
	await anon.goto(`/share/${withDownload.token}`);
	await expect(anon.getByTestId('share-download')).toBeVisible();
	await anon.goto(`/share/${withoutDownload.token}`);
	await expect(anon.getByTestId('share-download')).toHaveCount(0);
	await anonCtx.close();
});

test('admin trash restores a soft-deleted item', async ({ page }) => {
	const ids = await ensureSeeded(page);
	const deleted = await page.request.delete(`/api/items/${ids.photoId}`);
	expect(deleted.ok()).toBe(true);

	await page.goto('/admin/trash');
	const row = page.getByTestId('trash-item').first();
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByTestId('trash-item')).toHaveCount(0);

	const restored = await page.request.get(`/api/items/${ids.photoId}`);
	expect(restored.status()).toBe(200);
});

test('profile accent changes comment username color', async ({ page }) => {
	const ids = await ensureSeeded(page);
	await page.goto(`/item/${ids.videoId}`);
	await page.getByPlaceholder('Add a memory…').fill('Accent check');
	await page.getByRole('button', { name: 'Add memory' }).click();
	await expect(page.getByText('Accent check')).toBeVisible();

	await page.goto('/profile');
	await page.locator('[data-accent="#FFD700"]').click();
	await page.getByTestId('save-appearance').click();
	await expect(page.getByTestId('profile-saved')).toBeVisible();

	await page.goto(`/item/${ids.videoId}`);
	await expect(page.getByText('Accent check')).toBeVisible();
	await expect(page.getByTestId('comment-username').last()).toHaveCSS('color', 'rgb(255, 215, 0)');
});
