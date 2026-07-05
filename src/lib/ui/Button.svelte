<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		type?: 'submit' | 'button';
		children: Snippet;
	}
	let { type = 'submit', children }: Props = $props();
</script>

<button {type}>{@render children()}</button>

<style>
	button {
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.8rem;
		font-weight: 600;
		min-height: 44px;
		padding: 0 1.6rem;
		border: 0;
		background: var(--cream);
		color: var(--ink);
		cursor: pointer;
	}

	:global(html.light) button {
		background: var(--ink);
		color: var(--cream);
	}
</style>
