<script lang="ts">
	import { formatTimecode } from '$lib/domain/timecode';
	import { CREAM, DAWN } from '$lib/ui/tokens';
	import { fractionOf, timeFromClientX } from './scrub-math';

	interface Props {
		duration: number;
		currentTime: number;
		buffered?: number;
		onseek: (time: number) => void;
	}

	let { duration, currentTime, buffered = 0, onseek }: Props = $props();
	let track: HTMLDivElement;
	let dragging = $state(false);

	const fraction = $derived(fractionOf(currentTime, duration));
	const bufferedFraction = $derived(fractionOf(buffered, duration));

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
</script>

<div
	class="track"
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
	<span class="current" style={`width: ${fraction * 100}%`}></span>
	<span class="head" style={`left: calc(${fraction * 100}% - 2px)`}></span>
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
	.current {
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

	.head {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 28px;
		background: var(--cream);
		pointer-events: none;
		transform: translateY(-50%);
	}

	.track:focus-visible {
		outline: 2px solid var(--dawn);
		outline-offset: 2px;
	}
</style>
