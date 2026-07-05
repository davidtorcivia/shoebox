<script lang="ts">
	import type { ItemDTO } from '$lib/types';
	import { moveItem, positionsFrom } from './reorder';

	let {
		items,
		coverItemId,
		onCommit,
		onCover
	}: {
		items: ItemDTO[];
		coverItemId: string | null;
		onCommit: (positions: { itemId: string; position: number }[]) => void | Promise<void>;
		onCover: (itemId: string) => void | Promise<void>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let order = $state(items.map((item) => item.id));
	const byId = $derived(new Map(items.map((item) => [item.id, item])));
	let draggingId = $state<string | null>(null);
	let dirty = $state(false);

	function onDown(event: PointerEvent, id: string) {
		draggingId = id;
		dirty = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onMove(event: PointerEvent) {
		if (!draggingId) return;
		const target = document
			.elementsFromPoint(event.clientX, event.clientY)
			.find((node) => (node as HTMLElement).dataset?.reorderId) as HTMLElement | undefined;
		const overId = target?.dataset.reorderId;
		if (!overId || overId === draggingId) return;
		const from = order.indexOf(draggingId);
		const to = order.indexOf(overId);
		if (from < 0 || to < 0) return;
		order = moveItem(order, from, to);
		dirty = true;
	}

	async function onUp() {
		if (draggingId && dirty) await onCommit(positionsFrom(order));
		draggingId = null;
		dirty = false;
	}
</script>

<div
	class="rgrid"
	data-testid="reorder-grid"
	role="list"
	aria-label="Album item order"
	onpointermove={onMove}
	onpointerup={onUp}
>
	{#each order as id, index (id)}
		{@const item = byId.get(id)}
		{#if item}
			<div
				class="tile"
				class:dragging={draggingId === id}
				data-reorder-id={id}
				data-testid="reorder-tile"
				role="listitem"
				aria-label={`Drag ${item.title ?? `item ${index + 1}`}`}
				onpointerdown={(event) => onDown(event, id)}
			>
				<img src={item.urls.thumb400 || item.urls.poster} alt={item.title ?? `Item ${index + 1}`} draggable="false" />
				<button
					type="button"
					class="cover"
					class:iscover={coverItemId === id}
					data-testid="set-cover"
					onpointerdown={(event) => event.stopPropagation()}
					onclick={(event) => {
						event.stopPropagation();
						void onCover(id);
					}}
				>
					{coverItemId === id ? 'Cover' : 'Set cover'}
				</button>
			</div>
		{/if}
	{/each}
</div>

<style>
	.rgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 10px;
		touch-action: none;
	}

	.tile {
		position: relative;
		aspect-ratio: 1;
		cursor: grab;
		user-select: none;
	}

	.tile.dragging {
		opacity: 0.65;
		outline: 2px solid var(--dawn);
		outline-offset: -2px;
	}

	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.cover {
		position: absolute;
		bottom: 0;
		left: 0;
		min-height: 32px;
		border: 0;
		background: var(--ink);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 9px;
		letter-spacing: 0.16em;
		padding: 0 10px;
		text-transform: uppercase;
	}

	.cover.iscover {
		background: var(--dawn);
		color: var(--ink);
	}
</style>
