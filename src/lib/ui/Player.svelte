<script lang="ts">
	import { onDestroy } from 'svelte';
	import { formatTimecode } from '$lib/domain/timecode';
	import {
		SHUTTLE_PAUSED,
		nextRate,
		shuttleNext,
		togglePlay,
		type Shuttle
	} from '$lib/domain/shuttle';
	import { CREAM, DAWN, FONT, INK, MOTION } from '$lib/ui/tokens';
	import { comfortMode, reducedMotion } from '$lib/ui/theme';
	import ScrubTrack from './ScrubTrack.svelte';
	import { FRAME_STEP, type PlayerAction } from './player-keys';

	interface Props {
		src: string;
		poster: string;
		duration?: number | null;
		title?: string | null;
	}

	let { src, poster, duration: durationHint = null, title = null }: Props = $props();

	let root: HTMLDivElement;
	let video = $state<HTMLVideoElement | null>(null);
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let buffered = $state(0);
	let muted = $state(false);
	let rate = $state(1);
	let volume = $state(1);
	let volumeOpen = $state(false);
	let fullscreen = $state(false);
	let loading = $state(true);
	let errored = $state(false);
	let controlsVisible = $state(true);

	let shuttle: Shuttle = SHUTTLE_PAUSED;
	let reverseTimer: ReturnType<typeof setInterval> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	const noHover = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

	export function isPaused(): boolean {
		return paused;
	}

	export function handleAction(action: PlayerAction): void {
		if (!video || errored) return;
		switch (action.type) {
			case 'toggle-play':
				applyShuttle(togglePlay(shuttle));
				break;
			case 'shuttle':
				applyShuttle(shuttleNext(shuttle, action.key));
				break;
			case 'seek-by':
				seek(currentTime + action.seconds);
				break;
			case 'step':
				if (video.paused) seek(currentTime + action.direction * FRAME_STEP);
				break;
			case 'fullscreen':
				void toggleFullscreen();
				break;
			case 'mute':
				video.muted = !video.muted;
				muted = video.muted;
				break;
			default:
				return;
		}
		poke();
	}

	function clearReverse() {
		if (!reverseTimer) return;
		clearInterval(reverseTimer);
		reverseTimer = null;
	}

	function applyShuttle(next: Shuttle) {
		if (!video) return;
		shuttle = next;
		clearReverse();
		if (next.mode === 'pause') {
			video.pause();
		} else if (next.mode === 'forward') {
			video.playbackRate = next.rate;
			rate = next.rate;
			void video.play();
		} else {
			video.pause();
			reverseTimer = setInterval(() => {
				if (!video) {
					clearReverse();
					return;
				}
				const nextTime = Math.max(0, video.currentTime - 0.2);
				video.currentTime = nextTime;
				currentTime = nextTime;
				if (nextTime <= 0) {
					clearReverse();
					shuttle = SHUTTLE_PAUSED;
				}
			}, 100);
		}
	}

	function seek(time: number) {
		if (!video) return;
		const limit = duration || video.duration || 0;
		const clamped = Math.min(limit, Math.max(0, time));
		video.currentTime = clamped;
		currentTime = clamped;
		poke();
	}

	function cycleRate() {
		if (!video) return;
		rate = nextRate(rate);
		video.playbackRate = rate;
		poke();
	}

	async function toggleFullscreen() {
		if (document.fullscreenElement) await document.exitFullscreen();
		else await root.requestFullscreen();
	}

	function onVolumeInput(event: Event) {
		if (!video) return;
		volume = Number((event.currentTarget as HTMLInputElement).value);
		video.volume = volume;
		if (volume > 0 && video.muted) {
			video.muted = false;
			muted = false;
		}
	}

	function retry() {
		if (!video) return;
		errored = false;
		loading = true;
		video.load();
	}

	function poke() {
		controlsVisible = true;
		if (hideTimer) clearTimeout(hideTimer);
		if (paused || noHover || $reducedMotion || $comfortMode) return;
		hideTimer = setTimeout(() => {
			const focusInside = root?.contains(document.activeElement);
			if (!paused && !focusInside) controlsVisible = false;
		}, 2500);
	}

	$effect(() => {
		if (paused !== undefined) poke();
	});

	$effect(() => {
		if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
			duration = durationHint ?? 0;
		}
	});

	onDestroy(() => {
		clearReverse();
		if (hideTimer) clearTimeout(hideTimer);
	});
</script>

<div
	class="player"
	bind:this={root}
	role="group"
	aria-label={title ?? 'Video player'}
	style:--cream={CREAM}
	style:--dawn={DAWN}
	style:--ink={INK}
	style:--serif={FONT.serif}
	style:--sans={FONT.sans}
	style:--fade={`${MOTION.slow}ms`}
	onpointermove={poke}
	onfocusin={poke}
	onfullscreenchange={() => (fullscreen = document.fullscreenElement === root)}
>
	{#if loading && !errored}
		<div class="hairline" class:sweep={!$reducedMotion && !$comfortMode} aria-hidden="true"></div>
	{/if}

	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		{src}
		{poster}
		preload="metadata"
		playsinline
		aria-label={title ?? 'Video'}
		onplay={() => {
			paused = false;
			loading = false;
		}}
		onpause={() => (paused = true)}
		ontimeupdate={() => (currentTime = video?.currentTime ?? 0)}
		ondurationchange={() => (duration = video?.duration || durationHint || 0)}
		onprogress={() => {
			if (video && video.buffered.length > 0)
				buffered = video.buffered.end(video.buffered.length - 1);
		}}
		onwaiting={() => (loading = true)}
		oncanplay={() => (loading = false)}
		onended={() => {
			paused = true;
			shuttle = SHUTTLE_PAUSED;
		}}
		onerror={() => {
			errored = true;
			loading = false;
		}}
	></video>

	{#if errored}
		<div class="error-state">
			<p>This clip could not be loaded.</p>
			<button class="control-button" type="button" onclick={retry}>Retry</button>
		</div>
	{:else}
		<div class="controls" class:hidden={!controlsVisible}>
			<button
				class="play"
				type="button"
				onclick={() => handleAction({ type: 'toggle-play' })}
				aria-label={paused ? 'Play' : 'Pause'}
			>
				{paused ? '▶' : '❚❚'}
			</button>
			<span class="timecode"
				>{formatTimecode(currentTime)} <span>/ {formatTimecode(duration)}</span></span
			>
			<ScrubTrack {duration} {currentTime} {buffered} onseek={seek} />
			<span class="volume-wrap">
				{#if volumeOpen}
					<span class="volume-pop">
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={muted ? 0 : volume}
							aria-label="Volume"
							oninput={onVolumeInput}
						/>
					</span>
				{/if}
				<button
					class="control-button"
					class:dim={muted}
					type="button"
					onclick={() => (volumeOpen = !volumeOpen)}>Vol</button
				>
			</span>
			<button class="control-button" type="button" onclick={cycleRate}>{rate}x</button>
			<button class="control-button" type="button" onclick={() => void toggleFullscreen()}>
				{fullscreen ? 'Exit' : 'Full'}
			</button>
		</div>
	{/if}
</div>

<style>
	.player {
		position: relative;
		display: grid;
		justify-items: center;
		width: 100%;
		max-height: inherit;
	}

	video {
		display: block;
		width: auto;
		max-width: 100%;
		max-height: inherit;
		background: var(--ink);
	}

	.hairline {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		z-index: 2;
		height: 2px;
		background: var(--dawn);
	}

	.hairline.sweep {
		animation: sweep 1.2s linear infinite;
		transform-origin: left;
	}

	@keyframes sweep {
		0% {
			transform: scaleX(0);
		}
		60% {
			transform: scaleX(1);
		}
		100% {
			opacity: 0;
			transform: scaleX(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hairline.sweep {
			animation: none;
		}
	}

	.controls {
		width: 100%;
		display: flex;
		gap: 22px;
		align-items: center;
		padding-top: 16px;
		transition: opacity var(--fade) ease;
	}

	.controls.hidden {
		opacity: 0;
	}

	button {
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		font-family: inherit;
		color: var(--cream);
		cursor: pointer;
		background: none;
		border: 0;
	}

	.play {
		font-family: var(--serif);
		font-size: 26px;
		line-height: 1;
	}

	.timecode {
		font-family: var(--sans);
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.timecode span {
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}

	.control-button {
		font-family: var(--sans);
		font-size: 13px;
		letter-spacing: 0.16em;
		color: color-mix(in srgb, var(--cream) 85%, transparent);
		text-transform: uppercase;
	}

	.control-button.dim {
		color: color-mix(in srgb, var(--cream) 45%, transparent);
	}

	.volume-wrap {
		position: relative;
		display: inline-flex;
	}

	.volume-pop {
		position: absolute;
		right: 0;
		bottom: 100%;
		z-index: 3;
		padding: 14px 16px;
		margin-bottom: 4px;
		background: var(--ink);
	}

	.volume-pop input[type='range'] {
		width: 120px;
		accent-color: var(--dawn);
	}

	.error-state {
		padding: 26px 0;
		font-family: var(--serif);
	}

	.error-state p {
		margin: 0 0 10px;
		font-size: 17px;
		color: var(--cream);
	}
</style>
