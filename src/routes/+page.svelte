<script lang="ts">
	import Gradient from '$lib/ui/Gradient.svelte';
	import { paletteFor } from '$lib/ui/tokens';

	const year = new Date().getFullYear();
	const palette = paletteFor(year);
</script>

<Gradient stops={palette.stops} pools={palette.pools} />
<section class="shell">
	<p class="eyebrow">Timeline</p>
	<h1>{year}</h1>
	<p class="note">The archive is empty. Upload and the timeline arrive in later phases.</p>
</section>

<style>
	.shell {
		padding: 10vh 6vw;
	}

	.eyebrow {
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 0.75rem;
		opacity: 0.75;
	}

	h1 {
		font-size: clamp(4rem, 12vw, 10.5rem);
		font-weight: 600;
		line-height: 1;
	}

	.note {
		margin-top: 1.2rem;
		font-size: 1.05rem;
		opacity: 0.85;
		max-width: 34rem;
	}
</style>
