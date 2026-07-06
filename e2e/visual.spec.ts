import { expect, test, type Page } from '@playwright/test';
import { ensureOwner } from './helpers/auth';

// Visual baselines are Linux artifacts (font rendering differs per OS). Run on
// Linux CI or set SHOEBOX_VISUAL=1; generate baselines with the Playwright Docker
// image that matches the installed @playwright/test major/minor.
test.skip(
	!(process.platform === 'linux' || process.env.SHOEBOX_VISUAL === '1'),
	'Linux visual baselines'
);

test.describe.configure({ mode: 'serial' });

const YEARS = [1948, 1955, 1967, 1974, 1988, 1994, 2003, 2015, 2024];

let page: Page;

test.beforeAll(async ({ browser }) => {
	page = await browser
		.newContext({ viewport: { width: 1440, height: 900 } })
		.then((c) => c.newPage());
	await ensureOwner(page);
});

test.afterAll(async () => {
	await page.close();
});

for (const scheme of ['dark', 'light'] as const) {
	for (const year of YEARS) {
		test(`${scheme} timeline at ${year}`, async () => {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`/?y=${year}`);
			await page.getByTestId('century-rail').waitFor();
			await expect(page).toHaveScreenshot(`timeline-${year}-${scheme}.png`, {
				mask: [page.locator('img, video')]
			});
		});
	}
}
