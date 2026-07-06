import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureOwner, seedPlayerRoom } from './helpers/seed-player';

test.describe.configure({ mode: 'serial' });

let seeded:
	| {
			videoId: string;
			personId: string;
	  }
	| undefined;

async function ensureSeeded(page: Page): Promise<NonNullable<typeof seeded>> {
	await ensureOwner(page);
	if (!seeded) seeded = await seedPlayerRoom(page);
	return seeded;
}

async function enableComfort(page: Page): Promise<void> {
	await page.goto('/profile');
	const toggle = page.getByTestId('comfort-toggle');
	if (!(await toggle.isChecked())) await toggle.check();
	await page.getByTestId('save-appearance').click();
	await expect(page.locator('html.comfort')).toHaveCount(1);
}

async function expectNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
	const results = await new AxeBuilder({ page }).analyze();
	const serious = results.violations.filter(
		(violation) => violation.impact === 'serious' || violation.impact === 'critical'
	);
	expect(
		serious.map((violation) => ({
			id: violation.id,
			nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html }))
		})),
		label
	).toEqual([]);
}

test.beforeEach(async ({ page }) => {
	await ensureSeeded(page);
	await enableComfort(page);
});

test('comfort type scale, chrome opacity, and hit areas', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html.comfort')).toHaveCount(1);

	await expect
		.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
		.toBe('20px');
	await expect
		.poll(() =>
			page.evaluate(() =>
				Number(
					getComputedStyle(document.documentElement).getPropertyValue('--chrome-opacity').trim()
				)
			)
		)
		.toBe(0.75);

	const tooSmall = await page.evaluate(() =>
		[...document.querySelectorAll('button')]
			.filter((button) => button.offsetParent !== null)
			.filter((button) => button.getBoundingClientRect().height < 48)
			.map((button) => button.textContent?.trim() || button.getAttribute('aria-label') || '')
	);
	expect(tooSmall).toEqual([]);
});

for (const scheme of ['dark', 'light'] as const) {
	test(`axe scan in comfort mode, ${scheme}`, async ({ page }) => {
		const ids = await ensureSeeded(page);
		await page.emulateMedia({ colorScheme: scheme });
		for (const path of ['/', `/item/${ids.videoId}`, `/people/${ids.personId}`, '/search']) {
			await page.goto(path);
			await page.waitForLoadState('networkidle');
			await expectNoSeriousAxeViolations(page, `${path} ${scheme}`);
		}
	});
}

test('comfort mode disables hover scrub and exposes preview stepping', async ({ page }) => {
	await page.goto('/?y=1994');
	const videoCard = page.locator('[data-type="video"]').first();
	await expect(videoCard).toBeVisible();

	await videoCard.hover();
	await expect(videoCard.locator('[data-testid="scrub-hairline"]')).toHaveCount(0);

	const preview = videoCard.getByRole('button', { name: 'Preview' });
	await expect(preview).toBeVisible();
	await preview.click();
	await expect(videoCard.locator('.sprite.visible')).toHaveCount(1);
});
