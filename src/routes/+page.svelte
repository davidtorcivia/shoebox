<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CenturyRail from '$lib/ui/CenturyRail.svelte';
	import DecadeRoom from '$lib/ui/DecadeRoom.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import MobileRail from '$lib/ui/MobileRail.svelte';
	import YearBand from '$lib/ui/YearBand.svelte';
	import { nearestYearWithContent } from '$lib/ui/rail-math';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const years = $derived(data.timeline.years);
	const activeYear = $derived(data.activeYear);
	const targetYear = (year: number) => nearestYearWithContent(year, years) ?? year;

	function jump(delta: number) {
		const year = targetYear(activeYear + delta);
		void goto(resolve(`/?y=${year}`));
	}
</script>

<svelte:head>
	<title>{activeYear} · Shoebox</title>
</svelte:head>

<DecadeRoom year={activeYear}>
	<YearBand {activeYear} {years} onStep={jump} />
	<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
	<MasonryGrid items={data.items} {activeYear} />
	<MobileRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
</DecadeRoom>
