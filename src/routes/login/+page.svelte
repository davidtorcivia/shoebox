<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { paletteFor } from '$lib/ui/tokens';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const palette = paletteFor(new Date().getFullYear());
</script>

<svelte:head><title>Sign in - Shoebox</title></svelte:head>

<Gradient stops={palette.stops} pools={palette.pools} />
<section class="card">
	<p class="eyebrow">Shoebox</p>
	<h1>Sign in</h1>
	{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
	<form method="POST">
		<Field label="Username" name="username" required autocomplete="username" />
		<Field
			label="Password"
			name="password"
			type="password"
			required
			autocomplete="current-password"
		/>
		<Button>Sign in</Button>
	</form>
</section>

<style>
	.card {
		max-width: 26rem;
		margin: 14vh auto 0;
		padding: 0 1.5rem;
	}

	.eyebrow {
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.72rem;
		opacity: 0.75;
	}

	h1 {
		font-size: 2.6rem;
		font-weight: 600;
		margin: 0.3rem 0 1.4rem;
	}

	.error {
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--dawn);
		margin-bottom: 1rem;
	}
</style>
