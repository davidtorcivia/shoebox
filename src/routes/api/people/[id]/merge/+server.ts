import { error, json } from '@sveltejs/kit';
import { mergePeople } from '$lib/server/people';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as { into?: unknown } | null;
	if (!body || typeof body.into !== 'string' || !body.into)
		error(400, 'into (target person id) is required');
	// params.id is the source; it is folded into `into` and then deleted.
	await mergePeople(locals.db, params.id, body.into);
	return json({ ok: true });
};
