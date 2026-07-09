<script lang="ts">
	import { resolve } from '$app/paths';
	import { tagDisplayLabel } from '$lib/domain/tags';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import { ACCENTS, personRoomFor } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let extraItems = $state<ItemDTO[]>([]);
	let nextCursor = $state<string | null>(null);
	let loadingMore = $state(false);

	$effect(() => {
		// Reset when navigating between tags.
		extraItems = [];
		nextCursor = data.nextCursor;
	});

	const tag = $derived(data.tag);
	const label = $derived(tagDisplayLabel(tag.name, tag.kind));
	const items = $derived([...data.items, ...extraItems]);
	const accent = $derived(ACCENTS[tag.id.charCodeAt(0) % ACCENTS.length].hex);
	const room = $derived(personRoomFor(accent));
	const activeYear = $derived(yearFor(items[0]) ?? tag.yearTo ?? new Date().getFullYear());

	const span = $derived.by(() => {
		if (tag.yearFrom == null || tag.yearTo == null) return null;
		return tag.yearFrom === tag.yearTo ? `${tag.yearFrom}` : `${tag.yearFrom} – ${tag.yearTo}`;
	});

	const breakdown = $derived.by(() => {
		const parts: string[] = [];
		if (tag.photoCount)
			parts.push(`${tag.photoCount} ${tag.photoCount === 1 ? 'photo' : 'photos'}`);
		if (tag.videoCount)
			parts.push(`${tag.videoCount} ${tag.videoCount === 1 ? 'video' : 'videos'}`);
		return parts.join(' · ');
	});

	function yearFor(item: ItemDTO | undefined): number | null {
		const raw = item?.date.dateStart ?? item?.date.dateEnd ?? '';
		const year = Number(raw.slice(0, 4));
		return Number.isInteger(year) && year > 0 ? year : null;
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const res = await fetch(
				`/api/search?q=${encodeURIComponent(data.searchQ)}&cursor=${encodeURIComponent(nextCursor)}`
			);
			if (!res.ok) return;
			const body = (await res.json()) as { items: ItemDTO[]; nextCursor: string | null };
			extraItems = [...extraItems, ...body.items];
			nextCursor = body.nextCursor;
		} finally {
			loadingMore = false;
		}
	}
</script>

<svelte:head>
	<title>{label} - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="hero">
			<div class="eyebrow">{tag.kind === 'holiday' ? 'Holiday' : 'Tag'}</div>
			<h1 data-testid="tag-title">{label}</h1>
			<div class="stats" data-testid="tag-stats">
				<span><b>{tag.count}</b>{tag.count === 1 ? 'moment' : 'moments'}</span>
				{#if breakdown}<span class="dot">{breakdown}</span>{/if}
				{#if span}<span class="dot">{span}</span>{/if}
			</div>
		</header>

		{#if tag.people.length}
			<section class="people-strip" data-testid="tag-people">
				<h2>Who's here</h2>
				<div class="faces">
					{#each tag.people as person (person.id)}
						<a class="face" href={resolve(`/people/${person.slug}`)}>
							<Avatar
								name={person.name}
								accentColor={person.accentColor}
								size={44}
								avatarUrl={person.avatarUrl}
								avatarCrop={person.avatarCrop}
							/>
							<span class="face-name">{person.name}</span>
							<span class="face-count">{person.count}</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if items.length}
			<section class="results" data-testid="tag-results">
				<MasonryGrid {items} {activeYear} />
			</section>
			{#if nextCursor}
				<button class="more" type="button" onclick={loadMore} disabled={loadingMore}>
					{loadingMore ? 'Loading…' : 'More'}
				</button>
			{/if}
		{:else}
			<p class="empty" data-testid="tag-empty">Nothing tagged {label} yet.</p>
		{/if}
	</section>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
		--timeline-chrome: var(--cream);
		--timeline-muted: color-mix(in srgb, var(--cream) 72%, transparent);
		--timeline-soft: color-mix(in srgb, var(--cream) 16%, transparent);
		--timeline-strong: color-mix(in srgb, var(--cream) 90%, transparent);
	}

	.page {
		position: relative;
		min-height: 100vh;
		padding: 58px 30px 90px;
		background:
			radial-gradient(80% 64% at 100% 0%, rgb(23 20 18 / 0.12) 0%, transparent 62%),
			linear-gradient(180deg, rgb(23 20 18 / 0.24) 0%, rgb(23 20 18 / 0.74) 100%);
		color: var(--cream);
	}

	.hero {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 0 auto;
	}

	.eyebrow {
		color: color-mix(in srgb, var(--dawn) 72%, var(--cream) 28%);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.28em;
		text-transform: uppercase;
	}

	h1 {
		margin: 8px 0 0;
		font-family: var(--font-serif);
		font-size: 68px;
		font-weight: 400;
		line-height: 0.98;
		overflow-wrap: anywhere;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		margin-top: 18px;
		color: color-mix(in srgb, var(--cream) 72%, transparent);
		font-family: var(--font-sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.stats b {
		margin-right: 7px;
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 20px;
		font-weight: 400;
	}

	.stats .dot {
		position: relative;
		padding-left: 20px;
	}

	.stats .dot::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 4px;
		height: 4px;
		transform: translateY(-50%);
		border-radius: 50%;
		background: color-mix(in srgb, var(--cream) 42%, transparent);
	}

	.people-strip {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 40px auto 0;
	}

	.people-strip h2 {
		margin: 0 0 14px;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.26em;
		opacity: 0.62;
		text-transform: uppercase;
	}

	.faces {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 12px;
	}

	.face {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 6px 14px 6px 6px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		border-radius: 999px;
		color: var(--cream);
		text-decoration: none;
	}

	.face:hover {
		background: color-mix(in srgb, var(--cream) 20%, transparent);
	}

	.face-name {
		font-family: var(--font-serif);
		font-size: 16px;
	}

	.face-count {
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.1em;
		opacity: 0.6;
	}

	.results {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 34px auto 0;
	}

	.results :global(.masonry) {
		padding-right: 0;
		padding-left: 0;
	}

	.more {
		display: block;
		min-height: 44px;
		margin: 20px auto 0;
		padding: 0 22px;
		border: 0;
		background: var(--cream);
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.more:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.empty {
		position: relative;
		z-index: 1;
		max-width: 1120px;
		margin: 40px auto 0;
		font-family: var(--font-serif);
		font-size: 28px;
		line-height: 1.16;
	}

	@media (max-width: 720px) {
		.page {
			padding: 38px 16px 76px;
		}

		h1 {
			font-size: 42px;
		}
	}
</style>
