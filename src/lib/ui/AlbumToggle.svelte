<script lang="ts">
	import type { AlbumDTO } from '$lib/domain/album-dto';

	let { itemId, memberships }: { itemId: string; memberships: { id: string; title: string }[] } =
		$props();

	let loadedItemId = $state('');
	let albums = $state<AlbumDTO[] | null>(null);
	let member = $state<Set<string>>(new Set());

	$effect(() => {
		if (loadedItemId === itemId) return;
		loadedItemId = itemId;
		albums = null;
		member = new Set(memberships.map((membership) => membership.id));
	});

	async function load() {
		if (albums) return;
		const res = await fetch('/api/albums');
		if (res.ok) albums = ((await res.json()) as { albums: AlbumDTO[] }).albums;
	}

	async function toggle(albumId: string) {
		const inAlbum = member.has(albumId);
		const res = await fetch(`/api/albums/${albumId}/items`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(inAlbum ? { remove: [itemId] } : { add: [itemId] })
		});
		if (!res.ok) return;
		const next = new Set(member);
		if (inAlbum) next.delete(albumId);
		else next.add(albumId);
		member = next;
	}
</script>

<details class="albumtoggle" data-testid="album-toggle" ontoggle={load}>
	<summary>Albums{member.size ? ` · ${member.size}` : ''}</summary>
	{#if albums}
		<ul>
			{#each albums as album (album.id)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={member.has(album.id)}
							data-testid={`album-check-${album.id}`}
							onchange={() => toggle(album.id)}
						/>
						<span>{album.title}</span>
					</label>
				</li>
			{:else}
				<li class="none">No albums yet. Create one on the Albums page.</li>
			{/each}
		</ul>
	{/if}
</details>

<style>
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

	ul {
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}

	li label {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		font-family: var(--font-serif);
		font-size: 16px;
	}

	input {
		width: 18px;
		height: 18px;
		accent-color: var(--dawn);
	}

	.none {
		padding: 8px 0;
		font-family: var(--font-serif);
		font-size: 15px;
		opacity: 0.7;
	}
</style>
