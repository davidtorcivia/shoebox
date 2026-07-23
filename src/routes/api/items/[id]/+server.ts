import { json } from '@sveltejs/kit';
import {
	canModifyItem,
	deleteItem,
	getItemDTO,
	restoreItem,
	setItemPoster,
	updateItem,
	type UpdateItemInput
} from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import type { ItemDate } from '$lib/domain/dates';
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
		normalizeUpdatePatch((await request.json()) as FlatUpdateItemInput | UpdateItemInput)
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
	const body = (await request.json()) as { action?: string; posterTime?: number };
	if (body.action === 'setPoster') {
		const user = requireRole(locals, 'uploader');
		if (typeof body.posterTime !== 'number') {
			return json({ message: 'posterTime must be a number' }, { status: 400 });
		}
		const item = await setItemPoster(
			locals.db,
			locals.platform.storage,
			locals.platform.queue,
			user,
			params.id,
			body.posterTime
		);
		return json({ item });
	}
	if (body.action === 'restore') {
		requireRole(locals, 'editor');
		const item = await restoreItem(locals.db, locals.platform.storage, params.id);
		return json({ item });
	}
	return json({ message: 'Unknown action' }, { status: 400 });
};

type FlatUpdateItemInput = {
	title?: string | null;
	description?: string | null;
	tapeLabel?: string | null;
	location?: string | null;
	dateStart?: string | null;
	dateEnd?: string | null;
	datePrecision?: ItemDate['precision'];
	captureTime?: string | null;
	people?: string[];
	tags?: string[];
};

function normalizeUpdatePatch(input: FlatUpdateItemInput | UpdateItemInput): UpdateItemInput {
	if ('date' in input) return input;
	const flat = input as FlatUpdateItemInput;
	const patch: UpdateItemInput = {
		title: flat.title,
		description: flat.description,
		tapeLabel: flat.tapeLabel,
		location: flat.location,
		captureTime: flat.captureTime,
		people: flat.people,
		tags: flat.tags
	};
	if (flat.datePrecision) {
		patch.date = {
			dateStart: flat.dateStart ?? null,
			dateEnd: flat.dateEnd ?? null,
			precision: flat.datePrecision
		};
	}
	return patch;
}
