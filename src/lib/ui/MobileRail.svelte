<script lang="ts">
	import {
		mobileRailLabels,
		mobileRailTicks,
		thumbFraction,
		railSpan,
		type YearCount
	} from './rail-math';

	interface Props {
		years: YearCount[];
		earliest: number | null;
		activeYear: number;
		now: number;
	}

	let { years, earliest, activeYear, now }: Props = $props();
	const ticks = $derived(mobileRailTicks(years, earliest, activeYear, now));
	const labels = $derived(mobileRailLabels(earliest, activeYear, now));
	const thumb = $derived(thumbFraction(activeYear, railSpan(earliest, now)) * 100);
</script>

<section class="mobile-rail" aria-label="Mobile timeline rail">
	<div class="ticks">
		{#each ticks as tick (tick.startYear)}
			<i
				class:warm={tick.warm}
				class:empty={tick.empty}
				class:future={tick.future}
				style={`height: ${Math.max(tick.height, tick.empty ? 2 : 4)}px`}
			></i>
		{/each}
		<span class="thumb" style={`left: ${thumb}%`}><b>{activeYear}</b></span>
	</div>
	<div class="labels">
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
		padding: 1.875rem 1rem 0.875rem;
		background: linear-gradient(
			180deg,
			rgba(23, 20, 18, 0) 0%,
			rgba(23, 20, 18, 0.72) 34%,
			rgba(23, 20, 18, 0.94) 100%
		);
	}

	.ticks {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 30px;
	}

	i {
		flex: 1;
		background: rgba(255, 245, 232, 0.28);
	}

	i.empty {
		background: rgba(255, 245, 232, 0.14);
	}

	i.warm {
		background: rgba(250, 123, 98, 0.75);
	}

	i.future {
		opacity: 0.35;
	}

	.thumb {
		position: absolute;
		top: -22px;
		width: 2px;
		height: 52px;
		background: var(--cream);
		box-shadow: 0 0 18px rgba(255, 245, 232, 0.55);
		transform: translateX(-1px);
	}

	.thumb b {
		position: absolute;
		top: -16px;
		left: 50%;
		transform: translateX(-50%);
		font-family: var(--font-serif);
		font-size: 0.82rem;
		font-weight: 400;
		color: var(--cream);
	}

	.labels {
		position: relative;
		height: 1rem;
		margin-top: 0.5rem;
	}

	.labels span {
		position: absolute;
		transform: translateX(-50%);
		font-family: var(--font-sans);
		font-size: 0.48rem;
		letter-spacing: 0.14em;
		color: rgba(255, 245, 232, 0.45);
	}

	.labels span.active {
		color: var(--dawn);
		font-weight: 700;
	}

	@media (max-width: 760px) {
		.mobile-rail {
			display: block;
		}
	}
</style>
