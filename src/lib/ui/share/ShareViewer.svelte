<script lang="ts">
	import Player from '$lib/ui/Player.svelte';
	import { CREAM, DAWN, FONT, GRAIN_URI, INK, playerRoomFor } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/types';

	let {
		items,
		index,
		allowDownload,
		single = false,
		onClose,
		onNavigate
	}: {
		items: ItemDTO[];
		index: number;
		allowDownload: boolean;
		single?: boolean;
		onClose?: () => void;
		onNavigate?: (index: number) => void;
	} = $props();

	const item = $derived(items[index]);
	const year = $derived(item.date.dateStart ? Number(item.date.dateStart.slice(0, 4)) : 1990);
	const room = $derived(playerRoomFor(year));
	const videoSrc = $derived(item.urls.playback ?? item.urls.original ?? item.urls.poster);
	const imageSrc = $derived(item.urls.thumb1600 || item.urls.thumb800 || item.urls.original || '');
	const canDownload = $derived(allowDownload && Boolean(item.urls.original));

	function prev(): void {
		if (!single && index > 0) onNavigate?.(index - 1);
	}

	function next(): void {
		if (!single && index < items.length - 1) onNavigate?.(index + 1);
	}

	// Touch swipe navigation (replaces the on-screen arrows on mobile).
	let swipeX = 0;
	let swipeY = 0;

	function onStagePointerDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse') return;
		swipeX = event.clientX;
		swipeY = event.clientY;
	}

	function onStagePointerUp(event: PointerEvent): void {
		if (event.pointerType === 'mouse') return;
		const dx = event.clientX - swipeX;
		const dy = event.clientY - swipeY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
			if (dx < 0) next();
			else prev();
		}
	}

	function onKey(event: KeyboardEvent): void {
		if (event.key === 'Escape' && !single) {
			event.preventDefault();
			onClose?.();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			prev();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			next();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<section
	class="viewer"
	class:overlay={!single}
	role={single ? undefined : 'dialog'}
	aria-modal={single ? undefined : 'true'}
	aria-label={item.title ?? item.displayDate}
	style={`background: radial-gradient(90% 70% at 85% 0%, ${room.pool}, transparent), linear-gradient(160deg, ${room.stops[0]}, ${room.stops[1]} 60%, ${room.stops[2]}); --ink:${INK}; --cream:${CREAM}; --dawn:${DAWN}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
>
	<div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>

	<header class="bar">
		<span class="spacer" aria-hidden="true"></span>
		<h1>{item.title ?? 'A memory'}</h1>
		{#if !single}
			<button class="close" type="button" aria-label="Close" onclick={() => onClose?.()}>x</button>
		{:else}
			<span></span>
		{/if}
	</header>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="stage" onpointerdown={onStagePointerDown} onpointerup={onStagePointerUp}>
		{#if !single}
			<button
				class="arrow"
				type="button"
				onclick={prev}
				disabled={index === 0}
				aria-label="Previous"
			>
				&lt;
			</button>
		{/if}
		<div class="media">
			{#if item.type === 'video'}
				<Player
					src={videoSrc}
					poster={item.urls.poster || item.urls.thumb800}
					duration={item.duration}
					title={item.title}
				/>
			{:else}
				<img src={imageSrc} alt={item.title ?? item.displayDate} />
			{/if}
			<p class="media-date">{item.displayDate}</p>
			{#if item.description}<p class="story">{item.description}</p>{/if}
			{#if canDownload && item.urls.original}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- storage adapters return media URLs, not app routes -->
				<a class="download" data-testid="share-download" href={item.urls.original} download>
					Download original
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</div>
		{#if !single}
			<button
				class="arrow"
				type="button"
				onclick={next}
				disabled={index === items.length - 1}
				aria-label="Next"
			>
				&gt;
			</button>
		{/if}
	</div>
</section>

<style>
	.viewer {
		position: relative;
		display: flex;
		min-height: 100vh;
		flex-direction: column;
		color: var(--cream);
	}

	.viewer.overlay {
		position: fixed;
		z-index: 40;
		inset: 0;
		overflow-y: auto;
	}

	.grain {
		position: absolute;
		inset: 0;
		opacity: 0.5;
		mix-blend-mode: overlay;
		pointer-events: none;
	}

	.bar {
		position: relative;
		display: grid;
		align-items: baseline;
		padding: 26px 28px 10px;
		gap: 16px;
		grid-template-columns: 1fr auto 1fr;
	}

	.close,
	.arrow,
	.download {
		font-family: var(--sans);
	}

	.close,
	.download {
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: clamp(28px, 5vw, 46px);
		font-weight: 500;
		line-height: 1.04;
		text-align: center;
	}

	.close {
		min-width: 48px;
		min-height: 48px;
		justify-self: end;
		border: 0;
		background: none;
		color: var(--cream);
		cursor: pointer;
	}

	.stage {
		position: relative;
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		padding: 0 20px 40px;
		gap: 18px;
	}

	.arrow {
		min-width: 48px;
		min-height: 48px;
		border: 0;
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-size: 28px;
	}

	.arrow:disabled {
		cursor: default;
		opacity: 0.25;
	}

	.arrow:focus-visible,
	.close:focus-visible,
	.download:focus-visible {
		outline: 3px solid var(--cream);
		outline-offset: 2px;
	}

	.media {
		width: min(900px, 100%);
	}

	img {
		display: block;
		width: 100%;
		height: auto;
	}

	.media-date {
		margin: 16px 0 0;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.story {
		margin: 14px 0 0;
		font-family: var(--serif);
		font-size: 18px;
		line-height: 1.5;
	}

	.download {
		display: inline-block;
		min-height: 48px;
		margin-top: 18px;
		padding: 0 18px;
		background: var(--cream);
		color: var(--ink);
		line-height: 48px;
		text-decoration: none;
	}

	@media (max-width: 760px) {
		.bar {
			grid-template-columns: 1fr auto;
		}

		.spacer {
			display: none;
		}

		h1 {
			text-align: left;
		}

		.stage {
			padding-right: 12px;
			padding-left: 12px;
			gap: 8px;
		}

		/* Arrows give way to swipe navigation on touch screens. */
		.arrow {
			display: none;
		}
	}
</style>
