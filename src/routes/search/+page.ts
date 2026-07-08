import type { CropRect } from '$lib/domain/people-dto';
import type { SearchQuery } from '$lib/domain/search-query';
import type { ItemDTO } from '$lib/types';
import type { PageLoad } from './$types';

export interface SearchPersonCard {
	id: string;
	slug: string;
	name: string;
	accentColor: string;
	avatarItemId: string | null;
	avatarUrl: string | null;
	avatarCrop: CropRect | null;
}

export interface SearchAlbumCard {
	id: string;
	title: string;
	coverItemId: string | null;
	coverUrl: string | null;
	itemCount: number;
}

export interface SearchResultDTO {
	items: ItemDTO[];
	people: SearchPersonCard[];
	albums: SearchAlbumCard[];
	nextCursor: string | null;
	query: SearchQuery;
	warnings: string[];
}

export const load: PageLoad = async ({ url, fetch }) => {
	const q = url.searchParams.get('q') ?? '';
	if (!q.trim()) return { q, result: null as SearchResultDTO | null };

	const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
	if (!res.ok) return { q, result: null as SearchResultDTO | null };
	return { q, result: (await res.json()) as SearchResultDTO };
};
