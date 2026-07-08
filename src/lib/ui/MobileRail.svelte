<script lang="ts">
	import {
		mobileRailLabels,
		mobileRailYearTicks,
		thumbFraction,
		railSpan,
		type YearCount
	} from './rail-math';

	interface Props {
		years: YearCount[];
		earliest: number | null;
		activeYear: number;
		now: number;
		onselect?: (year: number) => void;
	}

	let { years, earliest, activeYear, now, onselect }: Props = $props();

	const span = $derived(railSpan(earliest, now));
	const ticks = $derived(mobileRailYearTicks(years, earliest, activeYear, now));
	const labels = $derived(mobileRailLabels(earliest, activeYear, now));

	let track = $state<HTMLElement>();
	let dragging = $state(false);
	// While scrubbing, follow the finger without navigating; commit once on release
	// so a drag across a decade doesn't fire a page load per year.
	let previewYear = $state<number | null>(null);

	const shownYear = $derived(previewYear ?? activeYear);
	const thumb = $derived(thumbFraction(shownYear, span) * 100);

	function yearAt(clientX: number): number {
		if (!track) return activeYear;
		const rect = track.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const year = Math.round(span.start + frac * (span.end - span.start));
		return Math.min(now, Math.max(1, year));
	}

	function commit(year: number): void {
		if (year !== activeYear) onselect?.(year);
	}

	function onPointerDown(event: PointerEvent): void {
		dragging = true;
		track?.setPointerCapture(event.pointerId);
		previewYear = yearAt(event.clientX);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragging) return;
		previewYear = yearAt(event.clientX);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		try {
			track?.releasePointerCapture(event.pointerId);
		} catch {
			/* pointer already released */
		}
		const year = previewYear;
		previewYear = null;
		if (year != null) commit(year);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			commit(Math.max(1, activeYear - 1));
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			commit(Math.min(now, activeYear + 1));
		}
	}
</script>

<section class="mobile-rail" aria-label="Mobile timeline rail">
	<div
		class="track"
		class:dragging
		bind:this={track}
		role="slider"
		tabindex="0"
		aria-label="Scrub to a year"
		aria-valuemin={span.start}
		aria-valuemax={now}
		aria-valuenow={activeYear}
		aria-valuetext={String(shownYear)}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onkeydown={onKeydown}
	>
		<div class="ticks" aria-hidden="true">
			{#each ticks as tick (tick.year)}
				<i class:active={tick.active} style={`left: ${tick.frac * 100}%; height: ${tick.height}px`}
				></i>
			{/each}
		</div>
		<span class="thumb" style={`left: ${thumb}%`}><b>{shownYear}</b></span>
	</div>
	<div class="labels" aria-hidden="true">
		{#each labels as label (label.decade)}
			<span class:active={label.active} style={`left: ${label.frac * 100}%`}>{label.text}</span>
		{/each}
	</div>
</section>

<style>
	.mobile-rail {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 8;
		display: none;
		padding: 2.4rem 1rem 0.9rem;
		/* A smoother, deeper multi-stop fade than the old 3-stop ramp. */
		background: linear-gradient(
			180deg,
			rgba(23, 20, 18, 0) 0%,
			rgba(23, 20, 18, 0.22) 20%,
			rgba(23, 20, 18, 0.55) 48%,
			rgba(23, 20, 18, 0.82) 74%,
			rgba(23, 20, 18, 0.95) 100%
		);
		animation: rail-rise 560ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes rail-rise {
		from {
			opacity: 0;
			transform: translateY(60%);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.track {
		position: relative;
		/* Generous touch target; touch-action:none keeps a horizontal drag from
		   scrolling the page. */
		padding: 14px 0 10px;
		touch-action: none;
		cursor: ew-resize;
	}

	.track:focus-visible {
		outline: 2px solid var(--dawn);
		outline-offset: 6px;
	}

	.ticks {
		position: relative;
		height: 30px;
	}

	/* One skinny line per year with media, anchored to its position on the rail
	   and as tall as its media count warrants. */
	i {
		position: absolute;
		bottom: 0;
		width: 2px;
		transform: translateX(-1px);
		background: rgba(255, 245, 232, 0.42);
		transition: background 160ms ease;
	}

	i.active {
		background: rgba(250, 123, 98, 0.95);
	}

	.thumb {
		position: absolute;
		top: 4px;
		width: 2px;
		height: 52px;
		background: var(--cream);
		box-shadow: 0 0 18px rgba(255, 245, 232, 0.55);
		transform: translateX(-1px);
		transition: left 240ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.track.dragging .thumb {
		transition: none;
	}

	.thumb b {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		padding: 2px 7px;
		font-family: var(--font-serif);
		font-size: 0.9rem;
		font-weight: 500;
		line-height: 1.1;
		color: var(--ink);
		background: var(--cream);
		transform: translateX(-50%);
		transition:
			transform 160ms ease,
			background 160ms ease;
	}

	.track.dragging .thumb b {
		transform: translateX(-50%) scale(1.14);
	}

	.labels {
		position: relative;
		height: 1rem;
		margin-top: 0.6rem;
	}

	.labels span {
		position: absolute;
		font-family: var(--font-sans);
		font-size: 0.48rem;
		letter-spacing: 0.14em;
		color: rgba(255, 245, 232, 0.45);
		transform: translateX(-50%);
	}

	.labels span.active {
		font-weight: 700;
		color: var(--dawn);
	}

	@media (max-width: 760px) {
		.mobile-rail {
			display: block;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mobile-rail {
			animation: none;
		}

		.thumb,
		.thumb b {
			transition: none;
		}
	}
</style>
