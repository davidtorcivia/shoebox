import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

let page: Page;
let itemId: string;
let albumId: string;

async function createItem(title: string): Promise<string> {
	const id = `e2e-shares-${title.toLowerCase().replace(/\s+/g, '-')}`;
	const res = await page.request.post('/api/items', {
		data: {
			id,
			type: 'photo',
			title,
			description: null,
			tapeLabel: null,
			date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
			duration: null,
			width: 640,
			height: 480,
			sizeBytes: 4,
			sha256: `${title}-sha`.padEnd(64, '0').slice(0, 64),
			source: 'upload',
			blurhash: null,
			files: [
				{
					kind: 'original',
					storageKey: `media/${id}/original.png`,
					mime: 'image/png',
					width: 640,
					height: 480
				},
				{
					kind: 'poster',
					storageKey: `media/${id}/poster.webp`,
					mime: 'image/webp',
					width: 640,
					height: 480
				},
				{
					kind: 'thumb_400',
					storageKey: `media/${id}/thumb_400.webp`,
					mime: 'image/webp',
					width: 400,
					height: 300
				}
			],
			people: [],
			tags: []
		}
	});
	expect(res.status()).toBe(201);
	return ((await res.json()) as { item: { id: string } }).item.id;
}

async function createShare(body: {
	targetType: 'album' | 'item';
	targetId: string;
	password?: string;
	expiry?: string;
	allowDownload?: boolean;
}): Promise<{ token: string; url: string }> {
	const res = await page.request.post('/api/shares', { data: body });
	expect(res.status()).toBe(201);
	const out = (await res.json()) as { share: { token: string }; url: string };
	expect(out.url).toBe(`/share/${out.share.token}`);
	return { token: out.share.token, url: out.url };
}

test.beforeAll(async ({ browser }) => {
	page = await browser.newContext().then((c) => c.newPage());
	await ensureOwner(page);
	itemId = await createItem('Item Share');
	const album = await page.request.post('/api/albums', { data: { title: 'Shares Suite Album' } });
	albumId = ((await album.json()) as { album: { id: string } }).album.id;
	expect(
		(await page.request.post(`/api/albums/${albumId}/items`, { data: { add: [itemId] } })).ok()
	).toBe(true);
});

test.afterAll(async () => {
	await page.close();
});

test('item share respects allowDownload and exposes the share url shape', async ({ browser }) => {
	const withDl = await createShare({ targetType: 'item', targetId: itemId, allowDownload: true });
	const withoutDl = await createShare({ targetType: 'item', targetId: itemId });

	const anon = await browser.newContext().then((c) => c.newPage());
	await anon.goto(`/share/${withDl.token}`);
	await expect(anon.getByTestId('share-download')).toBeVisible();
	await anon.goto(`/share/${withoutDl.token}`);
	await expect(anon.getByTestId('share-download')).toHaveCount(0);
	await anon.context().close();
});

test('album share is read-only: no nav and no comment box', async ({ browser }) => {
	const { token } = await createShare({ targetType: 'album', targetId: albumId });
	const anon = await browser.newContext().then((c) => c.newPage());
	await anon.goto(`/share/${token}`);
	await expect(anon.getByRole('heading', { name: 'Shares Suite Album' })).toBeVisible();
	await expect(anon.locator('nav')).toHaveCount(0);
	await expect(anon.getByPlaceholder('Add a memory…')).toHaveCount(0);
	await anon.context().close();
});

test('password share rejects the wrong password and unlocks read-only with the right one', async ({
	browser
}) => {
	const { token } = await createShare({
		targetType: 'album',
		targetId: albumId,
		password: 'cranberry'
	});

	const anonCtx = await browser.newContext();
	const wrong = await anonCtx.request.post(`/share/${token}?/unlock`, {
		headers: { origin: 'http://localhost:4173' },
		form: { password: 'wrong' }
	});
	expect(await wrong.text()).toContain('not right');

	const anon = await anonCtx.newPage();
	await anon.goto(`/share/${token}`);
	await expect(anon.getByRole('heading', { name: /protected/i })).toBeVisible();
	await anon.getByLabel('Password').fill('cranberry');
	await anon.getByRole('button', { name: 'Open' }).click();
	await expect(anon.getByTestId('share-wordmark')).toBeVisible();
	await expect(anon.locator('nav')).toHaveCount(0);
	await anonCtx.close();
});

test('expired share is refused', async ({ browser }) => {
	const { token } = await createShare({
		targetType: 'album',
		targetId: albumId,
		expiry: '2000-01-01'
	});
	const anon = await browser.newContext().then((c) => c.newPage());
	await anon.goto(`/share/${token}`);
	await expect(anon.getByRole('heading', { name: /expired/i })).toBeVisible();
	await anon.context().close();
});

test('expiry accepts the documented keys', async () => {
	for (const expiry of ['never', '7d', '30d', '2099-01-01']) {
		const res = await page.request.post('/api/shares', {
			data: { targetType: 'item', targetId: itemId, expiry }
		});
		expect(res.status(), `expiry=${expiry}`).toBe(201);
	}
});
