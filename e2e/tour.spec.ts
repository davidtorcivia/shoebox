import { expect, test, type Browser, type Page } from '@playwright/test';
import { createUserWithRole, ensureOwner } from './helpers/auth';
import { seedPlayerRoom } from './helpers/seed-player';

// The guided onboarding walk: autostart, the spotlight veil, the item-page
// demonstrations, role filtering, comfort quick apply, skip persistence, and
// the replay entry on the profile page.

test.describe.configure({ mode: 'serial' });

let seeded = false;

/** The walk detours through a real memory, so make sure the library has one. */
async function ensureLibrary(browser: Browser): Promise<void> {
	if (seeded) return;
	const ctx = await browser.newContext();
	const owner = await ctx.newPage();
	await ensureOwner(owner);
	await seedPlayerRoom(owner);
	await ctx.close();
	seeded = true;
}

async function expectNoTourAfterReload(page: Page): Promise<void> {
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('tour-card')).toHaveCount(0);
}

test('walks a plain user through the item demonstrations', async ({ browser }) => {
	await ensureLibrary(browser);
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });

	// Autostarted: welcome step, comfort question, whole page under the veil.
	await expect(page.getByTestId('tour-card')).toBeVisible();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 1 of 13');
	await expect(page.locator('div.veil').first()).toBeVisible();

	// Decline comfort mode; the walk begins on the timeline.
	await page.getByTestId('tour-comfort-no').click();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 2 of 13');
	await expect(page).toHaveURL('/');

	// The walk steps into a real memory and demonstrates each control with a
	// spotlight (the halo ring marks the clear window in the veil).
	await page.getByTestId('tour-next').click(); // item intro
	await expect(page).toHaveURL(/\/item\//);
	await page.getByTestId('tour-next').click(); // save
	await expect(page.locator('div.halo')).toBeVisible();
	await page.getByTestId('tour-next').click(); // react
	await page.getByTestId('tour-next').click(); // memories
	await page.getByTestId('tour-next').click(); // people row
	await page.getByTestId('tour-next').click(); // clip (video sample)
	await expect(page).toHaveURL(/\/item\//);

	await page.getByTestId('tour-next').click(); // saved moments
	await expect(page).toHaveURL('/favorites');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/people');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/albums');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/search');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/profile');
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 13 of 13');

	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/onboarding')),
		page.getByTestId('tour-next').click()
	]);
	await expect(page.getByTestId('tour-card')).toHaveCount(0);
	await expect(page.locator('div.veil')).toHaveCount(0);
	await expectNoTourAfterReload(page);

	await context.close();
});

test('the welcome comfort choice applies immediately and persists', async ({ browser }) => {
	await ensureLibrary(browser);
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });

	await expect(page.getByTestId('tour-card')).toBeVisible();
	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/onboarding')),
		page.getByTestId('tour-comfort-yes').click()
	]);

	// Applied live for the rest of the walk, and durable across a full reload.
	await expect(page.locator('html')).toHaveClass(/comfort/);
	await page.reload();
	await expect(page.locator('html')).toHaveClass(/comfort/);
	await page.goto('/profile');
	await expect(page.getByTestId('comfort-toggle')).toBeChecked();

	await context.close();
});

test('skip persists across reloads', async ({ browser }) => {
	await ensureLibrary(browser);
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });

	await expect(page.getByTestId('tour-card')).toBeVisible();
	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/onboarding')),
		page.getByTestId('tour-skip').click()
	]);
	await expect(page.getByTestId('tour-card')).toHaveCount(0);
	await expectNoTourAfterReload(page);

	await context.close();
});

test('an admin gets the gated stops: edit, share, upload, and admin', async ({ browser }) => {
	await ensureLibrary(browser);
	const { page, context } = await createUserWithRole(browser, 'admin', { keepTour: true });

	// Base walk (13) plus edit, share, upload, admin; plus arrivals only when
	// other suites left the review queue non-empty. Read the actual total and
	// walk to the end, checking the gated stops appear.
	await expect(page.getByTestId('tour-card')).toBeVisible();
	const counter = await page.getByTestId('tour-counter').textContent();
	const total = Number(/of (\d+)$/.exec(counter ?? '')?.[1]);
	expect([17, 18]).toContain(total);

	await page.getByTestId('tour-comfort-no').click();

	const visited = new Set<string>();
	for (let i = 2; i < total; i += 1) {
		await page.getByTestId('tour-next').click();
		await expect(page.getByTestId('tour-counter')).toHaveText(`Step ${i + 1} of ${total}`);
		visited.add(new URL(page.url()).pathname);
	}
	await expect(page.getByTestId('tour-counter')).toHaveText(`Step ${total} of ${total}`);
	await expect(page).toHaveURL('/profile');
	expect(visited).toContain('/upload');
	expect(visited.has('/admin/users') || visited.has('/admin')).toBe(true);

	await context.close();
});

test('the tour can be replayed from the profile and closed with Escape', async ({ browser }) => {
	await ensureLibrary(browser);
	// Default helper behaviour dismisses the autostarted tour at creation.
	const { page, context } = await createUserWithRole(browser, 'user');

	await page.goto('/profile');
	await page.getByTestId('replay-tour').click();
	await expect(page.getByTestId('tour-card')).toBeVisible();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 1 of 13');

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tour-card')).toHaveCount(0);

	await context.close();
});

test('on a small screen the hamburger is spotlighted and the card names the menu button', async ({
	browser
}) => {
	await ensureLibrary(browser);
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });
	await page.setViewportSize({ width: 400, height: 800 });

	await expect(page.getByTestId('tour-card')).toBeVisible();
	await page.getByTestId('tour-comfort-no').click();

	// The timeline nav link hides inside the collapsed menu, so the spotlight
	// falls back to the hamburger and the copy names the menu button.
	const hamburger = page.getByRole('button', { name: 'Toggle navigation menu' });
	await expect(hamburger).toHaveClass(/tour-glow/);
	const halo = page.locator('div.halo');
	await expect(halo).toBeVisible();
	const haloBox = await halo.boundingBox();
	const burgerBox = await hamburger.boundingBox();
	expect(haloBox && burgerBox && Math.abs(haloBox.x + 8 - burgerBox.x) < 2).toBe(true);
	await expect(page.getByText('behind the menu button')).toBeVisible();

	await context.close();
});
