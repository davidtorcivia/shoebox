import { expect, type Page } from '@playwright/test';

// Uploaded / API-created items now land in `needs_review` (arrivals gating), so
// e2e flows that expect an item on the timeline must approve it first — the same
// thing the unit tests do. Requires an editor+ session (ensureOwner covers it).
export async function approveItems(page: Page, itemIds: string[]): Promise<void> {
	if (itemIds.length === 0) return;
	const res = await page.request.post('/api/arrivals', {
		data: { itemIds, approve: true }
	});
	expect(res.ok()).toBe(true);
}

/** Drain the whole pending-review queue — handy after bulk seeding. */
export async function approveAllPending(page: Page): Promise<void> {
	const res = await page.request.get('/api/arrivals');
	expect(res.ok()).toBe(true);
	const { items } = (await res.json()) as { items: { id: string }[] };
	await approveItems(
		page,
		items.map((item) => item.id)
	);
}
