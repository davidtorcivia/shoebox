import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/seed-player';

test.describe.configure({ mode: 'serial' });

let page: Page;
let ericId = '';
let momId = '';

const items = {
	lake: 'e2e-search-lake',
	bike: 'e2e-search-bike',
	xmas: 'e2e-search-xmas',
	old: 'e2e-search-old'
};

async function createPerson(name: string, birthdate?: string): Promise<string> {
	const res = await page.request.post('/api/people', { data: { name, birthdate } });
	expect(res.status()).toBe(201);
	const body = (await res.json()) as { person: { id: string } };
	return body.person.id;
}

async function createItem(input: {
	id: string;
	type?: 'video' | 'photo';
	title: string;
	description?: string | null;
	date: string;
	people?: string[];
}) {
	const type = input.type ?? 'photo';
	const res = await page.request.post('/api/items', {
		data: {
			id: input.id,
			type,
			title: input.title,
			description: input.description ?? null,
			tapeLabel: null,
			date: { dateStart: input.date, dateEnd: input.date, precision: 'day' },
			duration: type === 'video' ? 1 : null,
			width: 640,
			height: 480,
			sizeBytes: 4,
			sha256: `${input.id}-sha`.padEnd(64, '0').slice(0, 64),
			source: 'upload',
			blurhash: null,
			files: [
				{
					kind: 'poster',
					storageKey: `media/${input.id}/poster.webp`,
					mime: 'image/webp',
					width: 640,
					height: 480
				},
				{
					kind: 'thumb_400',
					storageKey: `media/${input.id}/thumb_400.webp`,
					mime: 'image/webp',
					width: 400,
					height: 300
				},
				{
					kind: 'thumb_800',
					storageKey: `media/${input.id}/thumb_800.webp`,
					mime: 'image/webp',
					width: 800,
					height: 600
				},
				{
					kind: 'thumb_1600',
					storageKey: `media/${input.id}/thumb_1600.webp`,
					mime: 'image/webp',
					width: 1600,
					height: 1200
				}
			],
			people: input.people ?? [],
			tags: []
		}
	});
	expect(res.status()).toBe(201);
}

async function search(q: string) {
	await page.goto(`/search?q=${encodeURIComponent(q)}`);
}

function openButton(title: string) {
	return page.getByRole('button', { name: `Open ${title}` });
}

test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext();
	page = await context.newPage();
	await ensureOwner(page);

	ericId = await createPerson('Eric', '1988-06-14');
	momId = await createPerson('Mom');

	await createItem({
		id: items.lake,
		title: 'Lake day',
		description: 'Eating watermelon at the lake',
		date: '1993-08-10',
		people: [ericId]
	});
	await createItem({
		id: items.bike,
		type: 'video',
		title: 'Bike ride',
		date: '1996-08-10',
		people: [ericId]
	});
	await createItem({
		id: items.xmas,
		title: 'Morning presents',
		date: '1994-12-25',
		people: [ericId, momId]
	});
	await createItem({
		id: items.old,
		title: 'Old photo',
		date: '1985-05-05'
	});
});

test('text search finds an item by its description', async () => {
	await search('watermelon');
	await expect(openButton('Lake day')).toBeVisible();
	await expect(openButton('Bike ride')).toHaveCount(0);
});

test('holiday auto-tag makes 1994-12-25 searchable via tag:christmas', async () => {
	await search('tag:christmas');
	await expect(openButton('Morning presents')).toBeVisible();
	await expect(openButton('Lake day')).toHaveCount(0);
});

test('person and tag filters are AND-composed', async () => {
	await search('person:Mom tag:christmas');
	await expect(openButton('Morning presents')).toBeVisible();
	await expect(openButton('Lake day')).toHaveCount(0);
	await expect(openButton('Bike ride')).toHaveCount(0);
});

test('year window excludes items outside the range', async () => {
	await search('1988..1999');
	await expect(openButton('Lake day')).toBeVisible();
	await expect(openButton('Bike ride')).toBeVisible();
	await expect(openButton('Morning presents')).toBeVisible();
	await expect(openButton('Old photo')).toHaveCount(0);
});

test('age window filters Eric items and excludes the 1996 item', async () => {
	await search('person:Eric age:5-7');
	await expect(openButton('Lake day')).toBeVisible();
	await expect(openButton('Morning presents')).toBeVisible();
	await expect(openButton('Bike ride')).toHaveCount(0);
});

test('renaming a person updates the search index', async () => {
	const res = await page.request.patch(`/api/people/${ericId}`, { data: { name: 'Eric Junior' } });
	expect(res.ok()).toBe(true);

	await search('Junior');
	await expect(openButton('Lake day')).toBeVisible();
	await expect(openButton('Bike ride')).toBeVisible();
	await expect(openButton('Morning presents')).toBeVisible();
});

test('empty state copy renders for no matches', async () => {
	await search('zzzqqqxyzzy');
	await expect(page.getByTestId('search-empty')).toContainText('Nothing found in the shoebox');
});

test('omnibox updates results live and keeps the URL in sync', async () => {
	await page.goto('/search');
	await page.getByTestId('omnibox').fill('watermelon');
	await page.waitForURL(/\/search\?q=watermelon/);
	await expect(openButton('Lake day')).toBeVisible();
});
