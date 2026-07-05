<script lang="ts">
	import { accentOn } from '$lib/ui/tokens';

	let { name, accentColor, size }: { name: string; accentColor: string; size: number } = $props();
	const initial = $derived(name.trim().charAt(0).toUpperCase());
	const fg = $derived(accentOn(accentColor));
	const fontSize = $derived(Math.max(10, Math.round(size * 0.52)));
</script>

<span
	class="avatar"
	aria-hidden="true"
	style={`--avatar-bg: ${accentColor}; --avatar-fg: ${fg}; --avatar-size: ${size}px; --avatar-font: ${fontSize}px`}
>
	{initial}
</span>

<style>
	.avatar {
		display: inline-grid;
		width: var(--avatar-size);
		height: var(--avatar-size);
		place-items: center;
		flex: none;
		background: var(--avatar-bg);
		color: var(--avatar-fg);
		font-family: var(--font-sans);
		font-size: var(--avatar-font);
		font-weight: 700;
		line-height: 1;
		text-transform: uppercase;
	}
</style>
