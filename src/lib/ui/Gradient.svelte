<script lang="ts">
	import { GRAIN_URI, type DecadePalette } from '$lib/ui/tokens';
	import { reducedMotion, resolvedTheme } from '$lib/ui/theme';

	interface Props {
		stops: [string, string, string];
		pools?: DecadePalette['pools'];
	}
	let { stops, pools = [] }: Props = $props();

	const layers = $derived.by(() => {
		const dark = $resolvedTheme === 'dark';
		const linear = dark
			? `linear-gradient(168deg, ${stops[0]} 0%, ${stops[1]} 62%, ${stops[2]} 135%)`
			: `linear-gradient(168deg, ${stops[0]} -35%, ${stops[1]} 40%, ${stops[2]} 100%)`;
		const radials = pools.map(
			(pool) => `radial-gradient(${pool.size} at ${pool.pos}, ${pool.color}, transparent 70%)`
		);
		return [...radials, linear].join(', ');
	});
</script>

<div class="room" class:drift={!$reducedMotion} style:background-image={layers} aria-hidden="true">
	<div class="grain" style:background-image={`url("${GRAIN_URI}")`}></div>
</div>

<style>
	.room {
		position: fixed;
		inset: 0;
		z-index: -1;
		background-size: 135% 135%;
		background-position: 50% 50%;
	}

	.room.drift {
		animation: drift 36s ease-in-out infinite alternate;
	}

	.grain {
		position: absolute;
		inset: 0;
		mix-blend-mode: overlay;
		opacity: 0.5;
		pointer-events: none;
	}

	@keyframes drift {
		from {
			background-position: 35% 42%;
		}

		to {
			background-position: 65% 58%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.room.drift {
			animation: none;
		}
	}
</style>
