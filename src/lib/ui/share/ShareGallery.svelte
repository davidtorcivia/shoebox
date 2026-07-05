<script lang="ts">
	import type { ItemDTO } from '$lib/types';

	let { items, onOpen }: { items: ItemDTO[]; onOpen: (index: number) => void } = $props();

	function mmss(seconds: number | null | undefined): string {
		if (seconds == null) return '';
		const minutes = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		return `${minutes}:${String(secs).padStart(2, '0')}`;
	}

	function thumbFor(item: ItemDTO): string {
		return item.type === 'video'
			? item.urls.poster || item.urls.thumb800
			: item.urls.thumb800 || item.urls.thumb400 || item.urls.original || '';
	}
</script>

<div class="gallery">
	{#each items as item, i (item.id)}
		<button
			class="card"
			type="button"
			onclick={() => onOpen(i)}
			aria-label={`Open ${item.title ?? item.displayDate}`}
		>
			<span class="frame">
				<img src={thumbFor(item)} alt={item.title ?? item.displayDate} loading="lazy" />
				{#if item.type === 'video' && item.duration != null}
					<span class="duration">{mmss(item.duration)}</span>
				{/if}
			</span>
			<span class="caption">
				<span class="date">{item.shortDate}</span>
				{#if item.title}<span class="title">{item.title}</span>{/if}
			</span>
		</button>
	{/each}
</div>

<style>
	.gallery {
		column-gap: 18px;
		columns: 3 280px;
	}

	.card {
		display: block;
		width: 100%;
		margin: 0 0 18px;
		padding: 0;
		break-inside: avoid;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.card:focus-visible {
		outline: 3px solid var(--cream);
		outline-offset: 3px;
	}

	.frame {
		position: relative;
		display: block;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	img {
		display: block;
		width: 100%;
		height: auto;
	}

	.duration {
		position: absolute;
		right: 6px;
		bottom: 6px;
		padding: 2px 5px;
		background: var(--ink);
		color: var(--cream);
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}

	.caption {
		display: flex;
		gap: 10px;
		justify-content: space-between;
		padding-top: 7px;
		color: var(--cream);
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.08em;
		opacity: 0.62;
		text-transform: uppercase;
	}

	.title {
		overflow: hidden;
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
