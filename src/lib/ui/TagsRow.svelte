<script lang="ts">
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
	<span class="label">Tags</span>
	<div class="content">
		{#if tags.length === 0 && albums.length === 0}
			<span class="empty">None</span>
		{:else}
			{#each tags as tag (tag.id)}
				<a href={`/?tags=${tag.id}`}>{tag.name}</a>
			{/each}
			{#each albums as album (album.id)}
				<a href={`/albums/${album.id}`}>{album.title}</a>
			{/each}
		{/if}
	</div>
</section>

<style>
	.social-row {
		display: grid;
		grid-template-columns: 5rem 1fr;
		gap: 1rem;
		align-items: center;
		min-height: 19px;
		color: var(--cream);
	}

	.label {
		font-family: var(--sans);
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.content {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.85rem;
		align-items: center;
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
