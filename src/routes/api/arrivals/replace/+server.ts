import { error, json } from '@sveltejs/kit';
import { replaceItemMedia } from '$lib/server/replace-media';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

// Swap a ready item's media for a re-ingested file with the same name, keeping
// all curation, and discard the arrival. Admin-only, like the rest of arrivals.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.itemId !== 'string' || typeof body.targetId !== 'string') {
		error(400, 'itemId and targetId are required');
	}
	await replaceItemMedia(
		locals.db,
		locals.platform.storage,
		locals.platform.queue,
		body.targetId,
		body.itemId,
		{ faces: locals.platform.features.faces }
	);
	return json({ ok: true });
};
