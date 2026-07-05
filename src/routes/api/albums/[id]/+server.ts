import { error, json } from '@sveltejs/kit';
import {
	canEditAlbum,
	getAlbumDetail,
	softDeleteAlbum,
	updateAlbum
} from '$lib/server/albums';
import { getItemDTOsByIds } from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

async function loadOr404(locals: App.Locals, id: string) {
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, id);
	if (!detail) error(404, 'album not found');
	return detail;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	const { album, itemIds } = await loadOr404(locals, params.id);
	const items = await getItemDTOsByIds(locals.db, locals.platform.storage, itemIds);
	return json({ album, items });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'uploader');
	const { album } = await loadOr404(locals, params.id);
	if (!canEditAlbum(user, album)) error(403, 'not your album');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'invalid body');

	await updateAlbum(locals.db, params.id, {
		title: typeof body.title === 'string' ? body.title : undefined,
		description:
			typeof body.description === 'string' || body.description === null
				? body.description
				: undefined,
		coverItemId:
			typeof body.coverItemId === 'string' || body.coverItemId === null
				? body.coverItemId
				: undefined
	});
	const { album: updated } = await loadOr404(locals, params.id);
	return json({ album: updated });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'uploader');
	const { album } = await loadOr404(locals, params.id);
	if (!canEditAlbum(user, album)) error(403, 'not your album');
	await softDeleteAlbum(locals.db, params.id);
	return json({ ok: true });
};
