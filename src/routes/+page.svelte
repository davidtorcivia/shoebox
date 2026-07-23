<script lang="ts">
	import { goto, invalidateAll, preloadData } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import CenturyRail from '$lib/ui/CenturyRail.svelte';
	import DecadeRoom from '$lib/ui/DecadeRoom.svelte';
	import { desktopColumns } from '$lib/ui/density';
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

	$effect(() => {
		if (previousYear === null) {
			previousYear = activeYear;
			return;
		}
		if (activeYear === previousYear) return;
		motionDirection = activeYear > previousYear ? 1 : -1;
		previousYear = activeYear;
	});

	// Stepping through years uses buttons and arrow keys, which hover-preload
	// never warms; fetch both neighbours ahead so the jump lands instantly.
	$effect(() => {
		for (const year of [activeYear - 1, activeYear + 1]) {
			if (year >= 1 && year <= data.now) {
				void preloadData(resolve(`/?y=${year}`)).catch(() => {});
			}
		}
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
			<!-- The wheel deliberately does NOT change years here: it was far too easy
			     to drift decades while trying to scroll the page. Years move by click,
			     drag, the arrow keys, and the rails. -->
			<div class="year-scroll-zone">
				<YearBand {activeYear} {years} now={data.now} direction={motionDirection} onStep={jump} />
				<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
			</div>
			<!-- Tile size: slide toward the big square for larger media, toward the
			     small one to see more at once. Desktop only; sits quietly in the
			     grid's own margin and tiles glide to their new places. -->
			<div class="tile-size" data-testid="tile-size">
				<span class="ts-glyph ts-small" aria-hidden="true"></span>
				<input
					type="range"
					min="3"
					max="6"
					step="1"
					aria-label="Media size"
					value={9 - $desktopColumns}
					oninput={(event) => desktopColumns.set(9 - Number(event.currentTarget.value))}
				/>
				<span class="ts-glyph ts-large" aria-hidden="true"></span>
			</div>
			<MasonryGrid
				items={visibleItems}
				{activeYear}
				{motionDirection}
				{selecting}
				desktopColumns={$desktopColumns}
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
	   when there's something to resurface today. Ethereal material: a warm dawn
	   tint over faintly translucent ink that softly blurs whatever drifts
	   beneath it. */
	.on-this-day {
		position: fixed;
		top: 68px;
		right: 1.5rem;
		z-index: 10;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.85rem;
		background:
			radial-gradient(
				130% 100% at 88% -30%,
				color-mix(in srgb, var(--dawn) 30%, transparent),
				transparent 62%
			),
			color-mix(in srgb, var(--ink) 78%, transparent);
		border: 1px solid color-mix(in srgb, var(--dawn) 55%, transparent);
		color: var(--cream);
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.28);
		transition:
			border-color 200ms ease,
			transform 200ms ease;
	}

	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.on-this-day {
			background:
				radial-gradient(
					130% 100% at 88% -30%,
					color-mix(in srgb, var(--dawn) 30%, transparent),
					transparent 62%
				),
				color-mix(in srgb, var(--ink) 62%, transparent);
			backdrop-filter: blur(10px) saturate(1.25);
			-webkit-backdrop-filter: blur(10px) saturate(1.25);
		}
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
		font-weight: 700;
	}

	@media (max-width: 640px) {
		.on-this-day {
			top: auto;
			/* Clear the 52px MobileRail pinned to the viewport bottom. */
			bottom: calc(1rem + 56px + env(safe-area-inset-bottom, 0px));
			right: 1rem;
		}

		.otd-text {
			display: none;
		}
	}

	/* Tile-size control: a quiet inline row in the grid's own top margin,
	   right-aligned with the media below it. No chrome, no float; it fades
	   forward when the pointer visits. Desktop only. */
	.tile-size {
		position: relative;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.75rem 1.875rem 0;
		margin-bottom: -0.5rem;
		opacity: 0.55;
		transition: opacity 180ms ease;
	}

	.tile-size:hover,
	.tile-size:focus-within {
		opacity: 1;
	}

	.tile-size input[type='range'] {
		width: 96px;
		accent-color: var(--dawn);
		cursor: pointer;
	}

	.ts-glyph {
		background: color-mix(in srgb, var(--cream) 60%, transparent);
	}

	.ts-small {
		width: 6px;
		height: 6px;
	}

	.ts-large {
		width: 12px;
		height: 12px;
	}

	@media (max-width: 1100px) {
		.tile-size {
			padding-inline: 1rem;
		}
	}

	@media (max-width: 919px) {
		.tile-size {
			display: none;
		}
	}

	/* The stage itself stays still on a year change: the numeral roll and the
	   tile cascade carry the motion. A whole-stage slide on top of those read
	   as the same animation firing twice. */
</style>
