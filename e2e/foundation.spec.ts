import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { approveItems } from './helpers/arrivals';
import { OWNER, ensureOwner } from './helpers/auth';
import { readFile } from 'node:fs/promises';
import { FIXTURE_MP4 } from './fixtures/generate';

test.describe.configure({ mode: 'serial' });

test('fresh instance redirects unauthenticated traffic to /setup', async ({ page }) => {
	await page.goto('/albums');
	// On a fresh database this is /setup; if another suite already created the
	// owner it is /login. Either way the app refuses an unauthenticated session.
	await expect(page).toHaveURL(/\/(setup|login)$/);
});

test('owner setup, invite creation, redemption as user, role-gated nav', async ({ browser }) => {
	const ownerCtx = await browser.newContext();
	const owner = await ownerCtx.newPage();
	await ensureOwner(owner);

	const ownerNav = owner.getByRole('navigation', { name: 'Primary' });
	await expect(ownerNav.getByRole('link', { name: 'Timeline' })).toBeVisible();
	await expect(ownerNav.getByRole('link', { name: 'Upload' })).toBeVisible();
	// Arrivals is count-gated now: a fresh library has an empty queue, so the
	// entry hides itself (the ingestion spec covers the populated case).
	await expect(ownerNav.getByRole('link', { name: /^Arrivals/ })).toHaveCount(0);
	await expect(owner.getByText(OWNER.username)).toBeVisible();

	await owner.goto('/setup');
	await expect(owner).toHaveURL('/');

	await owner.goto('/admin/invites');
	await owner.getByLabel('Role').selectOption('user');
	await owner.getByLabel('Max uses').fill('1');
	await owner.getByRole('button', { name: 'Create invite' }).click();
	// The invites page exposes only a "Copy link" button (no visible URL); read the
	// freshly minted token through the admin API and build the invite URL from it.
	await expect(owner.getByRole('button', { name: 'Copy link' })).toBeVisible();
	const invitesRes = await owner.request.get('/api/invites');
	const { invites } = (await invitesRes.json()) as { invites: { token: string }[] };
	const inviteUrl = new URL(`/invite/${invites[0].token}`, owner.url()).href;
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

test('media upload API golden path, range streaming, dedupe, trash and restore', async ({
	page
}) => {
	await page.goto('/login');
	await page.getByLabel('Username').fill(OWNER.username);
	await page.getByLabel('Password').fill(OWNER.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('/');

	const base = new Uint8Array(await readFile(FIXTURE_MP4));
	// Unique-per-run nonce keeps the mp4 magic (so the content sniff still detects
	// video/mp4) while guaranteeing a distinct SHA-256 — other suites upload
	// clip.mp4 too, and a shared digest would trip dedupe under the full run.
	const bytes = Buffer.concat([Buffer.from(base), Buffer.from(`run-${Date.now()}`)]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');

	const init = await page.request.post('/api/upload/init', {
		data: { sha256, sizeBytes: bytes.length, mime: 'video/mp4', filename: 'tiny.mp4' }
	});
	expect(init.ok()).toBe(true);
	const initBody = (await init.json()) as { uploadId: string; duplicateItemId: string | null };
	expect(initBody).toMatchObject({ uploadId: sha256, duplicateItemId: null });

	const chunk = await page.request.put(`/api/upload/chunk?uploadId=${sha256}&index=0`, {
		data: Buffer.from(bytes),
		headers: { 'content-type': 'application/octet-stream' }
	});
	expect(chunk.ok()).toBe(true);

	const meta = {
		type: 'video',
		width: 192,
		height: 108,
		duration: 1,
		title: 'Tiny clip',
		description: null,
		tapeLabel: 'Tape 01',
		date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
		people: [],
		tags: ['sprinkler']
	};
	const complete = await page.request.post('/api/upload/complete', {
		headers: { origin: 'http://localhost:4173' },
		multipart: {
			uploadId: sha256,
			allowDuplicate: 'false',
			meta: JSON.stringify(meta),
			blurhash: 'LKO2?U%2Tw',
			poster: { name: 'poster.webp', mimeType: 'image/webp', buffer: Buffer.from([1, 2, 3]) },
			thumb_400: { name: 'thumb_400.webp', mimeType: 'image/webp', buffer: Buffer.from([4]) },
			thumb_800: { name: 'thumb_800.webp', mimeType: 'image/webp', buffer: Buffer.from([5]) },
			thumb_1600: { name: 'thumb_1600.webp', mimeType: 'image/webp', buffer: Buffer.from([6]) }
		}
	});
	expect(complete.status()).toBe(201);
	const completeBody = (await complete.json()) as {
		item: { id: string; urls: { original: string }; displayDate: string; shortDate: string };
	};
	expect(completeBody.item).toMatchObject({ displayDate: 'c. 1994', shortDate: 'c. 1994' });

	// The upload lands in needs_review; approve it so it counts on the timeline
	// (checked below) and shows on the year page after the delete/restore round-trip.
	await approveItems(page, [completeBody.item.id]);

	const range = await page.request.get(completeBody.item.urls.original, {
		headers: { range: 'bytes=2-4' }
	});
	expect(range.status()).toBe(206);
	expect(range.headers()['content-range']).toBe(`bytes 2-4/${bytes.length}`);
	expect(new Uint8Array(await range.body())).toEqual(new Uint8Array(bytes.slice(2, 5)));

	const timeline = await page.request.get('/api/timeline');
	expect(timeline.ok()).toBe(true);
	expect((await timeline.json()).years.map((y: { year: number }) => y.year)).toContain(1994);

	const duplicate = await page.request.post('/api/upload/init', {
		data: { sha256, sizeBytes: bytes.length, mime: 'video/mp4', filename: 'tiny.mp4' }
	});
	expect((await duplicate.json()).duplicateItemId).toBe(completeBody.item.id);

	const deleted = await page.request.delete(`/api/items/${completeBody.item.id}`);
	expect(deleted.ok()).toBe(true);
	const missing = await page.request.get(`/api/items/${completeBody.item.id}`);
	expect(missing.status()).toBe(404);

	const restored = await page.request.post(`/api/items/${completeBody.item.id}`, {
		data: { action: 'restore' }
	});
	expect(restored.ok()).toBe(true);

	await page.goto('/?y=1994');
	await expect(page.getByRole('heading', { name: '1994' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open Tiny clip' })).toBeVisible();
	await expect(page.getByText(/moments/)).toBeVisible();
});
