<script lang="ts">
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import ShareDialog from '$lib/ui/ShareDialog.svelte';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// A warm room so the grid reads like the rest of the app.
	const room = personRoomFor('#E0A479');
	let shareOpen = $state(false);
</script>

<svelte:head>
	<title>Saved · Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="head">
			<span class="label">Saved</span>
			<div class="head-row">
				<h1>{data.items.length} {data.items.length === 1 ? 'moment' : 'moments'}</h1>
				{#if data.items.length > 0}
					<button
						class="share-btn"
						type="button"
						data-testid="share-saved"
						data-tour="share-saved"
						onclick={() => (shareOpen = true)}>Share</button
					>
				{/if}
			</div>
		</header>
		<div class="body">
			{#if data.items.length === 0}
				<p class="empty">Nothing saved yet. Open a moment and tap the heart to keep it here.</p>
			{:else}
				<MasonryGrid items={data.items} activeYear={new Date().getFullYear()} />
			{/if}
		</div>
	</section>
</div>

<ShareDialog
	targetType="favorites"
	targetId={data.userId}
	open={shareOpen}
	onClose={() => (shareOpen = false)}
/>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.page {
		position: relative;
		min-height: 100vh;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.55) 100%);
	}

	.head {
		padding: 30px 30px 8px;
	}

	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.head-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
	}

	h1 {
		margin: 8px 0 0;
		font-family: var(--font-serif);
		font-size: clamp(30px, 5vw, 48px);
		font-weight: 500;
		line-height: 1.1;
	}

	.share-btn {
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid color-mix(in srgb, var(--cream) 30%, transparent);
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		transition: border-color 200ms ease;
	}

	.share-btn:hover,
	.share-btn:focus-visible {
		border-color: var(--dawn);
	}

	.body {
		padding: 20px 30px 80px;
	}

	.body :global(.masonry) {
		padding: 0 0 7rem;
	}

	.body :global(.empty),
	.body :global(.card),
	.body :global(.month) {
		--timeline-chrome: var(--cream);
		--timeline-strong: color-mix(in srgb, var(--cream) 76%, transparent);
		--timeline-muted: color-mix(in srgb, var(--cream) 58%, transparent);
		--timeline-soft: color-mix(in srgb, var(--cream) 12%, transparent);
	}

	.empty {
		font-family: var(--font-serif);
		font-size: 1.1rem;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
	}

	@media (max-width: 640px) {
		.head,
		.body {
			padding-inline: 18px;
		}
	}
</style>
