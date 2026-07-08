import { json } from '@sveltejs/kit';
import { parseOmnibox } from '$lib/domain/search-query';
import { itemDTOsByIds } from '$lib/server/items';
import { parseCrop } from '$lib/server/people';
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
	const [peopleCards, albumCards] = wantCards
		? await Promise.all([
				searchPeopleCards(locals.db, parsed.text),
				searchAlbumCards(locals.db, parsed.text)
			])
		: [[], []];
	const people = await Promise.all(
		peopleCards.map(async ({ avatarStorageKey, avatarCrop, ...person }) => ({
			...person,
			avatarUrl: avatarStorageKey ? await locals.platform.storage.mediaUrl(avatarStorageKey) : null,
			avatarCrop: parseCrop(avatarCrop)
		}))
	);
	const albums = await Promise.all(
		albumCards.map(async ({ coverStorageKey, ...album }) => ({
			...album,
			coverUrl: coverStorageKey ? await locals.platform.storage.mediaUrl(coverStorageKey) : null
		}))
	);

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
