import { json } from '@sveltejs/kit';
import {
	canModifyItem,
	deleteItem,
	getItemDTO,
	restoreItem,
	updateItem,
	type UpdateItemInput
} from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	const item = await getItemDTO(locals.db, locals.platform.storage, params.id);
	return item ? json({ item }) : json({ message: 'Not found' }, { status: 404 });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'uploader');
	const item = await updateItem(
		locals.db,
		locals.platform.storage,
		user,
		params.id,
		(await request.json()) as UpdateItemInput
	);
	return json({ item });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'uploader');
	const item = await getItemDTO(locals.db, locals.platform.storage, params.id);
	if (!item) return json({ message: 'Not found' }, { status: 404 });
	if (!canModifyItem(user, { uploadedBy: item.uploadedBy })) {
		return json({ message: 'Forbidden' }, { status: 403 });
	}
	await deleteItem(locals.db, params.id);
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json()) as { action?: string };
	if (body.action !== 'restore') return json({ message: 'Unknown action' }, { status: 400 });
	const item = await restoreItem(locals.db, locals.platform.storage, params.id);
	return json({ item });
};
