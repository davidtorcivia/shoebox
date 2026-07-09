<script lang="ts">
	import { onDestroy } from 'svelte';
	import { formatTimecode } from '$lib/domain/timecode';
	import { SHUTTLE_PAUSED, shuttleNext, togglePlay, type Shuttle } from '$lib/domain/shuttle';
	import { CREAM, DAWN, FONT, INK, MOTION } from '$lib/ui/tokens';
	import { comfortMode, reducedMotion } from '$lib/ui/theme';
	import ScrubTrack from './ScrubTrack.svelte';
	import { FRAME_STEP, type PlayerAction } from './player-keys';
	import {
		CLIP_MAX_GIF_SECONDS,
		CLIP_MAX_MP4_SECONDS,
		CLIP_MIN_SECONDS,
		clipStem,
		type ClipFormat
	} from '$lib/domain/clip';
	import {
		castMedia,
		loadCastFramework,
		toCastState,
		type CastFramework,
		type CastState
	} from './cast';

	interface Props {
		src: string;
		poster: string;
		/** Master HLS playlist. When set, adaptive streaming is preferred over `src`. */
		hls?: string | null;
		duration?: number | null;
		title?: string | null;
		/** Item id — enables the clip/trim tool (needs it to build export URLs). */
		itemId?: string | null;
		/** Storyboard sprite for thumbnail previews on the clip handles. */
		spriteUrl?: string | null;
		/** Whether to offer "Share segment" inside the clip tool. */
		canShareClip?: boolean;
		/** Ask the page to open its share dialog for the selected [start,end]. */
		onShareSegment?: ((start: number, end: number) => void) | null;
		/** View-only playback bounds (share viewer): seek to start and loop within. */
		segment?: { start: number; end: number } | null;
	}

	let {
		src,
		poster,
		hls = null,
		duration: durationHint = null,
		title = null,
		itemId = null,
		spriteUrl = null,
		canShareClip = false,
		onShareSegment = null,
		segment = null
	}: Props = $props();

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

	// Clip/trim tool. When active the scrubber shows an in/out selection, playback
	// loops within it, and an export toolbar appears.
	let clipMode = $state(false);
	let clipIn = $state(0);
	let clipOut = $state(0);
	let exporting = $state<null | 'mp4' | 'gif'>(null);
	let clipError = $state('');
	let segmentSeeded = false;

	const clipLength = $derived(Math.max(0, clipOut - clipIn));
	const canClip = $derived(!!itemId);

	// Cast / remote playback across three surfaces: Google Cast (Chrome, via the
	// SDK — handles HLS/MSE by sending the URL to the receiver), Safari AirPlay,
	// and the standard Remote Playback API (others). The button stays hidden until
	// one of them reports a device on the network.
	let castFw: CastFramework | null = null;
	let chromecastState = $state<CastState>('off');
	let airplayAvailable = $state(false);
	let airplayConnected = $state(false);
	let remoteAvailable = $state(false);
	let remoteConnected = $state(false);
	const castAvailable = $derived(chromecastState !== 'off' || airplayAvailable || remoteAvailable);
	const casting = $derived(chromecastState === 'connected' || airplayConnected || remoteConnected);

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
			case 'clip-toggle':
				if (canClip) toggleClip();
				break;
			case 'clip-set-in':
				if (canClip) setClipEdge('in');
				break;
			case 'clip-set-out':
				if (canClip) setClipEdge('out');
				break;
			default:
				return;
		}
		poke();
	}

	function clipDuration(): number {
		return duration || video?.duration || durationHint || 0;
	}

	function toggleClip() {
		if (clipMode) {
			clipMode = false;
			clipError = '';
			return;
		}
		const total = clipDuration();
		if (total <= 0) return;
		// Default selection: a few seconds from the current playhead.
		const start = Math.min(currentTime, Math.max(0, total - CLIP_MIN_SECONDS));
		const span = Math.min(5, total);
		clipIn = start;
		clipOut = Math.min(total, Math.max(start + CLIP_MIN_SECONDS, start + span));
		if (clipOut - clipIn < CLIP_MIN_SECONDS) clipIn = Math.max(0, clipOut - span);
		clipMode = true;
		clipError = '';
		poke();
	}

	function setClipEdge(which: 'in' | 'out') {
		const total = clipDuration();
		if (total <= 0) return;
		if (!clipMode) {
			toggleClip();
		}
		if (which === 'in') {
			clipIn = Math.min(currentTime, clipOut - CLIP_MIN_SECONDS);
			if (clipIn < 0) clipIn = 0;
		} else {
			clipOut = Math.max(currentTime, clipIn + CLIP_MIN_SECONDS);
			if (clipOut > total) clipOut = total;
		}
	}

	function onClipChange(inSec: number, outSec: number) {
		clipIn = inSec;
		clipOut = outSec;
		clipError = '';
	}

	async function exportClip(format: ClipFormat) {
		if (!itemId || exporting) return;
		clipError = '';
		exporting = format;
		try {
			const url = `/api/items/${itemId}/clip?start=${clipIn.toFixed(3)}&end=${clipOut.toFixed(3)}&format=${format}`;
			const res = await fetch(url);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { message?: string } | null;
				clipError = body?.message ?? 'Could not render clip';
				return;
			}
			const blob = await res.blob();
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = `${clipStem(title, clipIn, clipOut)}.${format}`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			// Revoke after the download has surely started.
			setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
		} catch {
			clipError = 'Could not render clip';
		} finally {
			exporting = null;
		}
	}

	function shareSegment() {
		onShareSegment?.(clipIn, clipOut);
	}

	// Loop playback within the active bounds — the clip selection while trimming,
	// or a shared segment in view-only mode.
	function enforceBounds() {
		// Only loop while actually playing — otherwise dragging a handle to the out
		// point would immediately snap the preview frame back to the in point.
		if (!video || video.paused) return;
		const bounds = clipMode
			? { in: clipIn, out: clipOut }
			: segment
				? { in: segment.start, out: segment.end }
				: null;
		if (!bounds) return;
		if (video.currentTime >= bounds.out - 0.03 || video.currentTime < bounds.in - 0.5) {
			video.currentTime = bounds.in;
			currentTime = bounds.in;
		}
	}

	// Preview the frame under a dragged in/out handle on the big video.
	function scrubPreview(time: number) {
		if (!video) return;
		if (!video.paused) video.pause();
		video.currentTime = time;
		currentTime = time;
	}

	// Play the selection, looping within [in,out] with sound (enforceBounds loops).
	function playLoop() {
		if (!video) return;
		if (!video.paused) {
			video.pause();
			return;
		}
		if (video.muted) {
			video.muted = false;
			muted = false;
		}
		if (video.currentTime < clipIn || video.currentTime >= clipOut - 0.03) {
			video.currentTime = clipIn;
			currentTime = clipIn;
		}
		void video.play();
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
		// Never auto-hide the controls while the clip tool is open — its toolbar and
		// handles must stay reachable.
		if (paused || clipMode || noHover || $reducedMotion || $comfortMode) return;
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

	// Shared-segment view mode: once the video can play, jump to the segment start
	// so the viewer lands on the clip rather than the video's beginning.
	$effect(() => {
		if (!segment || !video || segmentSeeded) return;
		if (Number.isFinite(video.duration) && video.duration > 0) {
			video.currentTime = segment.start;
			currentTime = segment.start;
			segmentSeeded = true;
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

	// Watch every cast surface for an available device; whichever fires reveals
	// the button.
	$effect(() => {
		const el = video;
		if (!el) return;
		// Opt the element into AirPlay (Safari reads this attribute, not a property).
		el.setAttribute('x-webkit-airplay', 'allow');
		const cleanups: Array<() => void> = [];
		let cancelled = false;

		// Standard Remote Playback API (Firefox and others). Rejects on MSE sources,
		// which is exactly where the Cast SDK below takes over.
		const remote = el.remote;
		if (remote && typeof remote.watchAvailability === 'function') {
			let watchId: number | null = null;
			remote
				.watchAvailability((available) => (remoteAvailable = available))
				.then((id) => (watchId = id))
				.catch(() => {});
			const onConnect = () => (remoteConnected = true);
			const onDisconnect = () => (remoteConnected = false);
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

		// Safari AirPlay.
		const airplay = el as AirplayVideo;
		const onAvail = (event: Event) => {
			airplayAvailable = (event as Event & { availability?: string }).availability === 'available';
		};
		const onWireless = () =>
			(airplayConnected = Boolean(airplay.webkitCurrentPlaybackTargetIsWireless));
		el.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
		el.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
		cleanups.push(() => {
			el.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
			el.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
		});

		// Google Cast (Chrome/Edge). The full SDK, so casting works even for the
		// HLS/MSE case the Remote Playback API can't handle.
		void loadCastFramework().then((fw) => {
			if (!fw || cancelled) return;
			castFw = fw;
			const ctx = fw.CastContext.getInstance();
			const apply = (raw: string) => {
				chromecastState = toCastState(fw, raw);
				// Hand playback off to the TV so we're not playing in two places.
				if (chromecastState === 'connected') video?.pause();
			};
			apply(ctx.getCastState());
			const handler = (event: { castState: string }) => apply(event.castState);
			ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, handler);
			cleanups.push(() =>
				ctx.removeEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, handler)
			);
		});

		return () => {
			cancelled = true;
			cleanups.forEach((fn) => fn());
		};
	});

	function cast(): void {
		const el = video as AirplayVideo | null;
		if (!el) return;
		const toAbs = (u: string) => new URL(u, window.location.href).href;

		// Chrome / Chromecast: send the media URL to the receiver via the Cast SDK.
		if (castFw) {
			void castMedia(castFw, {
				url: toAbs(hls ?? src),
				contentType: hls ? 'application/x-mpegurl' : 'video/mp4',
				title,
				posterUrl: poster ? toAbs(poster) : null
			}).catch(() => {
				/* user dismissed the picker, or the receiver rejected the media */
			});
			poke();
			return;
		}

		// Safari AirPlay.
		if (typeof el.webkitShowPlaybackTargetPicker === 'function') {
			el.webkitShowPlaybackTargetPicker();
			poke();
			return;
		}

		// Standard Remote Playback (Firefox, others).
		el.remote?.prompt?.().catch(() => {});
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
			ontimeupdate={() => {
				currentTime = video?.currentTime ?? 0;
				enforceBounds();
			}}
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
				<ScrubTrack
					{duration}
					{currentTime}
					{buffered}
					onseek={seek}
					clip={clipMode ? { in: clipIn, out: clipOut } : null}
					{onClipChange}
					onScrub={scrubPreview}
					{spriteUrl}
				/>
				<div class="right-controls">
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
					{#if canClip}
						<button
							class="control-button clip-toggle"
							class:on={clipMode}
							type="button"
							onclick={toggleClip}
							aria-label="Clip a segment"
							aria-pressed={clipMode}
							title="Clip a segment (C)"
						>
							<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
								<path
									fill="currentColor"
									d="M9.64 7.64a3 3 0 1 0-1.41 1.41L11 12l-2.77 2.95a3 3 0 1 0 1.41 1.41L12.5 13l6.5 7h2v-1L9.64 7.64ZM6 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm8-9 7-7v-1h-2l-6 6 1 2Z"
								/>
							</svg>
						</button>
					{/if}
					<button class="control-button" type="button" onclick={() => void toggleFullscreen()}>
						{fullscreen ? 'Exit' : 'Full'}
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if clipMode && !errored}
		<div class="clip-bar" data-testid="clip-bar">
			<button
				class="clip-play"
				type="button"
				data-testid="clip-play"
				onclick={playLoop}
				aria-label={paused ? 'Play the selection' : 'Pause'}
			>
				{paused ? '▶' : '❚❚'}
				<span>Loop</span>
			</button>
			<div class="clip-range">
				<span class="clip-label">Clip</span>
				<b>{formatTimecode(clipIn)}</b>
				<span class="clip-dash">–</span>
				<b>{formatTimecode(clipOut)}</b>
				<span class="clip-len">{clipLength.toFixed(1)}s</span>
			</div>
			<div class="clip-buttons">
				<button
					type="button"
					class="clip-btn"
					data-testid="clip-mp4"
					disabled={exporting !== null ||
						clipLength < CLIP_MIN_SECONDS ||
						clipLength > CLIP_MAX_MP4_SECONDS}
					title={`Download MP4 (up to ${CLIP_MAX_MP4_SECONDS}s)`}
					onclick={() => void exportClip('mp4')}
				>
					{exporting === 'mp4' ? 'Rendering…' : 'MP4'}
				</button>
				<button
					type="button"
					class="clip-btn"
					data-testid="clip-gif"
					disabled={exporting !== null ||
						clipLength < CLIP_MIN_SECONDS ||
						clipLength > CLIP_MAX_GIF_SECONDS}
					title={`Convert to GIF (up to ${CLIP_MAX_GIF_SECONDS}s)`}
					onclick={() => void exportClip('gif')}
				>
					{exporting === 'gif' ? 'Rendering…' : 'GIF'}
				</button>
				{#if canShareClip}
					<button
						type="button"
						class="clip-btn"
						data-testid="clip-share"
						disabled={exporting !== null}
						onclick={shareSegment}
					>
						Share
					</button>
				{/if}
				<button type="button" class="clip-btn done" data-testid="clip-done" onclick={toggleClip}>
					Done
				</button>
			</div>
			{#if clipError}
				<span class="clip-error" role="alert">{clipError}</span>
			{/if}
		</div>
	{/if}
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
		gap: 14px;
		align-items: center;
		padding: 34px 18px 14px;
		background: linear-gradient(180deg, transparent, rgb(0 0 0 / 0.5));
		transition: opacity var(--fade) ease;
	}

	/* The trailing buttons (volume, cast, clip, full) group tightly together so the
	   scrubber — the most useful control — gets the rest of the width. */
	.right-controls {
		display: inline-flex;
		align-items: center;
		gap: 2px;
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

	.control-button.clip-toggle {
		display: inline-grid;
		place-items: center;
		padding: 0;
	}

	.control-button.clip-toggle svg {
		width: 20px;
		height: 20px;
	}

	.control-button.clip-toggle.on {
		color: var(--dawn);
	}

	/* Trim toolbar — sits BENEATH the video (in flow) so it never covers the
	   footage while you're setting the in/out points. */
	.clip-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		margin: 12px auto 0;
		gap: 8px 16px;
		color: var(--cream);
	}

	/* Play/pause the selection, looping with sound. */
	.clip-play {
		display: inline-flex;
		min-height: 40px;
		align-items: center;
		gap: 8px;
		padding: 0 16px;
		background: var(--dawn);
		color: var(--ink);
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.clip-play:hover {
		background: color-mix(in srgb, var(--dawn) 88%, var(--cream));
	}

	.clip-range {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		font-family: var(--sans);
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}

	.clip-range b {
		font-weight: 700;
	}

	.clip-label {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}

	.clip-dash {
		opacity: 0.55;
	}

	.clip-len {
		padding: 1px 8px;
		background: color-mix(in srgb, var(--dawn) 22%, transparent);
		color: var(--dawn);
		font-size: 12px;
	}

	.clip-buttons {
		display: inline-flex;
		gap: 8px;
	}

	.clip-btn {
		min-width: 52px;
		min-height: 40px;
		padding: 0 12px;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		color: var(--cream);
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.clip-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--cream) 24%, transparent);
	}

	.clip-btn:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.clip-btn.done {
		background: var(--cream);
		color: var(--ink);
		font-weight: 700;
	}

	.clip-error {
		flex-basis: 100%;
		color: var(--dawn);
		font-family: var(--sans);
		font-size: 12px;
		text-align: center;
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
