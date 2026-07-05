import { json } from '@sveltejs/kit';
import { parseOmnibox } from '$lib/domain/search-query';
import { itemDTOsByIds } from '$lib/server/items';
import { requireRole } from '$lib/server/roles';
import { executeSearch, searchAlbumCards, searchPeopleCards } from '$lib/server/search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'user');

	const q = url.searchParams.get('q') ?? '';
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limitRaw = Number(url.searchParams.get('limit') ?? '48');
	const limit = Number.isFinite(limitRaw) ? limitRaw : 48;

	const parsed = parseOmnibox(q);
	const exec = await executeSearch(locals.db, parsed, { cursor, limit });
	const items = await itemDTOsByIds(locals, exec.itemIds);

	const wantCards = !cursor && parsed.text.trim().length > 0;
	const [people, albums] = wantCards
		? await Promise.all([
				searchPeopleCards(locals.db, parsed.text),
				searchAlbumCards(locals.db, parsed.text)
			])
		: [[], []];

	const { warnings: _warnings, ...query } = parsed;
	return json({
		items,
		people,
		albums,
		nextCursor: exec.nextCursor,
		query,
		warnings: exec.warnings
	});
};
