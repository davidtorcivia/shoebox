<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { parseOmnibox } from '$lib/domain/search-query';
	import CenturyRail from '$lib/ui/CenturyRail.svelte';
	import DecadeRoom from '$lib/ui/DecadeRoom.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import MobileRail from '$lib/ui/MobileRail.svelte';
	import YearBand from '$lib/ui/YearBand.svelte';
	import { nearestYearWithContent } from '$lib/ui/rail-math';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let timelineSearchDraft = $state('');

	const years = $derived(data.timeline.years);
	const activeYear = $derived(data.activeYear);
	const targetYear = (year: number) => nearestYearWithContent(year, years) ?? year;

	function jump(delta: number) {
		const year = targetYear(activeYear + delta);
		void goto(resolve(`/?y=${year}`));
	}

	function onTimelineSearch(event: SubmitEvent) {
		event.preventDefault();
		const value = timelineSearchDraft.trim();
		if (!value) {
			void goto(resolve('/search'));
			return;
		}
		const parsed = parseOmnibox(value);
		const q = parsed.yearFrom == null ? `${value} ${activeYear}` : value;
		void goto(resolve(`/search?q=${encodeURIComponent(q)}`));
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

<DecadeRoom year={activeYear}>
	<form class="tl-search" role="search" onsubmit={onTimelineSearch}>
		<input
			class="tl-search-input"
			type="search"
			placeholder="Search"
			aria-label="Search the shoebox"
			autocomplete="off"
			data-testid="timeline-search"
			bind:value={timelineSearchDraft}
		/>
	</form>
	<YearBand {activeYear} {years} onStep={jump} />
	<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
	<MasonryGrid items={data.items} {activeYear} />
	<MobileRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
</DecadeRoom>

<style>
	.tl-search {
		position: absolute;
		top: 28px;
		right: 30px;
		z-index: 5;
		display: flex;
	}

	.tl-search-input {
		min-width: 190px;
		min-height: 44px;
		padding: 0 16px;
		border: 0;
		background: color-mix(in srgb, var(--timeline-chrome, var(--cream)) 14%, transparent);
		color: var(--timeline-chrome, var(--cream));
		color-scheme: dark;
		font-family: var(--font-sans);
		font-size: 13px;
		letter-spacing: 0.06em;
		outline-offset: 3px;
	}

	.tl-search-input::placeholder {
		color: color-mix(in srgb, var(--timeline-chrome, var(--cream)) 56%, transparent);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	@media (max-width: 760px) {
		.tl-search {
			top: 18px;
			right: 16px;
			left: 16px;
		}

		.tl-search-input {
			width: 100%;
			min-width: 0;
		}
	}
</style>
