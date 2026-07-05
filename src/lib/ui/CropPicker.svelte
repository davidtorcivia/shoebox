<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { makePortraitCrop } from './crop';

	let {
		imageUrl,
		imageW,
		imageH,
		crop = $bindable()
	}: { imageUrl: string; imageW: number; imageH: number; crop: CropRect } = $props();

	let stage: HTMLDivElement;
	let dragging = $state(false);

	const center = () => ({ cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 });

	function pointAt(event: PointerEvent) {
		const rect = stage.getBoundingClientRect();
		return {
			cx: (event.clientX - rect.left) / rect.width,
			cy: (event.clientY - rect.top) / rect.height
		};
	}

	function onDown(event: PointerEvent) {
		dragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		onMove(event);
	}

	function onMove(event: PointerEvent) {
		if (!dragging) return;
		const point = pointAt(event);
		crop = makePortraitCrop(imageW, imageH, crop.h, point.cx, point.cy);
	}

	function onZoom(event: Event) {
		const h = Number((event.currentTarget as HTMLInputElement).value);
		const { cx, cy } = center();
		crop = makePortraitCrop(imageW, imageH, h, cx, cy);
	}
</script>

<div class="picker">
	<div
		class="stage"
		bind:this={stage}
		style:aspect-ratio={`${imageW} / ${imageH}`}
		role="application"
		aria-label="Drag to position portrait crop"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={() => (dragging = false)}
		onpointercancel={() => (dragging = false)}
		data-testid="crop-stage"
	>
		<img src={imageUrl} alt="Avatar source" draggable="false" />
		<div
			class="rect"
			style:left={`${crop.x * 100}%`}
			style:top={`${crop.y * 100}%`}
			style:width={`${crop.w * 100}%`}
			style:height={`${crop.h * 100}%`}
		></div>
	</div>
	<label class="zoom">
		<span>Zoom</span>
		<input type="range" min="0.1" max="1" step="0.01" value={crop.h} oninput={onZoom} />
	</label>
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		overflow: hidden;
		cursor: crosshair;
		touch-action: none;
	}

	.stage img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		user-select: none;
	}

	.rect {
		position: absolute;
		box-shadow: 0 0 0 9999px color-mix(in srgb, var(--ink) 55%, transparent);
		outline: 2px solid var(--cream);
		pointer-events: none;
	}

	.zoom {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.zoom input {
		min-height: 44px;
		flex: 1;
		accent-color: var(--dawn);
	}
</style>
