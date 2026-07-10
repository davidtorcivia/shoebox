import { expect, test, type Page } from '@playwright/test';
import { createUserWithRole } from './helpers/auth';

// The guided onboarding walk: autostart for accounts that have not completed
// it, role-filtered stops, the comfort mode quick apply, skip persistence, and
// the replay entry on the profile page.

async function expectNoTourAfterReload(page: Page): Promise<void> {
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('tour-card')).toHaveCount(0);
}

test('walks a plain user through the ungated stops and never returns', async ({ browser }) => {
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });

	// Autostarted on first landing: welcome step with the comfort question.
	await expect(page.getByTestId('tour-card')).toBeVisible();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 1 of 6');
	await expect(page.getByTestId('tour-comfort-yes')).toBeVisible();

	// Decline comfort mode and walk. A plain user gets no Upload/Arrivals/Admin
	// stops, so the walk runs timeline, people, albums, search, profile.
	await page.getByTestId('tour-comfort-no').click();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 2 of 6');
	await expect(page).toHaveURL('/');

	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/people');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/albums');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/search');
	await page.getByTestId('tour-next').click();
	await expect(page).toHaveURL('/profile');
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 6 of 6');

	// The last stop finishes the tour and stamps completion.
	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/onboarding')),
		page.getByTestId('tour-next').click()
	]);
	await expect(page.getByTestId('tour-card')).toHaveCount(0);
	await expectNoTourAfterReload(page);

	await context.close();
});

test('the welcome comfort choice applies immediately and persists', async ({ browser }) => {
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

test('an admin gets the gated stops and the nav glow follows the walk', async ({ browser }) => {
	const { page, context } = await createUserWithRole(browser, 'admin', { keepTour: true });

	// Welcome, timeline, people, albums, search, upload, admin, profile, plus an
	// arrivals stop whenever the review queue has items. The tour mirrors the
	// nav's own visibility rule, so read the nav to know which walk to expect
	// (other suites in a full run may have populated the queue).
	await expect(page.getByTestId('tour-card')).toBeVisible();
	const nav = page.getByRole('navigation', { name: 'Primary' });
	const hasArrivals = (await nav.getByTestId('nav-arrivals').count()) > 0;
	const total = hasArrivals ? 9 : 8;

	await expect(page.getByTestId('tour-counter')).toHaveText(`Step 1 of ${total}`);
	await page.getByTestId('tour-comfort-no').click();

	await expect(nav.getByRole('link', { name: 'Timeline' })).toHaveClass(/tour-glow/);

	await page.getByTestId('tour-next').click(); // people
	await expect(nav.getByRole('link', { name: 'People' })).toHaveClass(/tour-glow/);
	await page.getByTestId('tour-next').click(); // albums
	await page.getByTestId('tour-next').click(); // search
	await page.getByTestId('tour-next').click(); // upload
	await expect(page).toHaveURL('/upload');
	await expect(nav.getByRole('link', { name: 'Upload' })).toHaveClass(/tour-glow/);
	if (hasArrivals) {
		await page.getByTestId('tour-next').click(); // arrivals
		await expect(page).toHaveURL('/arrivals');
		await expect(nav.getByTestId('nav-arrivals')).toHaveClass(/tour-glow/);
	}
	await page.getByTestId('tour-next').click(); // admin
	// The /admin index forwards to its first sub-page.
	await expect(page).toHaveURL('/admin/users');
	await expect(nav.getByRole('link', { name: 'Admin' })).toHaveClass(/tour-glow/);
	await page.getByTestId('tour-next').click(); // profile
	await expect(page).toHaveURL('/profile');
	await expect(page.getByTestId('tour-counter')).toHaveText(`Step ${total} of ${total}`);

	await context.close();
});

test('the tour can be replayed from the profile and closed with Escape', async ({ browser }) => {
	// Default helper behaviour dismisses the autostarted tour at creation.
	const { page, context } = await createUserWithRole(browser, 'user');

	await page.goto('/profile');
	await page.getByTestId('replay-tour').click();
	await expect(page.getByTestId('tour-card')).toBeVisible();
	await expect(page.getByTestId('tour-counter')).toHaveText('Step 1 of 6');

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tour-card')).toHaveCount(0);

	await context.close();
});

test('on a small screen the hamburger glows and the card names the menu button', async ({
	browser
}) => {
	const { page, context } = await createUserWithRole(browser, 'user', { keepTour: true });
	await page.setViewportSize({ width: 400, height: 800 });

	await expect(page.getByTestId('tour-card')).toBeVisible();
	await page.getByTestId('tour-comfort-no').click();

	await expect(page.getByRole('button', { name: 'Toggle navigation menu' })).toHaveClass(
		/tour-glow/
	);
	await expect(page.getByText('behind the menu button')).toBeVisible();

	await context.close();
});
