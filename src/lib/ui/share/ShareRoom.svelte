<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CREAM, FONT, GRAIN_URI, INK } from '$lib/ui/tokens';

	let { stops, children }: { stops: [string, string, string]; children: Snippet } = $props();
</script>

<div
	class="share-room"
	style={`background: linear-gradient(165deg, ${stops[0]}, ${stops[1]} 55%, ${stops[2]}); --ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
>
	<div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
	<header class="share-top">
		<div class="wordmark" data-testid="share-wordmark">Shoebox</div>
	</header>
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.share-room {
		position: relative;
		display: flex;
		min-height: 100vh;
		flex-direction: column;
	}

	.grain {
		position: absolute;
		inset: 0;
		opacity: 0.5;
		mix-blend-mode: overlay;
		pointer-events: none;
	}

	.share-top {
		position: relative;
		z-index: 1;
		display: flex;
		min-height: 56px;
		align-items: center;
		padding: 0 28px;
	}

	.content {
		position: relative;
		width: min(1200px, 100%);
		flex: 1;
		margin: 0 auto;
		padding: 40px 24px 24px;
	}

	.wordmark {
		color: var(--cream);
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.26em;
		opacity: 0.92;
		text-transform: uppercase;
	}
</style>
