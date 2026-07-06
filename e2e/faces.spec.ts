import { expect, test } from '@playwright/test';
import { seedFaces, type FacesSeed } from './helpers/faces-seed';
import { ensureOwner } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

let seed: FacesSeed;

test.beforeEach(async ({ page }) => {
	await ensureOwner(page);
	seed = seedFaces();
});

test('admin reviews a face cluster and item room shows confirmed overlay', async ({ page }) => {
	await page.goto('/admin/faces');
	await expect(page.getByRole('link', { name: 'Faces' })).toBeVisible();
	await expect(page.getByTestId('face-cluster')).toHaveCount(1);

	await page.getByTestId('face-person-select').selectOption(seed.personId);
	await Promise.all([
		page.waitForResponse(
			(res) => res.url().includes(`/api/admin/faces/clusters/${seed.clusterId}/assign`) && res.ok()
		),
		page.getByTestId('face-assign').click()
	]);
	await expect(page.getByText('No face suggestions are waiting for review.')).toBeVisible();

	await page.goto(`/item/${seed.itemId}`);
	await expect(page.getByRole('button', { name: 'Faces' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('face-box')).toBeVisible();
	await expect(page.getByTestId('face-box')).toContainText('Marta Face Review');
	await expect(page.getByTestId('face-box')).toHaveAttribute('href', `/people/${seed.personSlug}`);
});
