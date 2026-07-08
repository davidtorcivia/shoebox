<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { accentOn } from '$lib/ui/tokens';

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

	// The avatar is square but the stored crop is a portrait rect. Cover-fit the
	// image on the crop's focal point so the face fills the square without the
	// non-uniform stretch (squish) the portrait crop-scaling would cause.
	const clamp = (v: number) => Math.min(100, Math.max(0, v));
	const focalX = $derived(avatarCrop ? clamp((avatarCrop.x + avatarCrop.w / 2) * 100) : 50);
	const focalY = $derived(avatarCrop ? clamp((avatarCrop.y + avatarCrop.h / 2) * 100) : 50);
</script>

{#if avatarUrl}
	<span class="avatar photo" aria-hidden="true" style={`--avatar-size: ${size}px`}>
		<img
			src={avatarUrl}
			alt={name}
			style={`object-position: ${focalX}% ${focalY}%`}
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
		overflow: hidden;
		background: color-mix(in srgb, var(--cream, #fff5e8) 10%, transparent);
	}

	.photo img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
	}
</style>
