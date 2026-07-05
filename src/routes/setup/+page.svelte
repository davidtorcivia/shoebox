<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { paletteFor } from '$lib/ui/tokens';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const palette = paletteFor(new Date().getFullYear());
</script>

<svelte:head><title>Set up Shoebox</title></svelte:head>

<Gradient stops={palette.stops} pools={palette.pools} />
<section class="card">
	<p class="eyebrow">First run</p>
	<h1>Set up Shoebox</h1>
	<p class="sub">Create the owner account for this family archive.</p>
	{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
	<form method="POST">
		<Field label="Username" name="username" required autocomplete="username" />
		<Field label="Password" name="password" type="password" required autocomplete="new-password" />
		<Button>Create owner</Button>
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
		letter-spacing: 0.16em;
		font-size: 0.72rem;
		opacity: 0.75;
	}

	h1 {
		font-size: 2.6rem;
		font-weight: 600;
		margin: 0.3rem 0 0.5rem;
	}

	.sub {
		margin-bottom: 1.6rem;
		opacity: 0.85;
	}

	.error {
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--dawn);
		margin-bottom: 1rem;
	}
</style>
