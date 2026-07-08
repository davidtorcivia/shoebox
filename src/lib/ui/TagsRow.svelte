<script lang="ts">
	import { resolve } from '$app/paths';
	import { CREAM, DAWN_PALE, FONT } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/dto';

	interface Props {
		tags: ItemDTO['tags'];
		albums: ItemDTO['albums'];
	}

	let { tags, albums }: Props = $props();
</script>

<section
	class="social-row"
	aria-label="Tags"
	style:--cream={CREAM}
	style:--dawn-pale={DAWN_PALE}
	style:--serif={FONT.serif}
	style:--sans={FONT.sans}
>
	{#if tags.length === 0 && albums.length === 0}
		<span class="empty">None</span>
	{:else}
		{#each tags as tag (tag.id)}
			<a href={resolve(`/?tags=${tag.id}`)}>{tag.name}</a>
		{/each}
		{#each albums as album (album.id)}
			<a href={resolve(`/albums?album=${album.id}`)}>{album.title}</a>
		{/each}
	{/if}
</section>

<style>
	.social-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.85rem;
		align-items: center;
		min-height: 19px;
		color: var(--cream);
	}

	a {
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--dawn-pale);
		text-decoration: none;
	}

	.empty {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}
</style>
