import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/auth';

const ROUTES = ['/', '/people', '/albums', '/search', '/upload', '/profile'];

async function expectNoSeriousViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(
		serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
		serious.map((v) => v.description).join('\n')
	).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
	page = await browser.newContext().then((c) => c.newPage());
	await ensureOwner(page);
});

test.afterAll(async () => {
	await page.close();
});

for (const scheme of ['dark', 'light'] as const) {
	test(`axe scan is clean on key routes in ${scheme} mode`, async () => {
		await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
		for (const route of ROUTES) {
			await page.goto(route);
			await page.waitForLoadState('networkidle');
			await expectNoSeriousViolations(page);
		}
	});
}

test('comfort mode enlarges the root font and stays axe-clean', async () => {
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

	await page.goto('/');
	const base = Number(
		(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).replace(
			'px',
			''
		)
	);

	await page.goto('/profile');
	const toggle = page.getByTestId('comfort-toggle');
	if (!(await toggle.isChecked())) await toggle.check();
	await page.getByTestId('save-appearance').click();
	await expect(page.locator('html.comfort')).toHaveCount(1);

	await page.goto('/');
	await expect(page.locator('html.comfort')).toHaveCount(1);
	await expect
		.poll(async () =>
			Number(
				(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).replace(
					'px',
					''
				)
			)
		)
		.toBeGreaterThan(base * 1.1);
	await expectNoSeriousViolations(page);
});
