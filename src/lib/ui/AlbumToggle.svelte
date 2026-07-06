<script lang="ts">
	import type { AlbumDTO } from '$lib/domain/album-dto';

	let { itemId, memberships }: { itemId: string; memberships: { id: string; title: string }[] } =
		$props();

	let loadedItemId = $state('');
	let albums = $state<AlbumDTO[] | null>(null);
	let memberIds = $state<string[]>([]);
	let query = $state('');
	let busyAlbumId = $state<string | null>(null);
	let error = $state('');

	$effect(() => {
		if (loadedItemId === itemId) return;
		loadedItemId = itemId;
		albums = null;
		memberIds = memberships.map((membership) => membership.id);
		query = '';
		error = '';
	});

	const selectedAlbums = $derived(
		[...(albums ?? memberships)]
			.filter((album) => memberIds.includes(album.id))
			.sort(albumTitleSort)
	);
	const albumMatches = $derived.by(() => {
		const term = query.trim().toLowerCase();
		if (!term || !albums) return [];
		return albums
			.filter((album) => !memberIds.includes(album.id) && album.title.toLowerCase().includes(term))
			.sort(albumTitleSort)
			.slice(0, 10);
	});

	async function load() {
		if (albums) return;
		const res = await fetch('/api/albums');
		if (res.ok) albums = ((await res.json()) as { albums: AlbumDTO[] }).albums;
	}

	async function toggle(albumId: string) {
		const inAlbum = memberIds.includes(albumId);
		error = '';
		busyAlbumId = albumId;
		const res = await fetch(`/api/albums/${albumId}/items`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(inAlbum ? { remove: [itemId] } : { add: [itemId] })
		});
		busyAlbumId = null;
		if (!res.ok) {
			error = inAlbum ? 'Could not remove from album.' : 'Could not add to album.';
			return;
		}
		memberIds = inAlbum ? memberIds.filter((id) => id !== albumId) : [...memberIds, albumId];
		if (!inAlbum) query = '';
	}

	function albumTitleSort(a: { title: string }, b: { title: string }) {
		return a.title.localeCompare(b.title);
	}
</script>

<details class="albumtoggle" data-testid="album-toggle" ontoggle={load}>
	<summary>Albums{memberIds.length ? ` · ${memberIds.length}` : ''}</summary>
	{#if albums}
		<div class="album-panel">
			<input bind:value={query} placeholder="Search albums" aria-label="Search albums" />

			{#if selectedAlbums.length}
				<div class="selected" aria-label="Selected albums">
					{#each selectedAlbums as album (album.id)}
						<button
							type="button"
							class="album-chip in"
							data-testid={`album-check-${album.id}`}
							disabled={busyAlbumId === album.id}
							onclick={() => void toggle(album.id)}
							aria-label={`Remove ${album.title} from albums`}
						>
							<span>{album.title}</span>
							<em>Remove</em>
						</button>
					{/each}
				</div>
			{/if}

			{#if query.trim()}
				<div class="results" aria-label="Album search results">
					{#each albumMatches as album (album.id)}
						<button
							type="button"
							class="album-chip"
							data-testid={`album-check-${album.id}`}
							disabled={busyAlbumId === album.id}
							onclick={() => void toggle(album.id)}
							aria-label={`Add ${album.title} to albums`}
						>
							<span>{album.title}</span>
							<em>{album.itemCount} {album.itemCount === 1 ? 'moment' : 'moments'}</em>
						</button>
					{:else}
						<p class="none">No matching albums.</p>
					{/each}
				</div>
			{:else if !selectedAlbums.length && albums.length === 0}
				<p class="none">No albums yet. Create one on the Albums page.</p>
			{/if}

			{#if error}
				<p class="err">{error}</p>
			{/if}
		</div>
	{:else}
		<p class="none">Open to load albums.</p>
	{/if}
</details>

<style>
	.albumtoggle {
		border-top: 1px solid color-mix(in srgb, var(--cream) 16%, transparent);
	}

	summary {
		display: flex;
		min-height: 44px;
		align-items: center;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		list-style: none;
		text-transform: uppercase;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.album-panel {
		display: grid;
		gap: 0.55rem;
	}

	input {
		width: 100%;
		min-height: 44px;
		padding: 0.62rem 0.75rem;
		border: 0;
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 1rem;
	}

	.selected,
	.results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.album-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 40px;
		max-width: 100%;
		padding: 0 0.7rem;
		border: 0;
		background: color-mix(in srgb, var(--cream) 11%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-serif);
		font-size: 1rem;
		line-height: 1.1;
		text-align: left;
	}

	.album-chip.in {
		background: color-mix(in srgb, var(--dawn) 82%, var(--cream));
		color: var(--ink);
	}

	.album-chip:disabled {
		cursor: default;
		opacity: 0.58;
	}

	.album-chip span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-chip em {
		flex: none;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		font-style: normal;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.72;
	}

	.none,
	.err {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 15px;
		opacity: 0.7;
	}

	.err {
		color: var(--dawn);
		opacity: 1;
	}
</style>
