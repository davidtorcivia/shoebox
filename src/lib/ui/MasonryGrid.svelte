<script lang="ts">
	import MediaCard from './MediaCard.svelte';
	import MonthBreak from './MonthBreak.svelte';
	import { buildGridEntries } from './masonry';
	import type { ItemDTO } from '$lib/types';

	interface Props {
		items: ItemDTO[];
		activeYear: number;
	}

	let { items, activeYear }: Props = $props();
	const entries = $derived(buildGridEntries(items));
</script>

<section class="masonry" aria-label="Timeline media">
	{#if entries.length === 0}
		<p class="empty">No moments yet for this year.</p>
	{:else}
		{#each entries as entry (entry.id)}
			{#if entry.kind === 'month'}
				<div class="cell month">
					<MonthBreak label={entry.label} />
				</div>
			{:else}
				<div class="cell">
					<MediaCard item={entry.item} {activeYear} />
				</div>
			{/if}
		{/each}
	{/if}
</section>

<style>
	.masonry {
		position: relative;
		z-index: 2;
		column-count: 4;
		column-gap: 12px;
		padding: 1.375rem 1.875rem 7rem;
	}

	.cell {
		break-inside: avoid;
		margin-bottom: 1rem;
	}

	.month {
		margin-top: 0.375rem;
	}

	.empty {
		font-size: 1.1rem;
		color: var(--timeline-chrome, var(--ink));
	}

	@media (max-width: 1100px) {
		.masonry {
			column-count: 3;
		}
	}

	@media (max-width: 760px) {
		.masonry {
			column-count: 2;
			column-gap: 8px;
			padding: 1rem 0.75rem 7rem;
		}
	}
</style>
