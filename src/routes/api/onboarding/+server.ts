import { error, json } from '@sveltejs/kit';
import { completeTour, updateAppearance } from '$lib/server/profile';
import type { RequestHandler } from './$types';

/**
 * Guided-tour endpoint. Two actions:
 *  - complete: the user finished or skipped the walk; stamp tour_version so it
 *    never autostarts again (replay from the profile stays available).
 *  - comfort: the welcome step's "larger text and calmer motion" quick apply,
 *    persisted through the same validated path as the profile appearance form.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');
	const body = (await request.json().catch(() => null)) as {
		action?: unknown;
		version?: unknown;
		enabled?: unknown;
	} | null;

	if (body?.action === 'complete') {
		const version = Number(body.version);
		if (!Number.isInteger(version) || version < 1) error(400, 'version must be a positive integer');
		await completeTour(locals.db, locals.user.id, version);
		locals.user = { ...locals.user, tourVersion: Math.max(version, locals.user.tourVersion) };
		return json({ ok: true });
	}

	if (body?.action === 'comfort') {
		if (typeof body.enabled !== 'boolean') error(400, 'enabled must be a boolean');
		await updateAppearance(locals.db, locals.user.id, { comfortMode: body.enabled });
		locals.user = { ...locals.user, comfortMode: body.enabled };
		return json({ ok: true });
	}

	error(400, 'action must be complete or comfort');
};
