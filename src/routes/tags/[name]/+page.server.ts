import { error, redirect } from '@sveltejs/kit';
import { serializeQuery } from '$lib/domain/search-query';
import { itemDTOsByIds } from '$lib/server/items';
import { executeSearch } from '$lib/server/search';
import { getTagByName, getTagOverview } from '$lib/server/tags';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');

	const name = decodeURIComponent(params.name);
	const tag = await getTagByName(locals.db, name);
	if (!tag) error(404, 'Tag not found');

	const overview = await getTagOverview(locals.db, locals.platform.storage, tag);

	// Newest-first, keyset-paginated — same engine the omnibox uses, so the
	// client can page further through /api/search with this exact query string.
	const query = { text: '', people: [], tags: [tag.name] };
	const searchQ = serializeQuery(query);
	const exec = await executeSearch(locals.db, query, { limit: 60 });
	const items = await itemDTOsByIds(locals, exec.itemIds);

	return { tag: overview, items, nextCursor: exec.nextCursor, searchQ };
};
