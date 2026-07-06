<script lang="ts">
	import type { Snippet } from 'svelte';
	import Gradient from './Gradient.svelte';
	import { chromeVars } from './room';
	import { paletteFor } from './tokens';

	interface Props {
		year: number;
		motionDirection?: number;
		children: Snippet;
	}

	let { year, motionDirection = 0, children }: Props = $props();
	const palette = $derived(paletteFor(year));
	const vars = $derived(chromeVars(palette));
	const style = $derived(
		Object.entries(vars)
			.map(([key, value]) => `${key}: ${value}`)
			.join('; ')
	);
</script>

<div class="room" {style} data-direction={motionDirection}>
	<Gradient stops={palette.stops} pools={palette.pools} />
	{#key year}
		<div class="year-wash" aria-hidden="true"></div>
	{/key}
	{@render children()}
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.year-wash {
		position: fixed;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			radial-gradient(
				circle at 50% 18%,
				color-mix(in srgb, var(--timeline-chrome, var(--cream)) 42%, transparent),
				transparent 32rem
			),
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--timeline-chrome, var(--cream)) 18%, transparent),
				transparent 54%
			);
		mix-blend-mode: screen;
		animation: wash-forward 760ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.room[data-direction='-1'] .year-wash {
		animation-name: wash-backward;
	}

	@keyframes wash-forward {
		from {
			opacity: 0.34;
			transform: translateX(5rem) scaleX(0.92);
		}

		to {
			opacity: 0;
			transform: translateX(-3rem) scaleX(1.08);
		}
	}

	@keyframes wash-backward {
		from {
			opacity: 0.34;
			transform: translateX(-5rem) scaleX(0.92);
		}

		to {
			opacity: 0;
			transform: translateX(3rem) scaleX(1.08);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.year-wash {
			display: none;
		}
	}
</style>
