import { error } from '@sveltejs/kit';
import type { ItemDTO } from '$lib/types';
import type { YearCount } from '$lib/ui/rail-math';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const timelineRes = await fetch('/api/timeline');
	if (!timelineRes.ok) throw error(timelineRes.status, 'Timeline unavailable');
	const timeline = (await timelineRes.json()) as {
		years: YearCount[];
		earliest: number | null;
		latest: number | null;
	};
	const now = new Date().getFullYear();
	const requested = Number(url.searchParams.get('y'));
	const fallback = timeline.latest ?? 2000;
	const activeYear =
		Number.isInteger(requested) && requested >= 1 && requested <= now
			? requested
			: Math.min(fallback, now);
	const itemsRes = await fetch(`/api/items?year=${activeYear}&limit=100`);
	if (!itemsRes.ok) throw error(itemsRes.status, 'Items unavailable');
	const items = (await itemsRes.json()) as { items: ItemDTO[]; nextCursor: string | null };

	return {
		timeline,
		activeYear,
		items: items.items,
		nextCursor: items.nextCursor,
		now
	};
};
