<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { serializeQuery, type SearchQuery } from '$lib/domain/search-query';
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import PersonCard from '$lib/ui/PersonCard.svelte';
	import { ACCENTS, personRoomFor } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/types';
	import type { PageData } from './$types';
	import type { SearchAlbumCard, SearchPersonCard, SearchResultDTO } from './+page';

	let { data }: { data: PageData } = $props();

	let draft = $state('');
	let extraItems = $state<SearchResultDTO['items']>([]);
	let nextCursor = $state<string | null>(null);
	let liveTimer: ReturnType<typeof setTimeout> | null = null;

	const room = {
		stops: ['#171412', '#5E6F4D', '#FFD9A8'] as [string, string, string],
		pools: [
			{ color: '#FA7B6255', pos: '14% 4%', size: '88% 60%' },
			{ color: '#A8D8EA55', pos: '94% 16%', size: '78% 58%' },
			{ color: '#FFD70033', pos: '54% 112%', size: '90% 54%' }
		]
	};

	$effect(() => {
		draft = data.q;
		extraItems = [];
		nextCursor = data.result?.nextCursor ?? null;
	});

	$effect(() => {
		const value = draft.trim();
		if (value === data.q.trim()) return;
		if (liveTimer) clearTimeout(liveTimer);
		liveTimer = setTimeout(() => {
			void goto(value ? resolve(`/search?q=${encodeURIComponent(value)}`) : resolve('/search'), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}, 240);
		return () => {
			if (liveTimer) clearTimeout(liveTimer);
		};
	});

	const result = $derived(data.result);
	const items = $derived(result ? [...result.items, ...extraItems] : []);
	const activeYear = $derived(yearFor(items[0]));

	type Chip = { label: string; q?: string; warning?: boolean };

	const chips = $derived.by<Chip[]>(() => {
		if (!result) return [];
		const base: SearchQuery = result.query;
		const out: Chip[] = [];
		const without = (mutate: (copy: SearchQuery) => void): string => {
			const copy: SearchQuery = JSON.parse(JSON.stringify(base));
			mutate(copy);
			return serializeQuery(copy);
		};

		for (const person of base.people) {
			out.push({
				label: `person: ${person}`,
				q: without((copy) => {
					copy.people = copy.people.filter((value) => value !== person);
					if (copy.age?.person === person) delete copy.age;
				})
			});
		}
		if (base.age) {
			out.push({
				label:
					base.age.min === base.age.max
						? `age: ${base.age.min}`
						: `age: ${base.age.min}-${base.age.max}`,
				q: without((copy) => delete copy.age)
			});
		}
		for (const tag of base.tags) {
			out.push({
				label: `tag: ${tag}`,
				q: without((copy) => {
					copy.tags = copy.tags.filter((value) => value !== tag);
				})
			});
		}
		if (base.type)
			out.push({ label: `type: ${base.type}`, q: without((copy) => delete copy.type) });
		if (base.album) {
			out.push({ label: `album: ${base.album}`, q: without((copy) => delete copy.album) });
		}
		if (base.uploader) {
			out.push({
				label: `uploader: ${base.uploader}`,
				q: without((copy) => delete copy.uploader)
			});
		}
		if (base.yearFrom != null) {
			out.push({
				label:
					base.yearFrom === base.yearTo ? `${base.yearFrom}` : `${base.yearFrom}-${base.yearTo}`,
				q: without((copy) => {
					delete copy.yearFrom;
					delete copy.yearTo;
				})
			});
		}
		for (const warning of result.warnings) out.push({ label: warning, warning: true });
		return out;
	});

	function yearFor(item: ItemDTO | undefined): number {
		const raw = item?.date.dateStart ?? item?.date.dateEnd ?? '';
		const year = Number(raw.slice(0, 4));
		return Number.isInteger(year) && year > 0 ? year : new Date().getFullYear();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const value = draft.trim();
		if (liveTimer) clearTimeout(liveTimer);
		void goto(value ? resolve(`/search?q=${encodeURIComponent(value)}`) : resolve('/search'), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function removeChip(chip: Chip) {
		if (chip.q === undefined) return;
		void goto(chip.q ? resolve(`/search?q=${encodeURIComponent(chip.q)}`) : resolve('/search'));
	}

	async function loadMore() {
		if (!nextCursor) return;
		const res = await fetch(
			`/api/search?q=${encodeURIComponent(data.q)}&cursor=${encodeURIComponent(nextCursor)}`
		);
		if (!res.ok) return;
		const body = (await res.json()) as SearchResultDTO;
		extraItems = [...extraItems, ...body.items];
		nextCursor = body.nextCursor;
	}

	function personCard(person: SearchPersonCard) {
		return {
			id: person.id,
			slug: person.slug,
			name: person.name,
			accentColor: person.accentColor,
			birthdate: null,
			deathDate: null,
			avatarItemId: person.avatarItemId,
			avatarCrop: null,
			avatarUrl: null,
			itemCount: 0
		};
	}

	function albumFallback(album: SearchAlbumCard) {
		const accent = ACCENTS[album.id.charCodeAt(0) % ACCENTS.length].hex;
		const stops = personRoomFor(accent).stops;
		return `linear-gradient(165deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 135%)`;
	}
</script>

<svelte:head>
	<title>Search - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<form class="omnibox" role="search" onsubmit={submit}>
			<input
				class="omnibox-input"
				type="search"
				name="q"
				placeholder="Search the shoebox"
				aria-label="Search the shoebox"
				autocomplete="off"
				data-testid="omnibox"
				bind:value={draft}
			/>
		</form>

		{#if chips.length}
			<div class="chips" data-testid="chips">
				{#each chips as chip (chip.label)}
					{#if chip.warning}
						<span class="chip warning">{chip.label}</span>
					{:else}
						<button class="chip" type="button" onclick={() => removeChip(chip)}>
							<span>{chip.label}</span>
							<span class="chip-x" aria-hidden="true">x</span>
						</button>
					{/if}
				{/each}
			</div>
		{/if}

		{#if result}
			{#if result.people.length}
				<section class="row-section">
					<h2>People</h2>
					<div class="card-row" data-testid="people-row">
						{#each result.people as person (person.id)}
							<PersonCard person={personCard(person)} />
						{/each}
					</div>
				</section>
			{/if}

			{#if result.albums.length}
				<section class="row-section">
					<h2>Albums</h2>
					<div class="card-row" data-testid="albums-row">
						{#each result.albums as album (album.id)}
							<a class="album-card" href={resolve(`/albums/${album.id}`)}>
								<div class="album-cover">
									{#if album.coverUrl}
										<img src={album.coverUrl} alt={album.title} data-testid="album-cover" />
									{:else}
										<div class="album-fill" style:background-image={albumFallback(album)}></div>
									{/if}
								</div>
								<span class="album-title">{album.title}</span>
								<span class="album-count">
									{album.itemCount}
									{album.itemCount === 1 ? 'moment' : 'moments'}
								</span>
							</a>
						{/each}
					</div>
				</section>
			{/if}

			{#if items.length}
				<section class="results" data-testid="search-results">
					<MasonryGrid {items} {activeYear} />
				</section>
				{#if nextCursor}
					<button class="more" type="button" onclick={loadMore}>More</button>
				{/if}
			{:else if !result.people.length && !result.albums.length}
				<p class="empty" data-testid="search-empty">Nothing found in the shoebox for {data.q}.</p>
			{/if}
		{/if}
	</section>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.page {
		position: relative;
		min-height: 100vh;
		padding: 58px 30px 90px;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.1) 0%, rgb(23 20 18 / 0.68) 100%);
		color: var(--cream);
	}

	.omnibox {
		position: relative;
		z-index: 1;
		width: 100%;
		margin: 0;
	}

	.omnibox-input {
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		min-height: 68px;
		padding: 13px 20px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 30px;
		line-height: 1.12;
		outline-offset: 3px;
	}

	.omnibox-input::placeholder {
		color: color-mix(in srgb, var(--cream) 54%, transparent);
		opacity: 1;
	}

	.more {
		min-height: 44px;
		border: 0;
		background: var(--cream);
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		padding: 0 20px;
		text-transform: uppercase;
	}

	.chips {
		position: relative;
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		max-width: 1120px;
		margin: 14px auto 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 16%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 12px;
		gap: 10px;
		padding: 0 12px;
	}

	.chip.warning {
		cursor: default;
		color: var(--dawn);
	}

	.chip-x {
		font-size: 12px;
		opacity: 0.62;
		text-transform: uppercase;
	}

	.row-section {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 34px auto 0;
	}

	.row-section h2 {
		margin: 0 0 12px;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.26em;
		opacity: 0.62;
		text-transform: uppercase;
	}

	.card-row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 22px 16px;
	}

	.album-card {
		color: var(--cream);
		text-decoration: none;
	}

	.album-cover {
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	.album-cover img,
	.album-fill {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.album-title {
		display: block;
		margin-top: 10px;
		overflow-wrap: anywhere;
		font-family: var(--font-serif);
		font-size: 21px;
		line-height: 1.2;
	}

	.album-count {
		display: block;
		margin-top: 4px;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		opacity: 0.6;
		text-transform: uppercase;
	}

	.results {
		position: relative;
		z-index: 1;
		max-width: 1220px;
		margin: 28px auto 0;
	}

	.results :global(.masonry) {
		padding-right: 0;
		padding-left: 0;
	}

	.more {
		display: block;
		margin: 18px auto 0;
	}

	.empty {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 36px auto 0;
		font-family: var(--font-serif);
		font-size: 28px;
		line-height: 1.16;
	}

	@media (max-width: 720px) {
		.page {
			padding: 38px 16px 76px;
		}

		.omnibox-input {
			font-size: 24px;
		}

		.card-row {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}
	}
</style>
