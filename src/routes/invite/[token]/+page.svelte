<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { paletteFor } from '$lib/ui/tokens';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const palette = paletteFor(new Date().getFullYear());
</script>

<svelte:head><title>Join Shoebox</title></svelte:head>

<Gradient stops={palette.stops} pools={palette.pools} />
<section class="card">
	{#if data.state === 'valid'}
		<p class="eyebrow">Invitation</p>
		<h1>You're invited</h1>
		<p class="sub">Pick a username and password to join as <strong>{data.role}</strong>.</p>
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
		<form method="POST">
			<Field label="Username" name="username" required autocomplete="username" />
			<Field
				label="Password"
				name="password"
				type="password"
				required
				autocomplete="new-password"
			/>
			<Button>Join Shoebox</Button>
		</form>
	{:else if data.state === 'expired'}
		<h1>Invite expired</h1>
		<p class="sub">This link has expired. Ask your family admin for a fresh one.</p>
	{:else if data.state === 'exhausted'}
		<h1>Invite used up</h1>
		<p class="sub">This link has reached its use limit. Ask your family admin for a fresh one.</p>
	{:else}
		<h1>Not a valid invite</h1>
		<p class="sub">Check the link, or ask your family admin for a new one.</p>
	{/if}
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

	strong {
		font-weight: 700;
	}

	.error {
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--dawn);
		margin-bottom: 1rem;
	}
</style>
