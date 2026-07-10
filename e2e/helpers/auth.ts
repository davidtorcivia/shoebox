import type { Browser, BrowserContext, Page } from '@playwright/test';

export const OWNER = { username: 'matriarch', password: 'super-secret-8' };

export type Role = 'admin' | 'editor' | 'uploader' | 'user';

/**
 * Close the guided onboarding tour if this sign-in triggered it, and wait for
 * the completion write so the tour cannot resurface after a later reload. The
 * card mounts client-side after hydration, so give it a short window; accounts
 * that already finished the tour simply time out into the no-op branch.
 */
export async function dismissTour(page: Page): Promise<void> {
	const skip = page.getByTestId('tour-skip');
	try {
		await skip.waitFor({ state: 'visible', timeout: 1500 });
	} catch {
		return; // No tour for this account.
	}
	await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/onboarding')),
		skip.click()
	]);
	await page.getByTestId('tour-card').waitFor({ state: 'detached' });
}

/**
 * Make sure an authenticated owner exists, navigating through /setup or /login
 * as needed. Idempotent: a no-op once the owner is signed in for the page.
 */
export async function ensureOwner(page: Page): Promise<void> {
	await page.goto('/setup');
	if (
		await page
			.getByRole('heading', { name: 'Set up Shoebox' })
			.isVisible()
			.catch(() => false)
	) {
		await page.getByLabel('Username').fill(OWNER.username);
		await page.getByLabel('Password').fill(OWNER.password);
		await page.getByRole('button', { name: 'Create owner' }).click();
		await page.waitForURL('/');
		await dismissTour(page);
		return;
	}

	if (page.url().endsWith('/login')) {
		await page.getByLabel('Username').fill(OWNER.username);
		await page.getByLabel('Password').fill(OWNER.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.waitForURL('/');
		await dismissTour(page);
	}
}

export async function login(
	page: Page,
	username: string = OWNER.username,
	password: string = OWNER.password
): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('/');
	await dismissTour(page);
}

export interface CreatedUser {
	page: Page;
	username: string;
	context: BrowserContext;
	password: string;
}

/**
 * Mint a single-use invite for `role` as the owner, then redeem it in a fresh
 * browser context. The caller owns the returned context and must close it.
 */
export async function createUserWithRole(
	browser: Browser,
	role: Role,
	opts: { username?: string; password?: string; keepTour?: boolean } = {}
): Promise<CreatedUser> {
	const ownerContext = await browser.newContext();
	const owner = await ownerContext.newPage();
	await ensureOwner(owner);
	const res = await owner.request.post('/api/invites', { data: { role, maxUses: 1 } });
	const { invite } = (await res.json()) as { invite: { token: string } };
	const inviteUrl = new URL(`/invite/${invite.token}`, owner.url()).href;
	await ownerContext.close();

	const username = opts.username ?? `u_${role}_${Math.random().toString(36).slice(2, 8)}`;
	const password = opts.password ?? 'invited-secret-8';
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(inviteUrl);
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Join Shoebox' }).click();
	await page.waitForURL('/');
	if (!opts.keepTour) await dismissTour(page);
	return { page, context, username, password };
}
