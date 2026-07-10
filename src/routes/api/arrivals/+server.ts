import { error, json } from '@sveltejs/kit';
import { applyArrivalsBatch, type ArrivalsRequest } from '$lib/server/arrivals';
import { listItems } from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	const { items } = await listItems(locals.db, locals.platform.storage, {
		status: 'needs_review',
		limit: 100
	});
	return json({ items });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json()) as Partial<ArrivalsRequest>;
	if (
		!Array.isArray(body.itemIds) ||
		body.itemIds.length === 0 ||
		body.itemIds.some((id) => typeof id !== 'string')
	) {
		error(400, 'itemIds must be a non-empty string array');
	}
	if (typeof body.approve !== 'boolean') error(400, 'approve must be a boolean');

	const result = await applyArrivalsBatch(locals.db, {
		itemIds: body.itemIds,
		apply: body.apply,
		approve: body.approve
	});
	return json(result);
};
