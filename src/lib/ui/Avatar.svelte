<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { accentOn } from '$lib/ui/tokens';
	import { cropStyle } from './crop';

	let {
		name,
		accentColor,
		size,
		avatarUrl = null,
		avatarCrop = null
	}: {
		name: string;
		accentColor: string;
		size: number;
		avatarUrl?: string | null;
		avatarCrop?: CropRect | null;
	} = $props();
	const initial = $derived(name.trim().charAt(0).toUpperCase());
	const fg = $derived(accentOn(accentColor));
	const fontSize = $derived(Math.max(10, Math.round(size * 0.52)));
</script>

{#if avatarUrl && avatarCrop}
	<span class="avatar photo" aria-hidden="true" style={`--avatar-size: ${size}px`}>
		<img
			src={avatarUrl}
			alt={name}
			style={cropStyle(avatarCrop)}
			draggable="false"
			loading="lazy"
		/>
	</span>
{:else}
	<span
		class="avatar"
		aria-hidden="true"
		style={`--avatar-bg: ${accentColor}; --avatar-fg: ${fg}; --avatar-size: ${size}px; --avatar-font: ${fontSize}px`}
	>
		{initial}
	</span>
{/if}

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

	.photo {
		position: relative;
		overflow: hidden;
	}

	.photo img {
		position: absolute;
		display: block;
		max-width: none;
	}
</style>
