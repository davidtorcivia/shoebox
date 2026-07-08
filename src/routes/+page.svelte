<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import CenturyRail from '$lib/ui/CenturyRail.svelte';
	import DecadeRoom from '$lib/ui/DecadeRoom.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import MobileRail from '$lib/ui/MobileRail.svelte';
	import SelectionBar from '$lib/ui/SelectionBar.svelte';
	import YearBand from '$lib/ui/YearBand.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const years = $derived(data.timeline.years);
	const activeYear = $derived(data.activeYear);

	// Long-press a card to start selecting; tap others to add/remove.
	let selecting = $state(false);
	const selectedIds = new SvelteSet<string>();
	// Items deleted via the selection bar, hidden immediately without a reload.
	const hiddenIds = new SvelteSet<string>();
	const visibleItems = $derived(data.items.filter((item) => !hiddenIds.has(item.id)));

	function beginSelect(id: string): void {
		selecting = true;
		selectedIds.add(id);
	}
	function toggleSelect(id: string): void {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
		if (selectedIds.size === 0) selecting = false;
	}
	function exitSelection(): void {
		selecting = false;
		selectedIds.clear();
	}
	function onDeleted(ids: string[]): void {
		for (const id of ids) hiddenIds.add(id);
		exitSelection();
		void invalidateAll();
	}
	let previousYear = $state<number | null>(null);
	let motionDirection = $state(0);
	let wheelDelta = 0;
	let wheelLocked = false;

	$effect(() => {
		if (previousYear === null) {
			previousYear = activeYear;
			return;
		}
		if (activeYear === previousYear) return;
		motionDirection = activeYear > previousYear ? 1 : -1;
		previousYear = activeYear;
	});

	function jump(delta: number) {
		const year = Math.min(data.now, Math.max(1, activeYear + delta));
		if (year === activeYear) return;
		motionDirection = delta > 0 ? 1 : -1;
		void goto(resolve(`/?y=${year}`));
	}

	function goToYear(year: number) {
		const target = Math.min(data.now, Math.max(1, year));
		if (target === activeYear) return;
		motionDirection = target > activeYear ? 1 : -1;
		void goto(resolve(`/?y=${target}`));
	}

	function scrollYear(event: WheelEvent) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		const axisDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		wheelDelta += axisDelta;
		if (wheelLocked || Math.abs(wheelDelta) < 90) return;

		event.preventDefault();
		wheelLocked = true;
		jump(wheelDelta > 0 ? 1 : -1);
		wheelDelta = 0;
		window.setTimeout(() => {
			wheelLocked = false;
		}, 520);
	}
</script>

<svelte:head>
	<title>{activeYear} · Shoebox</title>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			jump(-1);
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			jump(1);
		}
	}}
/>

{#if data.onThisDayCount > 0}
	<a class="on-this-day" href={resolve('/on-this-day')} data-testid="on-this-day-link">
		<span class="otd-icon" aria-hidden="true">✶</span>
		<span class="otd-text">On this day</span>
		<span class="otd-count">{data.onThisDayCount}</span>
	</a>
{/if}

<DecadeRoom year={activeYear} {motionDirection}>
	{#key activeYear}
		<div class="timeline-stage" data-direction={motionDirection}>
			<div class="year-scroll-zone" onwheel={scrollYear}>
				<YearBand {activeYear} {years} now={data.now} onStep={jump} />
				<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
			</div>
			<MasonryGrid
				items={visibleItems}
				{activeYear}
				{motionDirection}
				{selecting}
				isSelected={(id) => selectedIds.has(id)}
				onselect={toggleSelect}
				onbeginselect={beginSelect}
			/>
		</div>
	{/key}
	<!-- Rendered outside .timeline-stage: that element's transform/will-change would
	     otherwise become the containing block for this position:fixed rail, leaving
	     it floating mid-page instead of pinned to the viewport bottom. -->
	<MobileRail
		{years}
		earliest={data.timeline.earliest}
		{activeYear}
		now={data.now}
		onselect={goToYear}
	/>
</DecadeRoom>

{#if selecting}
	<SelectionBar
		selectedIds={[...selectedIds]}
		canDelete={data.canDelete}
		onexit={exitSelection}
		ondeleted={onDeleted}
	/>
{/if}

<style>
	/* "On this day" entry point — a quiet pill pinned below the nav, shown only
	   when there's something to resurface today. */
	.on-this-day {
		position: fixed;
		top: 68px;
		right: 1.5rem;
		z-index: 10;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.85rem;
		background: color-mix(in srgb, var(--ink) 78%, transparent);
		border: 1px solid color-mix(in srgb, var(--dawn) 55%, transparent);
		border-radius: 999px;
		color: var(--cream);
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.28);
		transition:
			border-color 200ms ease,
			transform 200ms ease;
	}

	.on-this-day:hover,
	.on-this-day:focus-visible {
		border-color: var(--dawn);
		transform: translateY(-1px);
	}

	.otd-icon {
		color: var(--dawn);
		font-size: 0.85rem;
	}

	.otd-count {
		display: inline-grid;
		place-items: center;
		min-width: 1.35rem;
		height: 1.35rem;
		padding: 0 0.35rem;
		background: var(--dawn);
		color: var(--ink);
		border-radius: 999px;
		font-weight: 700;
	}

	@media (max-width: 640px) {
		.on-this-day {
			top: auto;
			bottom: 1rem;
			right: 1rem;
		}

		.otd-text {
			display: none;
		}
	}

	.timeline-stage {
		animation: year-arrive 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
		transform-origin: 50% 16rem;
		will-change: opacity, transform, filter;
	}

	.timeline-stage[data-direction='-1'] {
		animation-name: year-arrive-reverse;
	}

	.year-scroll-zone {
		cursor: ew-resize;
	}

	@keyframes year-arrive {
		from {
			opacity: 0;
			filter: blur(12px);
			transform: translate3d(3.5rem, 0, 0) scale(0.985);
		}

		55% {
			opacity: 1;
			filter: blur(0);
		}

		to {
			opacity: 1;
			filter: blur(0);
			transform: translate3d(0, 0, 0) scale(1);
		}
	}

	@keyframes year-arrive-reverse {
		from {
			opacity: 0;
			filter: blur(12px);
			transform: translate3d(-3.5rem, 0, 0) scale(0.985);
		}

		55% {
			opacity: 1;
			filter: blur(0);
		}

		to {
			opacity: 1;
			filter: blur(0);
			transform: translate3d(0, 0, 0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.timeline-stage {
			animation: none;
			transform: none;
		}
	}
</style>
