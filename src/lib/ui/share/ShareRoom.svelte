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
	<div class="content">
		{@render children()}
	</div>
	<footer class="wordmark" data-testid="share-wordmark">SHOEBOX</footer>
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

	.content {
		position: relative;
		width: min(1200px, 100%);
		flex: 1;
		margin: 0 auto;
		padding: 40px 24px 24px;
	}

	.wordmark {
		position: relative;
		padding: 32px 0 16px;
		color: var(--cream);
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.3em;
		opacity: var(--chrome-opacity, 0.5);
		text-align: center;
		text-transform: uppercase;
	}
</style>
