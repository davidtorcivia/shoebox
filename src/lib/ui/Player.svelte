<script lang="ts">
	import { onDestroy } from 'svelte';
	import { formatTimecode } from '$lib/domain/timecode';
	import { SHUTTLE_PAUSED, shuttleNext, togglePlay, type Shuttle } from '$lib/domain/shuttle';
	import { CREAM, DAWN, FONT, INK, MOTION } from '$lib/ui/tokens';
	import { comfortMode, reducedMotion } from '$lib/ui/theme';
	import ScrubTrack from './ScrubTrack.svelte';
	import { FRAME_STEP, type PlayerAction } from './player-keys';

	interface Props {
		src: string;
		poster: string;
		/** Master HLS playlist. When set, adaptive streaming is preferred over `src`. */
		hls?: string | null;
		duration?: number | null;
		title?: string | null;
	}

	let { src, poster, hls = null, duration: durationHint = null, title = null }: Props = $props();

	let root: HTMLDivElement;
	let video = $state<HTMLVideoElement | null>(null);
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let buffered = $state(0);
	let muted = $state(false);
	let volume = $state(1);
	let volumeOpen = $state(false);
	let fullscreen = $state(false);
	let loading = $state(true);
	let errored = $state(false);
	let controlsVisible = $state(true);

	// Cast / remote playback. Availability toggles the (otherwise hidden) button,
	// so nothing shows until there's actually a TV/receiver to send to.
	let castAvailable = $state(false);
	let casting = $state(false);

	let shuttle: Shuttle = SHUTTLE_PAUSED;
	let reverseTimer: ReturnType<typeof setInterval> | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// Safari exposes AirPlay through its own webkit-prefixed API rather than the
	// standard RemotePlayback interface.
	type AirplayVideo = HTMLVideoElement & {
		webkitShowPlaybackTargetPicker?: () => void;
		webkitCurrentPlaybackTargetIsWireless?: boolean;
	};

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

	async function toggleFullscreen() {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
			return;
		}
		if (root.requestFullscreen) {
			await root.requestFullscreen();
			return;
		}
		// iOS Safari doesn't support Fullscreen API on arbitrary elements — only the
		// <video> element exposes its own (webkit-prefixed) fullscreen.
		const legacy = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
		legacy?.webkitEnterFullscreen?.();
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
		// Hide after inactivity while playing. (We intentionally don't keep them
		// visible just because a control has focus — clicking play focuses its
		// button, which used to pin the controls open forever.)
		hideTimer = setTimeout(() => {
			if (!paused) controlsVisible = false;
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

	// Wire the media source. Prefer HLS when available: Safari plays the playlist
	// natively; elsewhere hls.js (lazy-loaded so it never ships to viewers of
	// progressive clips) attaches to the element. Falls back to the mp4 `src`.
	$effect(() => {
		const el = video;
		if (!el) return;
		const nativeHls = el.canPlayType('application/vnd.apple.mpegurl') !== '';
		if (hls && nativeHls) {
			el.src = hls;
			return;
		}
		if (!hls) {
			el.src = src;
			return;
		}
		let destroyed = false;
		let instance: { destroy: () => void } | null = null;
		void import('hls.js').then(({ default: Hls }) => {
			if (destroyed || !video) return;
			if (Hls.isSupported()) {
				const h = new Hls({ maxBufferLength: 30 });
				h.loadSource(hls);
				h.attachMedia(video);
				instance = h;
			} else {
				video.src = src; // last resort: progressive mp4
			}
		});
		return () => {
			destroyed = true;
			instance?.destroy();
		};
	});

	// Watch for a cast target on the network. Two independent surfaces: the
	// standard Remote Playback API (Chrome/Edge → Google Cast) and Safari's
	// webkit AirPlay events. Whichever reports availability reveals the button.
	$effect(() => {
		const el = video;
		if (!el) return;
		// Opt the element into AirPlay (Safari reads this attribute, not a property).
		el.setAttribute('x-webkit-airplay', 'allow');
		const cleanups: Array<() => void> = [];

		const remote = el.remote;
		if (remote && typeof remote.watchAvailability === 'function') {
			let watchId: number | null = null;
			remote
				.watchAvailability((available) => (castAvailable = available))
				.then((id) => (watchId = id))
				.catch(() => {
					/* remote playback disabled (e.g. MSE source) — button stays hidden */
				});
			const onConnect = () => (casting = true);
			const onDisconnect = () => (casting = false);
			remote.addEventListener('connect', onConnect);
			remote.addEventListener('connecting', onConnect);
			remote.addEventListener('disconnect', onDisconnect);
			cleanups.push(() => {
				remote.removeEventListener('connect', onConnect);
				remote.removeEventListener('connecting', onConnect);
				remote.removeEventListener('disconnect', onDisconnect);
				if (watchId != null) remote.cancelWatchAvailability(watchId).catch(() => {});
			});
		}

		const airplay = el as AirplayVideo;
		const onAvail = (event: Event) => {
			castAvailable = (event as Event & { availability?: string }).availability === 'available';
		};
		const onWireless = () => (casting = Boolean(airplay.webkitCurrentPlaybackTargetIsWireless));
		el.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
		el.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
		cleanups.push(() => {
			el.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
			el.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
		});

		return () => cleanups.forEach((fn) => fn());
	});

	function cast(): void {
		const el = video as AirplayVideo | null;
		if (!el) return;
		if (typeof el.webkitShowPlaybackTargetPicker === 'function') {
			el.webkitShowPlaybackTargetPicker();
		} else {
			el.remote?.prompt?.().catch(() => {
				/* user dismissed the picker, or no device accepted */
			});
		}
		poke();
	}

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
	<div class="frame">
		{#if loading && !errored}
			<div class="hairline" class:sweep={!$reducedMotion && !$comfortMode} aria-hidden="true"></div>
		{/if}

		<video
			bind:this={video}
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
				{#if castAvailable}
					<button
						class="control-button cast"
						class:on={casting}
						type="button"
						onclick={cast}
						aria-label={casting ? 'Casting to a device' : 'Cast to a device'}
						title={casting ? 'Casting' : 'Cast to a device'}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
							<path
								d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z"
								fill="currentColor"
							/>
							<path
								d="M21 3H3c-1.1 0-2 .9-2 2v2h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
								fill="currentColor"
							/>
						</svg>
					</button>
				{/if}
				<button class="control-button" type="button" onclick={() => void toggleFullscreen()}>
					{fullscreen ? 'Exit' : 'Full'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.player {
		position: relative;
		width: 100%;
		max-height: inherit;
	}

	/* Shrink-wraps the video (fit-content, centered) so the overlaid controls align
	   to the video edges instead of the full column width — which left the control
	   scrim sticking out on the sides of narrower-than-16:9 footage. */
	.frame {
		position: relative;
		width: fit-content;
		max-width: 100%;
		max-height: inherit;
		margin: 0 auto;
	}

	video {
		display: block;
		width: auto;
		max-width: 100%;
		max-height: inherit;
		background: var(--ink);
	}

	/* Fullscreen: maximize the video within the screen without ever cropping it. */
	.player:fullscreen {
		display: grid;
		place-content: center;
		width: 100vw;
		height: 100vh;
		max-height: none;
		background: var(--ink);
	}

	.player:fullscreen .frame {
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
	}

	.player:fullscreen video {
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		/* Maximize within the screen without ever cropping the footage. */
		object-fit: contain;
	}

	.player:fullscreen .controls {
		padding: 22px 28px 16px;
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

	/* Overlaid on the bottom of the video (not in flow) so that when they fade out
	   during playback no empty control bar is left behind. */
	.controls {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 3;
		display: flex;
		gap: 22px;
		align-items: center;
		padding: 34px 18px 14px;
		background: linear-gradient(180deg, transparent, rgb(0 0 0 / 0.5));
		transition: opacity var(--fade) ease;
	}

	.controls.hidden {
		opacity: 0;
		pointer-events: none;
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

	.control-button.cast {
		display: inline-grid;
		place-items: center;
		padding: 0;
	}

	.control-button.cast svg {
		width: 20px;
		height: 20px;
	}

	/* Lit while connected to a receiver, otherwise it reads as just another
	   quiet control. */
	.control-button.cast.on {
		color: var(--dawn);
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

	/* Mobile: there's vertical room, so drop the controls UNDER the video (in flow,
	   always visible) instead of overlaying it — and give the scrub its own
	   full-width row above a tighter, wrapping button row. */
	@media (max-width: 640px) {
		.controls {
			position: static;
			flex-wrap: wrap;
			gap: 6px 12px;
			padding: 12px 2px 0;
			background: none;
		}

		.controls.hidden {
			opacity: 1;
			pointer-events: auto;
		}

		.controls :global(.track) {
			order: -1;
			flex-basis: 100%;
		}

		.timecode {
			font-size: 14px;
		}

		.control-button {
			font-size: 12px;
			letter-spacing: 0.12em;
		}

		button {
			min-width: 40px;
		}
	}
</style>
