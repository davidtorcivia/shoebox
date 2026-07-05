<script lang="ts">
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
	const videoSrc = $derived(item.urls.original ?? item.urls.poster);
	const imageSrc = $derived(item.urls.thumb1600 || item.urls.thumb800 || item.urls.original || '');
	const canDownload = $derived(allowDownload && Boolean(item.urls.original));

	let video = $state<HTMLVideoElement>();
	let playing = $state(false);
	let time = $state(0);
	let duration = $state(0);

	function toggle(): void {
		if (!video) return;
		if (video.paused) void video.play();
		else video.pause();
	}

	function seek(event: Event): void {
		if (video) video.currentTime = Number((event.currentTarget as HTMLInputElement).value);
	}

	function mmss(seconds: number): string {
		return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
	}

	function prev(): void {
		if (!single && index > 0) onNavigate?.(index - 1);
	}

	function next(): void {
		if (!single && index < items.length - 1) onNavigate?.(index + 1);
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
		} else if (event.key === ' ' && item.type === 'video') {
			event.preventDefault();
			toggle();
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
		<span class="eyebrow">{item.displayDate}</span>
		<h1>{item.title ?? 'A memory'}</h1>
		{#if !single}
			<button class="close" type="button" aria-label="Close" onclick={() => onClose?.()}>x</button>
		{:else}
			<span></span>
		{/if}
	</header>

	<div class="stage">
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
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={video}
					src={videoSrc}
					poster={item.urls.poster || item.urls.thumb800}
					playsinline
					onplay={() => (playing = true)}
					onpause={() => (playing = false)}
					ontimeupdate={() => (time = video?.currentTime ?? 0)}
					ondurationchange={() => (duration = video?.duration ?? 0)}
					onclick={toggle}
				></video>
				<div class="controls">
					<button
						class="play"
						type="button"
						onclick={toggle}
						aria-label={playing ? 'Pause' : 'Play'}
					>
						{playing ? '||' : '>'}
					</button>
					<span class="timecode">{mmss(time)} / {mmss(duration)}</span>
					<input
						class="track"
						type="range"
						min="0"
						max={duration || 0}
						step="0.01"
						value={time}
						oninput={seek}
						aria-label="Seek"
					/>
				</div>
			{:else}
				<img src={imageSrc} alt={item.title ?? item.displayDate} />
			{/if}
			{#if item.description}<p class="story">{item.description}</p>{/if}
			{#if canDownload && item.urls.original}
				<a class="download" data-testid="share-download" href={item.urls.original} download>
					Download original
				</a>
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
		padding: 22px 28px;
		gap: 16px;
		grid-template-columns: 1fr auto 1fr;
	}

	.eyebrow,
	.close,
	.arrow,
	.play,
	.timecode,
	.download {
		font-family: var(--sans);
	}

	.eyebrow,
	.close,
	.download {
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.eyebrow {
		opacity: 0.62;
	}

	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
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
	.play:focus-visible,
	.download:focus-visible {
		outline: 3px solid var(--cream);
		outline-offset: 2px;
	}

	.media {
		width: min(900px, 100%);
	}

	video,
	img {
		display: block;
		width: 100%;
		height: auto;
	}

	.controls {
		display: flex;
		align-items: center;
		padding-top: 12px;
		gap: 14px;
	}

	.play {
		min-width: 48px;
		min-height: 48px;
		border: 0;
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-size: 18px;
	}

	.timecode {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.track {
		height: 8px;
		flex: 1;
		appearance: none;
		background: color-mix(in srgb, var(--cream) 25%, transparent);
	}

	.track::-webkit-slider-thumb {
		width: 4px;
		height: 28px;
		appearance: none;
		background: var(--cream);
	}

	.track::-moz-range-thumb {
		width: 4px;
		height: 28px;
		border: 0;
		border-radius: 0;
		background: var(--cream);
	}

	.track::-moz-range-progress {
		height: 8px;
		background: var(--dawn);
	}

	.story {
		margin: 18px 0 0;
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

		.eyebrow {
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
	}
</style>
