import { expect, test, type Page } from '@playwright/test';
import { ensureOwner, OWNER } from './helpers/auth';
import { PHASE05_USER, seedPhase05, type Phase05Seed } from './helpers/seed-phase05';

test.describe.configure({ mode: 'serial' });

let seed: Phase05Seed;

async function login(page: Page, creds: { username: string; password: string }) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(creds.username);
	await page.getByLabel('Password').fill(creds.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('/');
}

test.beforeEach(async ({ page }) => {
	await ensureOwner(page);
	seed = seedPhase05();
});

test('relationships derive family rows and year age captions', async ({ page }) => {
	await page.goto(`/people/${seed.slugs.margaret}/edit`);
	const addRel = async (kind: string, personId: string) => {
		await page.getByTestId('rel-kind').selectOption(kind);
		await page.getByTestId('rel-person').click();
		await page.getByTestId(`rel-option-${personId}`).click();
		await page.waitForResponse((res) => res.url().includes('/relationships') && res.ok());
	};
	await addRel('spouse', seed.people.frank);
	await addRel('child', seed.people.david);
	await addRel('child', seed.people.carol);

	await page.goto(`/people/${seed.slugs.margaret}`);
	await expect(page.getByTestId('person-name')).toHaveText('Margaret Torcivia');
	await expect(page.getByTestId('person-room')).toHaveAttribute('data-accent', '#D3826E');
	await expect(page.getByTestId('family-row-spouse')).toContainText('Frank Torcivia');
	await expect(page.getByTestId('family-row-children')).toContainText('David Sr.');
	await expect(page.getByTestId('family-row-children')).toContainText('Carol');
	await expect(page.getByTestId('year-meta-1994')).toHaveText(/Age 53 · 2 moments/);
	await expect(page.getByTestId('year-meta-1993')).toHaveText(/Age 52 · 1 moment/);
});

test('album creation, item-room membership toggle, and comments work together', async ({
	page
}) => {
	await page.goto('/albums');
	await page.getByTestId('new-album').click();
	await page.locator('input[name="title"]').fill('Summer at the Lake');
	await page.getByTestId('create-album').click();
	await page.waitForURL(/\/albums\/.+/);
	const albumId = page.url().split('/albums/')[1];

	for (const itemId of [seed.itemIds[1], seed.itemIds[2]]) {
		await page.goto(`/item/${itemId}`);
		await page.getByText('Edit metadata').click();
		await page.getByTestId('album-toggle').locator('summary').click();
		await page.getByLabel('Search albums').fill('Summer');
		await Promise.all([
			page.waitForResponse((res) => res.url().includes(`/api/albums/${albumId}/items`) && res.ok()),
			page.getByTestId(`album-check-${albumId}`).click()
		]);
	}

	await page.goto(`/albums/${albumId}`);
	await expect(page.getByTestId('album-title')).toHaveText('Summer at the Lake');
	await expect(page.getByText('2 moments')).toBeVisible();
	await page.getByTestId('arrange-toggle').click();
	await expect(page.getByTestId('reorder-tile')).toHaveCount(2);

	await page.goto(`/item/${seed.itemIds[1]}`);
	await page.getByPlaceholder('Add a memory…').fill('A lake day worth remembering.');
	await page.getByRole('button', { name: 'Add memory' }).click();
	await expect(page.getByTestId('comment-list')).toContainText('A lake day worth remembering.');
	await expect(page.getByTestId('comment-username')).toContainText(OWNER.username);
});

test('linked user can edit their person bio', async ({ page }) => {
	const link = await page.request.patch(`/api/admin/users/${seed.linkedUserId}`, {
		data: { personId: seed.people.margaret }
	});
	expect(link.ok()).toBe(true);

	await page.context().clearCookies();
	await login(page, PHASE05_USER);
	await page.goto(`/people/${seed.slugs.margaret}`);
	await expect(page.getByTestId('edit-bio')).toContainText('linked to this person');
	await page.getByTestId('edit-bio').click();
	await page.getByTestId('bio-textarea').fill('She ran the kitchen **like a bridge crew**.');
	await page.getByTestId('bio-save').click();
	await expect(page.getByTestId('person-bio')).toContainText('like a bridge crew');
	await expect(page.getByTestId('person-bio').locator('strong')).toHaveText('like a bridge crew');
});
