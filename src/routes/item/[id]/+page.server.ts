import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { contextFromParams, neighborsOf } from '$lib/server/neighbors';
import { items } from '$lib/server/db/schema';
import { confirmedFacesForItem } from '$lib/server/faces';
import { listPeople } from '$lib/server/people';
import { requireRole, ROLE_RANK } from '$lib/server/roles';
import type { ItemDTO } from '$lib/dto';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, params, url }) => {
	const me = requireRole(locals, 'user');
	const res = await fetch(`/api/items/${params.id}`);
	if (!res.ok) error(res.status, 'Item not found');
	const body = (await res.json()) as { item?: ItemDTO } | ItemDTO;
	const item = ('item' in body ? body.item : body) as ItemDTO;
	if (!item?.id) error(404, 'Item not found');

	const [row] = await locals.db
		.select({ source: items.source })
		.from(items)
		.where(eq(items.id, params.id))
		.limit(1);
	if (!row) error(404, 'Item not found');

	const neighbors = await neighborsOf(locals.db, params.id, contextFromParams(url.searchParams));
	const canEdit = ROLE_RANK[me.role] >= ROLE_RANK.editor || item.uploadedBy === me.id;
	const canDelete = ROLE_RANK[me.role] >= ROLE_RANK.admin;
	const y = url.searchParams.get('y');
	const backYear = y && Number.isInteger(Number(y)) ? Number(y) : null;
	const facesEnabled = locals.platform.features.faces;

	return {
		item,
		source: row.source,
		neighbors,
		me,
		canEdit,
		canDelete,
		canCreatePeople: ROLE_RANK[me.role] >= ROLE_RANK.editor,
		canShare: ROLE_RANK[me.role] >= ROLE_RANK.editor,
		facesEnabled,
		faces: facesEnabled ? await confirmedFacesForItem(locals.db, item.id) : [],
		people: await listPeople(locals.db, locals.platform.storage),
		backYear,
		contextQuery: url.searchParams.toString()
	};
};
