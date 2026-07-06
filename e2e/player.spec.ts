import { expect, test } from '@playwright/test';
import { ensureOwner } from './helpers/auth';
import { seedPlayerRoom } from './helpers/seed-player';

test.describe.configure({ mode: 'serial' });

test('item room video, neighbors, photo lightbox, and edit panel', async ({ page }) => {
	await ensureOwner(page);
	const seeded = await seedPlayerRoom(page);
	const context = `y=1994&people=${seeded.personId}`;

	await page.goto(`/item/${seeded.videoId}?${context}`);
	await expect(page.getByText('Aunt June').first()).toBeVisible();
	await expect(page.getByText('Player E2E Album')).toBeVisible();
	await expect(page.getByText('June 14, 1994')).toBeVisible();
	await expect(page.getByTestId('comments-slot')).toBeVisible();

	await page.keyboard.press('l');
	await page.keyboard.press('l');
	await expect(page.getByRole('button', { name: '2x' })).toBeVisible();
	await page.keyboard.press('k');
	await page.keyboard.press(' ');
	await page.keyboard.press('ArrowRight');

	await page.keyboard.press('ArrowDown');
	await page.waitForURL(new RegExp(`/item/${seeded.photoId}.*people=${seeded.personId}`));
	await expect(page.getByRole('heading', { name: 'Player Test Photo' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0);
	await expect(page.getByText('January 2, 1995')).toBeVisible();

	await page.keyboard.press('ArrowUp');
	await page.waitForURL(new RegExp(`/item/${seeded.videoId}.*people=${seeded.personId}`));

	await page.getByText('Edit metadata').click();
	await page.getByLabel('Title').fill('Edited Player Clip');
	await page.getByLabel('Type').selectOption('year');
	await page.getByRole('textbox', { name: 'Tags' }).fill('Reunion, PLAYER-room');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Edited Player Clip' })).toBeVisible();
	await expect(page.getByText('1996')).toBeVisible();
	await expect(page.getByText('reunion')).toBeVisible();
});
