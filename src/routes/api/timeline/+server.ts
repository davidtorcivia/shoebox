import { json } from '@sveltejs/kit';
import { parseOmnibox } from '$lib/domain/search-query';
import { timelineYears } from '$lib/server/aggregates';
import { requireRole } from '$lib/server/roles';
import { filterFromQuery, filteredYearCounts, type ItemFilter } from '$lib/server/search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'user');
	const params = url.searchParams;
	const hasFilters = ['people', 'tags', 'type', 'album', 'q', 'uploader'].some((key) =>
		params.get(key)
	);

	if (hasFilters) {
		const filter: ItemFilter = params.get('q') ? filterFromQuery(parseOmnibox(params.get('q')!)) : {};
		if (params.get('people')) filter.personIds = params.get('people')!.split(',').filter(Boolean);
		if (params.get('tags')) filter.tagIds = params.get('tags')!.split(',').filter(Boolean);
		const type = params.get('type');
		if (type === 'video' || type === 'photo') filter.type = type;
		if (params.get('album')) filter.albumId = params.get('album')!;
		if (params.get('uploader')) filter.uploaderUsername = params.get('uploader')!;

		const years = await filteredYearCounts(locals.db, filter);
		return json({
			years,
			earliest: years[0]?.year ?? null,
			latest: years.at(-1)?.year ?? null
		});
	}

	return json(await timelineYears(locals.db));
};
