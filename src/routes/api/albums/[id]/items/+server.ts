import { error, json } from '@sveltejs/kit';
import {
	addAlbumItems,
	canEditAlbum,
	getAlbumDetail,
	removeAlbumItems,
	reorderAlbum
} from '$lib/server/albums';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

async function editableAlbum(locals: App.Locals, id: string) {
	const user = requireRole(locals, 'uploader');
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, id);
	if (!detail) error(404, 'album not found');
	if (!canEditAlbum(user, detail.album)) error(403, 'not your album');
	return detail;
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	await editableAlbum(locals, params.id);
	const body = (await request.json().catch(() => null)) as {
		add?: unknown;
		remove?: unknown;
	} | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'invalid body');
	const add = body.add ?? [];
	const remove = body.remove ?? [];
	if (!Array.isArray(add) || !Array.isArray(remove)) error(400, 'add and remove must be arrays');
	if (add.some((itemId) => typeof itemId !== 'string')) error(400, 'add must contain item ids');
	if (remove.some((itemId) => typeof itemId !== 'string')) {
		error(400, 'remove must contain item ids');
	}

	if (add.length > 0) await addAlbumItems(locals.db, params.id, add);
	if (remove.length > 0) await removeAlbumItems(locals.db, params.id, remove);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	await editableAlbum(locals, params.id);
	const body = (await request.json().catch(() => null)) as { positions?: unknown } | null;
	if (!body || !Array.isArray(body.positions)) error(400, 'positions array required');
	for (const position of body.positions) {
		if (
			typeof position !== 'object' ||
			position === null ||
			Array.isArray(position) ||
			typeof (position as { itemId?: unknown }).itemId !== 'string' ||
			typeof (position as { position?: unknown }).position !== 'number'
		) {
			error(400, 'invalid position');
		}
	}
	await reorderAlbum(
		locals.db,
		params.id,
		body.positions as { itemId: string; position: number }[]
	);
	return json({ ok: true });
};
