import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const OWNER = { username: 'matriarch', password: 'super-secret-8' };

test('fresh instance redirects everything to /setup', async ({ page }) => {
	await page.goto('/albums');
	await expect(page).toHaveURL(/\/setup$/);
	await expect(page.getByRole('heading', { name: 'Set up Shoebox' })).toBeVisible();
});

test('owner setup, invite creation, redemption as user, role-gated nav', async ({ browser }) => {
	const ownerCtx = await browser.newContext();
	const owner = await ownerCtx.newPage();
	await owner.goto('/setup');
	await owner.getByLabel('Username').fill(OWNER.username);
	await owner.getByLabel('Password').fill(OWNER.password);
	await owner.getByRole('button', { name: 'Create owner' }).click();
	await owner.waitForURL('/');

	const ownerNav = owner.getByRole('navigation', { name: 'Primary' });
	await expect(ownerNav.getByRole('link', { name: 'Timeline' })).toBeVisible();
	await expect(ownerNav.getByRole('link', { name: 'Arrivals' })).toBeVisible();
	await expect(owner.getByText(OWNER.username)).toBeVisible();

	await owner.goto('/setup');
	await expect(owner).toHaveURL('/');

	await owner.goto('/admin/invites');
	await owner.getByLabel('Role').selectOption('user');
	await owner.getByLabel('Max uses').fill('1');
	await owner.getByRole('button', { name: 'Create invite' }).click();
	const inviteUrl = await owner.getByTestId('invite-url').first().innerText();
	expect(inviteUrl).toContain('/invite/');

	const guestCtx = await browser.newContext();
	const guest = await guestCtx.newPage();
	await guest.goto(inviteUrl);
	await expect(guest.getByRole('heading', { name: "You're invited" })).toBeVisible();
	await expect(guest.locator('strong')).toHaveText('user');
	await guest.getByLabel('Username').fill('cousin');
	await guest.getByLabel('Password').fill('another-secret-8');
	await guest.getByRole('button', { name: 'Join Shoebox' }).click();
	await guest.waitForURL('/');

	const guestNav = guest.getByRole('navigation', { name: 'Primary' });
	await expect(guestNav.getByRole('link', { name: 'Timeline' })).toBeVisible();
	await expect(guestNav.getByRole('link', { name: 'People' })).toBeVisible();
	await expect(guestNav.getByRole('link', { name: 'Albums' })).toBeVisible();
	await expect(guestNav.getByRole('link', { name: 'Search' })).toBeVisible();
	await expect(guestNav.getByRole('link', { name: 'Arrivals' })).toHaveCount(0);

	const adminRes = await guest.goto('/admin/invites');
	expect(adminRes?.status()).toBe(403);
	const arrivalsRes = await guest.goto('/arrivals');
	expect(arrivalsRes?.status()).toBe(403);

	const lateCtx = await browser.newContext();
	const late = await lateCtx.newPage();
	await late.goto(inviteUrl);
	await expect(late.getByRole('heading', { name: 'Invite used up' })).toBeVisible();

	await ownerCtx.close();
	await guestCtx.close();
	await lateCtx.close();
});

test('login and logout round-trip', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await page.getByLabel('Username').fill(OWNER.username);
	await page.getByLabel('Password').fill(OWNER.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('/');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.waitForURL(/\/login$/);
	await page.goto('/people');
	await expect(page).toHaveURL(/\/login$/);
});
