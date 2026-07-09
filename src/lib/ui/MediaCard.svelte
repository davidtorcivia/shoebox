<script lang="ts">
	import { captionRight as defaultCaptionRight, formatDuration, thumbSrcset } from './card-format';
	import type { ItemDTO } from '$lib/types';
	import { comfortMode } from '$lib/ui/theme';

	interface Props {
		item: ItemDTO;
		activeYear: number;
		captionRight?: string | null;
		selecting?: boolean;
		selected?: boolean;
		onselect?: (id: string) => void;
		onbeginselect?: (id: string) => void;
	}

	let {
		item,
		activeYear,
		captionRight = null,
		selecting = false,
		selected = false,
		onselect,
		onbeginselect
	}: Props = $props();
	const duration = $derived(formatDuration(item.duration));
	const right = $derived(defaultCaptionRight(item));
	const sizes = '(max-width: 720px) 46vw, (max-width: 1100px) 30vw, 22vw';
	let scrubPct = $state(0);
	let scrubbing = $state(false);
	let previewing = $state(false);

	// Long-press (touch) or long mouse-hold begins multi-select on the timeline.
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressX = 0;
	let pressY = 0;
	let longPressed = false;

	function cancelPress(): void {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		longPressed = false;
		pressX = event.clientX;
		pressY = event.clientY;
		if (!onbeginselect) return;
		pressTimer = setTimeout(() => {
			pressTimer = null;
			longPressed = true;
			onbeginselect?.(item.id);
		}, 450);
	}

	function onCardPointerMove(event: PointerEvent): void {
		if (
			pressTimer &&
			(Math.abs(event.clientX - pressX) > 10 || Math.abs(event.clientY - pressY) > 10)
		) {
			cancelPress();
		}
		updateScrub(event);
	}

	function onOpen(event: MouseEvent): void {
		// A completed long-press already selected the item; swallow the trailing click.
		if (longPressed) {
			longPressed = false;
			event.preventDefault();
			return;
		}
		if (selecting) {
			event.preventDefault();
			onselect?.(item.id);
			return;
		}
		window.location.href = `/item/${item.id}?y=${activeYear}`;
	}
	const spriteFrame = $derived(Math.min(99, Math.max(0, Math.floor(scrubPct))));
	const spriteVisible = $derived(scrubbing || previewing);
	const spriteStyle = $derived.by(() => {
		if (!item.urls.sprite) return '';
		const col = spriteFrame % 10;
		const row = Math.floor(spriteFrame / 10);
		return [
			`background-image: url("${item.urls.sprite}")`,
			'background-size: 1000% 1000%',
			`background-position: ${(col / 9) * 100}% ${(row / 9) * 100}%`
		].join('; ');
	});

	function updateScrub(event: PointerEvent): void {
		if (!item.urls.sprite || $comfortMode) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		scrubPct = fraction * 100;
		scrubbing = true;
	}

	function cyclePreview(event: MouseEvent): void {
		event.stopPropagation();
		scrubPct = (Math.floor(scrubPct / 10) * 10 + 10) % 100;
		previewing = true;
	}
</script>

<article class="card" class:selecting class:selected data-type={item.type} data-item-id={item.id}>
	<div class="media-wrap">
		<button
			class="media"
			type="button"
			aria-label={selecting
				? `${selected ? 'Deselect' : 'Select'} ${item.title ?? item.displayDate}`
				: `Open ${item.title ?? item.displayDate}`}
			aria-pressed={selecting ? selected : undefined}
			onclick={onOpen}
			onpointerdown={onPointerDown}
			onpointermove={onCardPointerMove}
			onpointerup={() => {
				cancelPress();
				scrubbing = false;
			}}
			onpointercancel={cancelPress}
			onpointerleave={() => {
				cancelPress();
				scrubbing = false;
			}}
			oncontextmenu={(event) => {
				// Long-press on touch often raises a context menu; suppress it while
				// selection is available so the press reads as "start selecting".
				if (onbeginselect) event.preventDefault();
			}}
		>
			<img
				src={item.urls.thumb800 || item.urls.poster}
				srcset={thumbSrcset(item)}
				{sizes}
				alt={item.title ?? item.displayDate}
				loading="lazy"
			/>
			{#if selecting}
				<span class="select-tick" aria-hidden="true">{selected ? '✓' : ''}</span>
			{/if}
			{#if item.urls.sprite}
				<span class="sprite" class:visible={spriteVisible} style={spriteStyle} aria-hidden="true"
				></span>
				{#if !$comfortMode}
					<span
						class="scrub-hairline"
						data-testid="scrub-hairline"
						style={`transform: scaleX(${scrubPct / 100})`}
						aria-hidden="true"
					></span>
				{/if}
			{/if}
			{#if duration}
				<span class="duration">{duration}</span>
			{/if}
		</button>
		{#if $comfortMode && item.urls.sprite}
			<button class="preview" type="button" onclick={cyclePreview}>Preview</button>
		{/if}
	</div>
	<div class="caption">
		<span>{item.shortDate}</span>
		<span class="right">{captionRight ?? right}</span>
	</div>
</article>

<style>
	.card {
		color: var(--timeline-chrome, var(--ink));
	}

	.card.selecting .media {
		cursor: pointer;
	}

	.card.selecting .media img {
		filter: brightness(0.82);
	}

	.card.selected .media {
		outline: 3px solid var(--dawn, #fa7b62);
		outline-offset: -3px;
	}

	.card.selected .media img {
		filter: none;
	}

	.select-tick {
		position: absolute;
		top: 8px;
		left: 8px;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		background: color-mix(in srgb, var(--ink, #171412) 55%, transparent);
		color: var(--cream, #fff5e8);
		font-size: 14px;
		font-weight: 700;
		line-height: 1;
	}

	.card.selected .select-tick {
		background: var(--dawn, #fa7b62);
		color: var(--ink, #171412);
	}

	.media-wrap {
		position: relative;
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

	.sprite {
		position: absolute;
		inset: 0;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}

	.sprite.visible {
		opacity: 1;
	}

	.scrub-hairline {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		height: 2px;
		background: var(--cream);
		pointer-events: none;
		transform-origin: left center;
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

	.preview {
		position: absolute;
		bottom: 8px;
		left: 8px;
		min-width: 48px;
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background: var(--cream);
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
</style>
