<script lang="ts">
	import { railDecades, type YearCount } from './rail-math';

	interface Props {
		years: YearCount[];
		earliest: number | null;
		activeYear: number;
		now: number;
	}

	let { years, earliest, activeYear, now }: Props = $props();
	const decades = $derived(railDecades(years, earliest, activeYear, now));
</script>

<section class="rail" aria-label="Timeline years">
	<div class="ticks">
		{#each decades as decade (decade.decade)}
			<div class:active={decade.active} class:future={decade.future} class="decade">
				{#each decade.ticks as tick (tick.year)}
					<i
						class:empty={tick.empty}
						class:active={tick.active}
						class:future={tick.future}
						style={`height: ${Math.max(tick.height, tick.empty ? 2 : 4)}px`}
						title={`${tick.year}: ${tick.empty ? 0 : 'items'}`}
					></i>
				{/each}
			</div>
		{/each}
	</div>
	<div class="labels">
		{#each decades as decade (decade.decade)}
			<span class:century={decade.centuryMark} class:active={decade.active}>{decade.label}</span>
		{/each}
	</div>
</section>

<style>
	.rail {
		position: relative;
		z-index: 2;
		padding: 0 1.875rem;
		color: var(--timeline-chrome, var(--ink));
	}

	.ticks,
	.labels {
		display: flex;
	}

	.ticks {
		align-items: flex-end;
		height: 44px;
	}

	.decade {
		display: flex;
		flex: 1;
		align-items: flex-end;
		gap: 2px;
		padding: 0 5px;
	}

	i {
		flex: 1;
		min-width: 1px;
		background: var(--timeline-soft, rgba(23, 20, 18, 0.22));
	}

	i.empty {
		background: color-mix(in srgb, var(--timeline-chrome, var(--ink)) 16%, transparent);
	}

	i.active {
		background: var(--timeline-chrome, var(--ink));
	}

	i.future,
	.decade.future i {
		opacity: 0.32;
	}

	.labels {
		padding-top: 0.4rem;
	}

	span {
		flex: 1;
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		color: var(--timeline-muted, rgba(23, 20, 18, 0.5));
	}

	span.century,
	span.active {
		font-weight: 700;
		color: var(--timeline-chrome, var(--ink));
	}

	@media (max-width: 760px) {
		.rail {
			display: none;
		}
	}
</style>
