import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { E2E_ENV, E2E_INGEST_DIR } from './env';
import { FIXTURE_MP4 } from './fixtures/generate';
import { approveAllPending } from './helpers/arrivals';
import { ensureOwner } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

let worker: ChildProcess;

test.beforeAll(() => {
	worker = spawn('pnpm', ['worker'], {
		env: { ...process.env, ...E2E_ENV },
		stdio: 'inherit',
		shell: true
	});
});

test.afterAll(async () => {
	if (worker && worker.exitCode === null) {
		const exited = new Promise((resolve) => worker.once('exit', resolve));
		worker.kill('SIGTERM');
		await exited;
	}
});

function dropIntoIngest(relPath: string): void {
	const dest = join(E2E_INGEST_DIR, relPath);
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(FIXTURE_MP4, dest);
}

test('folder drop to Arrivals approve to timeline with sprite hover-scrub', async ({ page }) => {
	await ensureOwner(page);
	// Other specs (running earlier in this shared DB) leave approved-pending uploads
	// in the queue; drain them so this test's count assertions see only its drop.
	await approveAllPending(page);

	dropIntoIngest('1994/christmas/clip.mp4');

	await expect(async () => {
		await page.goto('/arrivals');
		await expect(page.getByTestId('arrivals-row')).toHaveCount(1);
	}).toPass({ timeout: 60_000 });

	const row = page.getByTestId('arrivals-row');
	const itemId = await row.getAttribute('data-item-id');
	expect(itemId).toBeTruthy();
	await expect(page.getByTestId('arrivals-date')).toContainText('1994');
	await expect(
		page.getByTestId('hint-chip').filter({ hasText: 'christmas' }).first()
	).toBeVisible();
	await expect(page.getByTestId('arrivals-preview')).toBeVisible();

	await row.locator('button').first().click();
	await page.locator('body').press('Enter');
	await expect(page.getByTestId('arrivals-row')).toHaveCount(0, { timeout: 15_000 });

	await page.goto('/?y=1994');
	const card = page.getByRole('button', { name: /Open clip/i }).first();
	await expect(card).toBeVisible({ timeout: 15_000 });

	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/items?year=1994&status=ready');
				const body = (await res.json()) as {
					items: { id: string; urls: { sprite?: string | null } }[];
				};
				return body.items.find((item) => item.id === itemId)?.urls.sprite ?? null;
			},
			{ timeout: 90_000, message: 'sprite derivative never appeared' }
		)
		.not.toBeNull();

	await page.goto('/?y=1994');
	// Target this drop's own card by id — other specs seed items titled "…clip"
	// too, so a name-based .first() would race onto the wrong (spriteless) card.
	const readyCard = page.locator(`[data-item-id="${itemId}"]`);
	await readyCard.hover();
	await readyCard.hover({ position: { x: 60, y: 30 } });
	await expect(readyCard.locator('[data-testid="scrub-hairline"]')).toBeVisible();
});

test('dropping identical bytes again lands in _duplicates', async () => {
	dropIntoIngest('1994/christmas/clip-copy.mp4');

	await expect
		.poll(
			() => {
				const dir = join(E2E_INGEST_DIR, '_duplicates');
				return existsSync(dir) && readdirSync(dir).some((file) => file.includes('clip-copy'));
			},
			{ timeout: 60_000, message: 'duplicate never routed to _duplicates' }
		)
		.toBe(true);
});
