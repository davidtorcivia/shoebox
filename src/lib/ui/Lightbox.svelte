<script lang="ts">
	import { MOTION } from '$lib/ui/tokens';
	import { reducedMotion } from '$lib/ui/theme';
	import { clampOffset, pinchScale, toggleZoom } from './zoom-math';

	interface Props {
		src: string;
		alt: string;
	}

	let { src, alt }: Props = $props();

	let stage: HTMLDivElement;
	let scale = $state(1);
	let x = $state(0);
	let y = $state(0);
	let dragging = $state(false);

	const pointers = new Map<number, { x: number; y: number }>();
	let pinchStart: { distance: number; scale: number } | null = null;
	let panStart: { px: number; py: number; x: number; y: number } | null = null;
	let lastTap = { time: 0, x: 0, y: 0 };

	function pointerDistance(): number {
		const [a, b] = [...pointers.values()];
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	function reclamp() {
		const rect = stage.getBoundingClientRect();
		x = clampOffset(x, scale, rect.width, rect.width);
		y = clampOffset(y, scale, rect.height, rect.height);
	}

	function zoomAt(clientX: number, clientY: number) {
		const rect = stage.getBoundingClientRect();
		const next = toggleZoom(scale);
		scale = next;
		if (next === 1) {
			x = 0;
			y = 0;
		} else {
			x = clampOffset(-(clientX - (rect.left + rect.width / 2)) * next, next, rect.width, rect.width);
			y = clampOffset(-(clientY - (rect.top + rect.height / 2)) * next, next, rect.height, rect.height);
		}
	}

	function onPointerDown(event: PointerEvent) {
		stage.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

		if (pointers.size === 2) {
			pinchStart = { distance: pointerDistance(), scale };
			panStart = null;
		} else if (pointers.size === 1) {
			const now = performance.now();
			const isDoubleTap =
				event.pointerType === 'touch' &&
				now - lastTap.time < 300 &&
				Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 25;
			if (isDoubleTap) {
				zoomAt(event.clientX, event.clientY);
				lastTap = { time: 0, x: 0, y: 0 };
				return;
			}
			lastTap = { time: now, x: event.clientX, y: event.clientY };
			if (scale > 1) {
				panStart = { px: event.clientX, py: event.clientY, x, y };
				dragging = true;
			}
		}
	}

	function onPointerMove(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (pointers.size === 2 && pinchStart) {
			scale = pinchScale(pinchStart.scale, pinchStart.distance, pointerDistance());
			reclamp();
		} else if (pointers.size === 1 && panStart) {
			const rect = stage.getBoundingClientRect();
			x = clampOffset(panStart.x + (event.clientX - panStart.px), scale, rect.width, rect.width);
			y = clampOffset(panStart.y + (event.clientY - panStart.py), scale, rect.height, rect.height);
		}
	}

	function onPointerUp(event: PointerEvent) {
		pointers.delete(event.pointerId);
		if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
		if (pointers.size < 2) pinchStart = null;
		if (pointers.size === 0) {
			panStart = null;
			dragging = false;
			if (scale <= 1.01) {
				scale = 1;
				x = 0;
				y = 0;
			}
		}
	}
</script>

<div
	class="lightbox"
	bind:this={stage}
	role="region"
	aria-label="Photo viewer"
	style:--fade={`${MOTION.fast}ms`}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={(event) => zoomAt(event.clientX, event.clientY)}
>
	<img
		{src}
		{alt}
		draggable="false"
		class:eased={!dragging && !$reducedMotion}
		style={`transform: translate(${x}px, ${y}px) scale(${scale})`}
	/>
</div>

<style>
	.lightbox {
		overflow: hidden;
		cursor: zoom-in;
		touch-action: none;
	}

	img {
		display: block;
		width: 100%;
		user-select: none;
		transform-origin: center center;
		-webkit-user-drag: none;
	}

	img.eased {
		transition: transform var(--fade) ease;
	}
</style>
