<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CenturyRail from '$lib/ui/CenturyRail.svelte';
	import DecadeRoom from '$lib/ui/DecadeRoom.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import MobileRail from '$lib/ui/MobileRail.svelte';
	import YearBand from '$lib/ui/YearBand.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const years = $derived(data.timeline.years);
	const activeYear = $derived(data.activeYear);
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

<DecadeRoom year={activeYear} {motionDirection}>
	{#key activeYear}
		<div class="timeline-stage" data-direction={motionDirection}>
			<div class="year-scroll-zone" onwheel={scrollYear}>
				<YearBand {activeYear} {years} now={data.now} onStep={jump} />
				<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
			</div>
			<MasonryGrid items={data.items} {activeYear} {motionDirection} />
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

<style>
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
