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

	function jump(delta: number) {
		const year = Math.min(data.now, Math.max(1, activeYear + delta));
		void goto(resolve(`/?y=${year}`));
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
	<YearBand {activeYear} {years} now={data.now} onStep={jump} />
	<CenturyRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
	<MasonryGrid items={data.items} {activeYear} />
	<MobileRail {years} earliest={data.timeline.earliest} {activeYear} now={data.now} />
</DecadeRoom>
