<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import ReorderGrid from '$lib/ui/ReorderGrid.svelte';
	import ShareDialog from '$lib/ui/ShareDialog.svelte';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/types';

	let { data } = $props();
	const album = $derived(data.album);
	const room = $derived(personRoomFor(album.createdBy.accentColor));
	const activeYear = $derived(yearFor(data.items));
	let arranging = $state(false);
	let shareOpen = $state(false);

	function yearFor(items: ItemDTO[]): number {
		for (const item of items) {
			const year = item.date.dateStart?.slice(0, 4) ?? item.date.dateEnd?.slice(0, 4);
			if (year && /^\d{4}$/.test(year)) return Number(year);
		}
		return new Date().getFullYear();
	}

	async function commitOrder(positions: { itemId: string; position: number }[]) {
		await fetch(`/api/albums/${album.id}/items`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ positions })
		});
		await invalidateAll();
	}

	async function setCover(itemId: string) {
		await fetch(`/api/albums/${album.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ coverItemId: itemId })
		});
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>{album.title} - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="head">
			<span class="label">Album</span>
			<h1 data-testid="album-title">{album.title}</h1>
			{#if album.description}
				<p class="desc">{album.description}</p>
			{/if}
			<div class="meta">
				<span>{album.itemCount} {album.itemCount === 1 ? 'moment' : 'moments'}</span>
				{#if data.canEdit}
					<button
						class="arrange"
						data-testid="arrange-toggle"
						onclick={() => (arranging = !arranging)}
					>
						{arranging ? 'Done arranging' : 'Arrange'}
					</button>
				{/if}
				{#if data.canShare}
					<button class="arrange" data-testid="share-button" onclick={() => (shareOpen = true)}>
						Share
					</button>
					<ShareDialog
						targetType="album"
						targetId={album.id}
						open={shareOpen}
						onClose={() => (shareOpen = false)}
					/>
				{/if}
			</div>
		</header>

		<div class="body">
			{#if arranging}
				{#key data.items.map((item) => item.id).join('|')}
					<ReorderGrid
						items={data.items}
						coverItemId={album.coverItemId}
						onCommit={commitOrder}
						onCover={setCover}
					/>
				{/key}
			{:else}
				<MasonryGrid items={data.items} {activeYear} />
			{/if}
		</div>
	</section>
</div>

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
		overflow: hidden;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.62) 100%);
		color: var(--cream);
	}

	.head {
		position: relative;
		z-index: 1;
		max-width: 860px;
		padding: 38px 30px 0;
	}

	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		opacity: 0.6;
		text-transform: uppercase;
	}

	h1 {
		margin: 12px 0 0;
		font-family: var(--font-serif);
		font-size: 46px;
		font-weight: 400;
		letter-spacing: 0;
		line-height: 1;
	}

	.desc {
		margin: 14px 0 0;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 22px;
		margin-top: 14px;
		color: color-mix(in srgb, var(--cream) 75%, transparent);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.arrange {
		min-height: 44px;
		border: 0;
		background: none;
		color: var(--dawn);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.body {
		position: relative;
		z-index: 1;
		padding: 26px 30px 80px;
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

	@media (max-width: 640px) {
		.head,
		.body {
			padding-inline: 18px;
		}

		h1 {
			font-size: 38px;
		}
	}
</style>
