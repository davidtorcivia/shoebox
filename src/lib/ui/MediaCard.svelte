<script lang="ts">
	import { captionRight as defaultCaptionRight, formatDuration, thumbSrcset } from './card-format';
	import type { ItemDTO } from '$lib/types';

	interface Props {
		item: ItemDTO;
		activeYear: number;
		captionRight?: string | null;
	}

	let { item, activeYear, captionRight = null }: Props = $props();
	const duration = $derived(formatDuration(item.duration));
	const right = $derived(defaultCaptionRight(item));
	const sizes = '(max-width: 720px) 46vw, (max-width: 1100px) 30vw, 22vw';
</script>

<article class="card">
	<button
		class="media"
		type="button"
		aria-label={`Open ${item.title ?? item.displayDate}`}
		onclick={() => {
			window.location.href = `/item/${item.id}?y=${activeYear}`;
		}}
	>
		<img
			src={item.urls.thumb800 || item.urls.poster}
			srcset={thumbSrcset(item)}
			{sizes}
			alt={item.title ?? item.displayDate}
			loading="lazy"
		/>
		{#if duration}
			<span class="duration">{duration}</span>
		{/if}
	</button>
	<div class="caption">
		<span>{item.shortDate}</span>
		<span class="right">{captionRight ?? right}</span>
	</div>
</article>

<style>
	.card {
		color: var(--timeline-chrome, var(--ink));
	}

	.media {
		position: relative;
		display: block;
		width: 100%;
		border: 0;
		background: var(--timeline-soft, rgba(23, 20, 18, 0.16));
		padding: 0;
		cursor: pointer;
	}

	img {
		width: 100%;
		height: auto;
		display: block;
		filter: sepia(0.32) contrast(0.93) saturate(0.88);
	}

	.duration {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.65rem;
		color: var(--cream);
		text-shadow: 0 1px 6px rgba(23, 20, 18, 0.8);
	}

	.caption {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.4rem;
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--timeline-strong, rgba(23, 20, 18, 0.78));
	}

	.right {
		overflow: hidden;
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--timeline-muted, rgba(23, 20, 18, 0.56));
	}
</style>
