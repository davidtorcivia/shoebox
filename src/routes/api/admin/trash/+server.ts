import { error, json } from '@sveltejs/kit';
import { emptyTrash, listTrash, restoreTrash } from '$lib/server/trash';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'admin');
	return json(await listTrash(locals.db));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as {
		action?: unknown;
		kind?: unknown;
		id?: unknown;
	} | null;
	if (
		!body ||
		body.action !== 'restore' ||
		(body.kind !== 'item' && body.kind !== 'album' && body.kind !== 'comment') ||
		typeof body.id !== 'string'
	) {
		error(400, 'Expected { action: "restore", kind, id }');
	}
	await restoreTrash(locals.db, body.kind, body.id);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
	if (!body || body.confirm !== 'empty the trash') {
		error(400, 'Type "empty the trash" to confirm.');
	}
	return json(await emptyTrash(locals.db, locals.platform.storage));
};
