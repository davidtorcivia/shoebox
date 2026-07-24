import { error, json } from '@sveltejs/kit';
import { discardArrivals } from '$lib/server/arrivals';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

// Permanently delete queued arrivals (file and all rows, no trash stop).
// Admin-only, like the rest of arrivals.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const itemIds = body?.itemIds;
	if (
		!Array.isArray(itemIds) ||
		itemIds.length === 0 ||
		itemIds.some((id) => typeof id !== 'string')
	) {
		error(400, 'itemIds must be a non-empty string array');
	}
	const result = await discardArrivals(locals.db, locals.platform.storage, itemIds as string[]);
	return json(result);
};
