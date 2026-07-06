import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

let page: Page;
let itemId: string;

async function seedItem(page: Page): Promise<string> {
	const res = await page.request.post('/api/items', {
		data: {
			id: `e2e-mobile-item`,
			type: 'photo',
			title: 'Mobile layout photo',
			description: null,
			tapeLabel: null,
			date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
			duration: null,
			width: 640,
			height: 480,
			sizeBytes: 4,
			sha256: 'mobile-sha'.padEnd(64, '0').slice(0, 64),
			source: 'upload',
			blurhash: null,
			files: [
				{
					kind: 'poster',
					storageKey: 'media/m/poster.webp',
					mime: 'image/webp',
					width: 640,
					height: 480
				},
				{
					kind: 'thumb_400',
					storageKey: 'media/m/thumb_400.webp',
					mime: 'image/webp',
					width: 400,
					height: 300
				}
			],
			people: [],
			tags: []
		}
	});
	return ((await res.json()) as { item: { id: string } }).item.id;
}

test.beforeAll(async ({ browser }) => {
	page = await browser
		.newContext({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true
		})
		.then((c) => c.newPage());
	await ensureOwner(page);
	itemId = await seedItem(page);
});

test('century rail sits in the lower half of the timeline viewport', async () => {
	await page.goto('/?y=1994');
	const rail = page.getByRole('region', { name: 'Mobile timeline rail' });
	await expect(rail).toBeVisible();
	const box = await rail.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.y).toBeGreaterThan(844 / 2);
});

test('item room stacks media above people, tags, and comments on mobile', async () => {
	await page.goto(`/item/${itemId}`);
	const media = page.locator('img, video').first();
	const below = page.getByTestId('comments-slot');
	const mediaBox = await media.boundingBox();
	const belowBox = await below.boundingBox();
	expect(mediaBox).not.toBeNull();
	expect(belowBox).not.toBeNull();
	expect(belowBox!.y).toBeGreaterThanOrEqual(mediaBox!.y);
});
