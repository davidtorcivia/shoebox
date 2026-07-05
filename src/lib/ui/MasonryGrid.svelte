<script lang="ts">
	import MediaCard from './MediaCard.svelte';
	import MonthBreak from './MonthBreak.svelte';
	import { buildGridEntries, columnCount, layoutMasonry } from './masonry';
	import type { ItemDTO } from '$lib/types';

	interface Props {
		items: ItemDTO[];
		activeYear: number;
	}

	let { items, activeYear }: Props = $props();
	let width = $state(1120);
	const entries = $derived(buildGridEntries(items));
	const columns = $derived(columnCount(width));
	const columnWidth = $derived((width - 12 * (columns - 1)) / columns);
	const layout = $derived(layoutMasonry(entries, columns, columnWidth, 12));
</script>

<section class="masonry" aria-label="Timeline media" bind:clientWidth={width}>
	{#if entries.length === 0}
		<p class="empty">No moments yet for this year.</p>
	{:else}
		<div class="canvas" style={`height: ${layout.height}px`}>
			{#each layout.entries as positioned (positioned.id)}
				<div
					class="cell"
					class:month={positioned.entry.kind === 'month'}
					style={`transform: translate(${positioned.x}px, ${positioned.y}px); width: ${positioned.width}px; height: ${positioned.height}px`}
				>
					{#if positioned.entry.kind === 'month'}
						<MonthBreak label={positioned.entry.label} />
					{:else}
						<MediaCard item={positioned.entry.item} {activeYear} />
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.masonry {
		position: relative;
		z-index: 2;
		padding: 1.375rem 1.875rem 7rem;
	}

	.canvas {
		position: relative;
		width: 100%;
		min-height: 12rem;
	}

	.cell {
		position: absolute;
		top: 0;
		left: 0;
	}

	.month {
		color: var(--timeline-chrome, var(--ink));
	}

	.empty {
		font-size: 1.1rem;
		color: var(--timeline-chrome, var(--ink));
	}

	@media (max-width: 1100px) {
		.masonry {
			padding-right: 1rem;
			padding-left: 1rem;
		}
	}

	@media (max-width: 760px) {
		.masonry {
			padding: 1rem 0.75rem 7rem;
		}
	}
</style>
