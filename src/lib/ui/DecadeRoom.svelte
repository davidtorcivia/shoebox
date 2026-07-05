<script lang="ts">
	import type { Snippet } from 'svelte';
	import Gradient from './Gradient.svelte';
	import { chromeVars } from './room';
	import { paletteFor } from './tokens';

	interface Props {
		year: number;
		children: Snippet;
	}

	let { year, children }: Props = $props();
	const palette = $derived(paletteFor(year));
	const vars = $derived(chromeVars(palette));
	const style = $derived(
		Object.entries(vars)
			.map(([key, value]) => `${key}: ${value}`)
			.join('; ')
	);
</script>

<div class="room" {style}>
	<Gradient stops={palette.stops} pools={palette.pools} />
	{@render children()}
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}
</style>
