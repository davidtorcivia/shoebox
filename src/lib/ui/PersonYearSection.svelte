<script lang="ts">
	import type { ItemDTO } from '$lib/types';
	import { ageCaption } from '$lib/ui/age-caption';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';

	let {
		personId,
		year,
		count,
		age,
		allYears,
		descending = false
	}: {
		personId: string;
		year: number;
		count: number;
		age: { min: number; max: number } | null;
		allYears: number[];
		descending?: boolean;
	} = $props();

	let items = $state<ItemDTO[]>([]);
	let loaded = $state(false);

	// The API returns oldest-first; flip to newest-first when sorting descending.
	const orderedItems = $derived(descending ? [...items].reverse() : items);

	const ageLabel = $derived(
		age == null ? '' : age.min === age.max ? `Age ${age.min} · ` : `Age ${age.min}–${age.max} · `
	);

	$effect(() => {
		let cancelled = false;
		loaded = false;
		fetch(`/api/items?people=${personId}&year=${year}&limit=100`)
			.then((res) => res.json())
			.then((data: { items: ItemDTO[] }) => {
				if (!cancelled) {
					items = data.items;
					loaded = true;
				}
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<section class="years" id={`y-${year}`} data-testid={`year-${year}`}>
	<header class="year-head">
		<h3>{year}</h3>
		<span class="age" data-testid={`year-meta-${year}`}>
			{ageLabel}{count} {count === 1 ? 'moment' : 'moments'}
		</span>
		<details class="jump">
			<summary>All years ↓</summary>
			<nav>
				{#each allYears as itemYear (itemYear)}
					<a href={`#y-${itemYear}`}>{itemYear}</a>
				{/each}
			</nav>
		</details>
	</header>
	{#if loaded}
		<MasonryGrid
			items={orderedItems}
			activeYear={year}
			captionRightFor={(item) => ageCaption(item, personId)}
		/>
	{/if}
</section>

<style>
	.years {
		position: relative;
		z-index: 1;
		padding: 34px 0 0;
	}

	.year-head {
		display: flex;
		align-items: baseline;
		gap: 20px;
		padding: 0 30px;
	}

	h3 {
		margin: 0 0 16px;
		font-family: var(--font-serif);
		font-size: 34px;
		font-weight: 400;
		line-height: 1;
	}

	.age {
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.jump {
		position: relative;
		margin-left: auto;
	}

	.jump summary {
		display: flex;
		min-height: 44px;
		align-items: center;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		list-style: none;
		text-transform: uppercase;
	}

	.jump summary::-webkit-details-marker {
		display: none;
	}

	.jump nav {
		position: absolute;
		right: 0;
		z-index: 5;
		display: flex;
		max-height: 40vh;
		flex-direction: column;
		overflow-y: auto;
		background: color-mix(in srgb, var(--ink) 92%, transparent);
		padding: 8px 0;
	}

	.jump nav a {
		display: flex;
		min-height: 44px;
		align-items: center;
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 16px;
		padding: 8px 22px;
		text-decoration: none;
	}

	@media (max-width: 720px) {
		.year-head {
			align-items: flex-start;
			flex-direction: column;
			gap: 4px;
			padding: 0 18px;
		}

		.jump {
			margin-left: 0;
		}
	}
</style>
