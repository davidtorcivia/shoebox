<script lang="ts">
	import MediaCard from './MediaCard.svelte';
	import MonthBreak from './MonthBreak.svelte';
	import { buildGridEntries, columnCount, layoutMasonry } from './masonry';
	import type { ItemDTO } from '$lib/types';

	interface Props {
		items: ItemDTO[];
		activeYear: number;
		motionDirection?: number;
		captionRightFor?: ((item: ItemDTO) => string | null) | null;
		selecting?: boolean;
		/** Column count on desktop widths (the timeline's tile-size control). */
		desktopColumns?: number;
		isSelected?: (id: string) => boolean;
		onselect?: (id: string) => void;
		onbeginselect?: (id: string) => void;
	}

	let {
		items,
		activeYear,
		motionDirection = 0,
		captionRightFor = null,
		selecting = false,
		desktopColumns = 4,
		isSelected,
		onselect,
		onbeginselect
	}: Props = $props();
	let width = $state(1120);
	const columns = $derived(width >= 920 ? desktopColumns : columnCount(width));
	const columnWidth = $derived((width - 12 * (columns - 1)) / columns);
	// Estimate item heights at the *actual* column width — otherwise tall images
	// overflow their reserved cells and the next month header lands on top of the
	// previous month's content.
	const entries = $derived(buildGridEntries(items, columnWidth));
	const layout = $derived(layoutMasonry(entries, columns, columnWidth, 12));
</script>

<section class="masonry" data-direction={motionDirection} aria-label="Timeline media">
	{#if entries.length === 0}
		<p class="empty">No moments yet for this year.</p>
	{:else}
		<!-- Measure the content box (inside padding), not the padded section, so
		     column widths never overshoot and clip the rightmost media on mobile. -->
		<div class="canvas" bind:clientWidth={width} style={`height: ${layout.height}px`}>
			{#each layout.entries as positioned, index (positioned.id)}
				<div
					class="cell"
					class:month={positioned.entry.kind === 'month'}
					style={`--delay: ${Math.min(index, 14) * 26}ms; transform: translate(${positioned.x}px, ${positioned.y}px); width: ${positioned.width}px; height: ${positioned.height}px`}
				>
					{#if positioned.entry.kind === 'month'}
						<MonthBreak label={positioned.entry.label} />
					{:else}
						<MediaCard
							item={positioned.entry.item}
							{activeYear}
							captionRight={captionRightFor ? captionRightFor(positioned.entry.item) : null}
							{selecting}
							selected={isSelected ? isSelected(positioned.entry.item.id) : false}
							{onselect}
							{onbeginselect}
						/>
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
		--cell-offset: 1.75rem;

		position: absolute;
		top: 0;
		left: 0;
		animation: cell-arrive 560ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: var(--delay);
		will-change: opacity, translate, filter;
		/* When the layout re-flows in place (the tile-size control, a resize),
		   tiles glide to their new homes instead of teleporting. The entrance
		   animation uses translate/scale, so it never fights this transform. */
		transition:
			transform 420ms cubic-bezier(0.22, 0.61, 0.36, 1),
			width 420ms cubic-bezier(0.22, 0.61, 0.36, 1),
			height 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
	}

	.month {
		color: var(--timeline-chrome, var(--ink));
		animation-duration: 420ms;
	}

	.masonry[data-direction='-1'] .cell {
		--cell-offset: -1.75rem;
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

	/* Tiles drift in from the direction of travel while rising and settling,
	   a soft cascade rather than a sideways shove. */
	@keyframes cell-arrive {
		from {
			opacity: 0;
			filter: blur(6px);
			translate: var(--cell-offset) 18px;
			scale: 0.97;
		}

		60% {
			opacity: 1;
			filter: blur(0);
		}

		to {
			opacity: 1;
			filter: blur(0);
			translate: 0 0;
			scale: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cell {
			animation: none;
			transition: none;
		}
	}
</style>
