import { error, json } from '@sveltejs/kit';
import {
	confirmSuggestedPerson,
	confirmedFacesForItem,
	dismissSuggestedPerson
} from '$lib/server/faces';
import { requireFaces } from '$lib/server/faces-gate';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	requireFaces(locals.platform);
	return json({ faces: await confirmedFacesForItem(locals.db, params.id) });
};

// Act on a suggested person for this item ("looks like X" chips): confirm tags
// the person and confirms their faces; dismiss records "not them" so the
// suggestion stays gone across future rescans. Mirrors the editor-level gating
// of the cluster review route.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	requireFaces(locals.platform);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.personId !== 'string' || !body.personId) {
		error(400, 'personId is required');
	}

	if (body.action === 'confirm') {
		await confirmSuggestedPerson(locals.db, params.id, body.personId);
		return json({ ok: true });
	}
	if (body.action === 'dismiss') {
		await dismissSuggestedPerson(locals.db, params.id, body.personId);
		return json({ ok: true });
	}
	error(400, 'unknown action');
};
