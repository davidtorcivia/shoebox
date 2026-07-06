import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export async function sha256Of(path: string): Promise<string> {
	const data = await readFile(path);
	return createHash('sha256').update(data).digest('hex');
}

export async function sizeOf(path: string): Promise<number> {
	return (await stat(path)).size;
}

export interface UploadViaUiOpts {
	title: string;
	/** Best-effort year written into the DatePicker if its year input is visible. */
	date?: string;
}

/**
 * Drive the /upload UI: pick a file, set the title, submit, and wait for the
 * upload-complete request to succeed. Returns the created item id from the
 * Location/JSON of the complete response.
 */
export async function uploadViaUi(
	page: Page,
	fixturePath: string,
	opts: UploadViaUiOpts
): Promise<string> {
	await page.goto('/upload');
	await page.locator('input[type="file"]').setInputFiles(fixturePath);
	await page.locator('#upload-title').fill(opts.title);

	if (opts.date) {
		const yearInput = page.locator('.date-field input[type="number"]').first();
		if (await yearInput.isVisible().catch(() => false)) {
			await yearInput.fill(opts.date);
		}
	}

	const [complete] = await Promise.all([
		page.waitForResponse(
			(res) => res.url().includes('/api/upload/complete') && res.status() === 201
		),
		page.getByRole('button', { name: 'Upload' }).click()
	]);
	const body = (await complete.json()) as { item: { id: string } };
	return body.item.id;
}
