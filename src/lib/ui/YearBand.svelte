<script lang="ts">
	import { resolve } from '$app/paths';
	import type { YearCount } from './rail-math';

	interface Props {
		activeYear: number;
		years: YearCount[];
		now: number;
		onStep?: (delta: number) => void;
	}

	let { activeYear, years, now, onStep }: Props = $props();
	const current = $derived(years.find((year) => year.year === activeYear));
	const count = $derived(current?.count ?? 0);
	const people = $derived(current?.people ?? 0);
	const neighborYears = $derived([activeYear - 2, activeYear - 1, activeYear + 1, activeYear + 2]);
	const previousYears = $derived(neighborYears.slice(0, 2).filter((year) => year >= 1));
	const canPrev = $derived(activeYear > 1);
	const canNext = $derived(activeYear < now);
</script>

<section class="year-band" aria-label="Current year">
	<button type="button" aria-label="Previous year" disabled={!canPrev} onclick={() => onStep?.(-1)}
		>‹</button
	>
	<div class="years">
		{#each previousYears as year, index (year)}
			<a class={index === previousYears.length - 1 ? 'near' : 'side'} href={resolve(`/?y=${year}`)}
				>{year}</a
			>
		{/each}
		<h1>{activeYear}<small>{count} moments · {people} people</small></h1>
		{#if neighborYears[2] <= now}
			<a class="near" href={resolve(`/?y=${neighborYears[2]}`)}>{neighborYears[2]}</a>
		{/if}
		{#if neighborYears[3] <= now}
			<a class="side" href={resolve(`/?y=${neighborYears[3]}`)}>{neighborYears[3]}</a>
		{/if}
	</div>
	<button type="button" aria-label="Next year" disabled={!canNext} onclick={() => onStep?.(1)}
		>›</button
	>
</section>

<style>
	.year-band {
		position: relative;
		z-index: 3;
		display: grid;
		grid-template-columns: 44px 1fr 44px;
		align-items: center;
		gap: clamp(0.5rem, 3vw, 1.5rem);
		padding: clamp(1rem, 5vw, 2rem) clamp(1rem, 4vw, 1.875rem) 0;
		color: var(--cream);
	}

	button {
		width: 44px;
		height: 44px;
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 2.2rem;
		cursor: pointer;
	}

	button:disabled {
		cursor: default;
		opacity: 0.28;
	}

	.years {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: clamp(0.8rem, 4vw, 2.6rem);
		white-space: nowrap;
		overflow: hidden;
	}

	h1 {
		margin: 0;
		font-size: clamp(5rem, 15vw, 9.4rem);
		font-weight: 760;
		line-height: 0.8;
		letter-spacing: 0;
	}

	small {
		display: block;
		margin-top: 0.65rem;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.28em;
		text-align: center;
		text-transform: uppercase;
		color: var(--timeline-muted, rgba(23, 20, 18, 0.75));
		text-shadow: none;
	}

	.near,
	.side {
		font-family: var(--font-serif);
		font-weight: 760;
		color: rgba(255, 245, 232, 0.52);
		text-decoration: none;
	}

	.near:hover,
	.side:hover,
	.near:focus-visible,
	.side:focus-visible {
		color: var(--cream);
	}

	.near {
		font-size: clamp(2.5rem, 7vw, 3.2rem);
	}

	.side {
		font-size: clamp(1.9rem, 5vw, 2.3rem);
		color: rgba(255, 245, 232, 0.34);
	}

	:global(html.comfort) .near,
	:global(html.comfort) .side {
		display: none;
	}

	:global(html.comfort) button {
		width: 48px;
		height: 48px;
	}

	:global(html.comfort) .year-band {
		grid-template-columns: 48px 1fr 48px;
	}

	@media (max-width: 760px) {
		.year-band {
			grid-template-columns: 44px 1fr 44px;
			padding-top: 1rem;
		}

		.near,
		.side {
			display: none;
		}

		h1 {
			font-size: clamp(4.8rem, 22vw, 6rem);
		}
	}
</style>
