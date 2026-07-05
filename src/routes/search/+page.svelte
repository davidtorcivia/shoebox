<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { serializeQuery, type SearchQuery } from '$lib/domain/search-query';
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import type { ItemDTO } from '$lib/types';
	import type { PageData } from './$types';
	import type { SearchResultDTO } from './+page';

	let { data }: { data: PageData } = $props();

	let draft = $state('');
	let extraItems = $state<SearchResultDTO['items']>([]);
	let nextCursor = $state<string | null>(null);

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
		if (base.type) out.push({ label: `type: ${base.type}`, q: without((copy) => delete copy.type) });
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
				label: base.yearFrom === base.yearTo ? `${base.yearFrom}` : `${base.yearFrom}-${base.yearTo}`,
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
		void goto(value ? resolve(`/search?q=${encodeURIComponent(value)}`) : resolve('/search'));
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
			<button class="omnibox-go" type="submit">Search</button>
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
							<a
								class="person-card"
								href={resolve(`/people/${person.slug}`)}
								style={`--accent:${person.accentColor}`}
							>
								<span class="person-mark">{person.name.slice(0, 1)}</span>
								<span class="card-name">{person.name}</span>
							</a>
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
								<span class="card-name">{album.title}</span>
								<span class="card-count">
									{album.itemCount} {album.itemCount === 1 ? 'moment' : 'moments'}
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
				<p class="empty" data-testid="search-empty">No matching moments.</p>
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
		padding: 42px 30px 90px;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.1) 0%, rgb(23 20 18 / 0.68) 100%);
		color: var(--cream);
	}

	.omnibox {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		max-width: 1120px;
		margin: 0 auto;
	}

	.omnibox-input {
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

	.omnibox-go,
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

	.omnibox-go {
		min-height: 68px;
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
		grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
		gap: 12px;
	}

	.person-card,
	.album-card {
		display: grid;
		min-height: 96px;
		align-content: end;
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		padding: 14px;
		text-decoration: none;
	}

	.person-card {
		grid-template-columns: 48px minmax(0, 1fr);
		align-items: end;
		align-content: stretch;
		gap: 12px;
	}

	.person-mark {
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		background: var(--accent);
		color: var(--ink);
		font-family: var(--font-serif);
		font-size: 24px;
		line-height: 1;
	}

	.card-name {
		overflow-wrap: anywhere;
		font-family: var(--font-serif);
		font-size: 21px;
		line-height: 1.1;
	}

	.card-count {
		margin-top: 8px;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		opacity: 0.66;
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
			padding: 24px 16px 76px;
		}

		.omnibox {
			grid-template-columns: 1fr;
		}

		.omnibox-input {
			font-size: 24px;
		}

		.card-row {
			grid-template-columns: 1fr;
		}
	}
</style>
