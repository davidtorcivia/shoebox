<script lang="ts">
	import { formatTimecode } from '$lib/domain/timecode';
	import { CREAM, DAWN } from '$lib/ui/tokens';
	import { fractionOf, timeFromClientX } from './scrub-math';

	interface Clip {
		in: number;
		out: number;
	}

	interface Props {
		duration: number;
		currentTime: number;
		buffered?: number;
		onseek: (time: number) => void;
		/** When set, the track shows a draggable in/out selection over the rail. */
		clip?: Clip | null;
		onClipChange?: (inSec: number, outSec: number) => void;
		/** Storyboard sprite for the hover/drag thumbnail bubble (10x10, 100 frames). */
		spriteUrl?: string | null;
	}

	let {
		duration,
		currentTime,
		buffered = 0,
		onseek,
		clip = null,
		onClipChange,
		spriteUrl = null
	}: Props = $props();

	let track: HTMLDivElement;
	let dragging = $state(false);
	// Which clip handle is being dragged, and the fraction to show a thumbnail for.
	let activeHandle = $state<'in' | 'out' | null>(null);
	let previewFraction = $state<number | null>(null);

	// Storyboard geometry (matches spriteHandler / ThumbnailPicker).
	const COLS = 10;
	const ROWS = 10;
	const FRAMES = COLS * ROWS;
	const TILE_W = 128;
	const TILE_H = 72;

	const MIN_CLIP = 0.2;

	const fraction = $derived(fractionOf(currentTime, duration));
	const bufferedFraction = $derived(fractionOf(buffered, duration));
	const inFraction = $derived(clip ? fractionOf(clip.in, duration) : 0);
	const outFraction = $derived(clip ? fractionOf(clip.out, duration) : 1);

	function tileStyle(time: number): string {
		if (!spriteUrl || !duration || duration <= 0) return '';
		const index = Math.min(FRAMES - 1, Math.max(0, Math.round((time / duration) * FRAMES - 0.5)));
		const col = index % COLS;
		const row = Math.floor(index / COLS);
		return [
			`background-image:url(${spriteUrl})`,
			`background-size:${TILE_W * COLS}px ${TILE_H * ROWS}px`,
			`background-position:-${col * TILE_W}px -${row * TILE_H}px`
		].join(';');
	}

	function seekAt(clientX: number) {
		onseek(timeFromClientX(clientX, track.getBoundingClientRect(), duration));
	}

	function onPointerDown(event: PointerEvent) {
		dragging = true;
		track.setPointerCapture(event.pointerId);
		seekAt(event.clientX);
	}

	function onPointerMove(event: PointerEvent) {
		if (dragging) seekAt(event.clientX);
	}

	function onPointerUp(event: PointerEvent) {
		dragging = false;
		if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
	}

	// --- Clip handle dragging (independent of the seek pointer above) ---
	function startHandle(which: 'in' | 'out', event: PointerEvent) {
		if (!clip) return;
		event.stopPropagation();
		event.preventDefault();
		activeHandle = which;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		moveHandle(event);
	}

	function moveHandle(event: PointerEvent) {
		if (!clip || !activeHandle || !onClipChange) return;
		const time = timeFromClientX(event.clientX, track.getBoundingClientRect(), duration);
		if (activeHandle === 'in') {
			const next = Math.min(time, clip.out - MIN_CLIP);
			onClipChange(Math.max(0, next), clip.out);
			previewFraction = fractionOf(Math.max(0, next), duration);
		} else {
			const next = Math.max(time, clip.in + MIN_CLIP);
			onClipChange(clip.in, Math.min(duration, next));
			previewFraction = fractionOf(Math.min(duration, next), duration);
		}
	}

	function endHandle(event: PointerEvent) {
		if (!activeHandle) return;
		const el = event.currentTarget as HTMLElement;
		if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
		activeHandle = null;
		previewFraction = null;
	}

	function onKeyDown(event: KeyboardEvent) {
		let time: number | null = null;
		if (event.key === 'ArrowLeft') time = Math.max(0, currentTime - 5);
		else if (event.key === 'ArrowRight') time = Math.min(duration, currentTime + 5);
		else if (event.key === 'Home') time = 0;
		else if (event.key === 'End') time = duration;

		if (time !== null) {
			event.preventDefault();
			event.stopPropagation();
			onseek(time);
		}
	}

	function handleKey(which: 'in' | 'out', event: KeyboardEvent) {
		if (!clip || !onClipChange) return;
		const step = event.shiftKey ? 1 : 1 / 30;
		let delta = 0;
		if (event.key === 'ArrowLeft') delta = -step;
		else if (event.key === 'ArrowRight') delta = step;
		else return;
		event.preventDefault();
		event.stopPropagation();
		if (which === 'in') {
			onClipChange(Math.max(0, Math.min(clip.in + delta, clip.out - MIN_CLIP)), clip.out);
		} else {
			onClipChange(clip.in, Math.min(duration, Math.max(clip.out + delta, clip.in + MIN_CLIP)));
		}
	}
</script>

<div
	class="track"
	class:clipping={!!clip}
	bind:this={track}
	role="slider"
	tabindex="0"
	aria-label="Seek"
	aria-valuemin="0"
	aria-valuemax={Math.round(duration)}
	aria-valuenow={Math.round(currentTime)}
	aria-valuetext={formatTimecode(currentTime)}
	style:--cream={CREAM}
	style:--dawn={DAWN}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydown={onKeyDown}
>
	<span class="rail"></span>
	<span class="buffered" style={`width: ${bufferedFraction * 100}%`}></span>
	{#if clip}
		<!-- Dim the footage outside the selection so the clip stands out. -->
		<span class="mask" style={`left: 0; width: ${inFraction * 100}%`}></span>
		<span class="mask" style={`left: ${outFraction * 100}%; right: 0`}></span>
		<span
			class="selection"
			style={`left: ${inFraction * 100}%; width: ${(outFraction - inFraction) * 100}%`}
		></span>
	{:else}
		<span class="current" style={`width: ${fraction * 100}%`}></span>
	{/if}
	<span class="head" style={`left: calc(${fraction * 100}% - 2px)`}></span>

	{#if clip}
		<span
			class="handle in"
			class:active={activeHandle === 'in'}
			style={`left: ${inFraction * 100}%`}
			role="slider"
			tabindex="0"
			aria-label="Clip start"
			aria-valuemin="0"
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(clip.in)}
			aria-valuetext={formatTimecode(clip.in)}
			onpointerdown={(event) => startHandle('in', event)}
			onpointermove={moveHandle}
			onpointerup={endHandle}
			onkeydown={(event) => handleKey('in', event)}
		></span>
		<span
			class="handle out"
			class:active={activeHandle === 'out'}
			style={`left: ${outFraction * 100}%`}
			role="slider"
			tabindex="0"
			aria-label="Clip end"
			aria-valuemin="0"
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(clip.out)}
			aria-valuetext={formatTimecode(clip.out)}
			onpointerdown={(event) => startHandle('out', event)}
			onpointermove={moveHandle}
			onpointerup={endHandle}
			onkeydown={(event) => handleKey('out', event)}
		></span>

		{#if previewFraction !== null && spriteUrl}
			<span
				class="thumb"
				style={`left: ${previewFraction * 100}%; ${tileStyle(activeHandle === 'in' ? clip.in : clip.out)}`}
			>
				<span class="thumb-time">{formatTimecode(activeHandle === 'in' ? clip.in : clip.out)}</span>
			</span>
		{/if}
	{/if}
</div>

<style>
	.track {
		position: relative;
		display: flex;
		flex: 1;
		align-items: center;
		height: 44px;
		cursor: pointer;
		touch-action: none;
	}

	.rail,
	.buffered,
	.current,
	.mask,
	.selection {
		position: absolute;
		top: 50%;
		height: 8px;
		pointer-events: none;
		transform: translateY(-50%);
	}

	.rail {
		right: 0;
		left: 0;
		background: color-mix(in srgb, var(--cream) 18%, transparent);
	}

	.buffered {
		left: 0;
		background: color-mix(in srgb, var(--cream) 28%, transparent);
	}

	.current {
		left: 0;
		background: var(--dawn);
	}

	/* Clip mode: a lit selection band with dimmed footage on either side. */
	.mask {
		background: color-mix(in srgb, var(--cream) 6%, transparent);
	}

	.selection {
		height: 12px;
		background: var(--dawn);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--cream) 30%, transparent) inset;
	}

	.clipping .rail {
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	.head {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 28px;
		background: var(--cream);
		pointer-events: none;
		transform: translateY(-50%);
	}

	.handle {
		position: absolute;
		top: 50%;
		z-index: 2;
		width: 14px;
		height: 30px;
		margin-left: -7px;
		border-radius: 3px;
		background: var(--cream);
		box-shadow: 0 1px 6px rgb(0 0 0 / 0.45);
		cursor: ew-resize;
		touch-action: none;
		transform: translateY(-50%);
	}

	/* A vertical grip line so the handle reads as draggable. */
	.handle::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 2px;
		height: 14px;
		background: color-mix(in srgb, var(--ink, #171412) 55%, transparent);
		transform: translate(-50%, -50%);
	}

	.handle.active {
		background: var(--dawn);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--dawn) 40%, transparent);
	}

	.handle:focus-visible {
		outline: 2px solid var(--dawn);
		outline-offset: 2px;
	}

	.thumb {
		position: absolute;
		bottom: calc(50% + 22px);
		z-index: 3;
		width: 128px;
		height: 72px;
		margin-left: -64px;
		background-color: #000;
		background-repeat: no-repeat;
		border: 1px solid color-mix(in srgb, var(--cream) 40%, transparent);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.5);
		pointer-events: none;
	}

	.thumb-time {
		position: absolute;
		bottom: 4px;
		left: 50%;
		padding: 1px 6px;
		background: rgb(0 0 0 / 0.7);
		color: var(--cream);
		font-family: var(--sans, sans-serif);
		font-size: 11px;
		transform: translateX(-50%);
	}

	.track:focus-visible {
		outline: 2px solid var(--dawn);
		outline-offset: 2px;
	}
</style>
