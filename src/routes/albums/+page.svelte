<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { ACCENTS, personRoomFor } from '$lib/ui/tokens';

	let { data } = $props();
	let creating = $state(false);
	let newTitle = $state('');
	let createError = $state('');
	const room = $derived(personRoomFor(data.albums[0]?.createdBy.accentColor ?? ACCENTS[2].hex));

	function fallback(accentColor: string) {
		const stops = personRoomFor(accentColor).stops;
		return `linear-gradient(165deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 135%)`;
	}

	async function createAlbum(event: SubmitEvent) {
		event.preventDefault();
		createError = '';
		const res = await fetch('/api/albums', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: newTitle })
		});
		if (!res.ok) {
			createError = 'Could not create album.';
			return;
		}
		const { album } = (await res.json()) as { album: { id: string } };
		await goto(resolve(`/albums/${album.id}`));
	}
</script>

<svelte:head>
	<title>Albums - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="head">
			<span class="label">Albums</span>
			{#if data.canCreate}
				{#if creating}
					<form class="newform" onsubmit={createAlbum}>
						<input name="title" placeholder="Album title" bind:value={newTitle} required />
						<button type="submit" data-testid="create-album">Create</button>
						<button type="button" onclick={() => (creating = false)}>Cancel</button>
					</form>
					{#if createError}<span class="err">{createError}</span>{/if}
				{:else}
					<button class="new" data-testid="new-album" onclick={() => (creating = true)}>
						New album
					</button>
				{/if}
			{/if}
		</header>

		<div class="grid" data-testid="albums-grid">
			{#each data.albums as album (album.id)}
				<a class="card" href={resolve(`/albums/${album.id}`)} data-testid="album-card">
					<div class="cover">
						{#if album.coverUrl}
							<img src={album.coverUrl} alt={album.title} data-testid="album-cover" />
						{:else}
							<div
								class="fill"
								style:background-image={fallback(album.createdBy.accentColor)}
							></div>
						{/if}
					</div>
					<span class="title">{album.title}</span>
					<span class="count">
						{album.itemCount}
						{album.itemCount === 1 ? 'moment' : 'moments'}
					</span>
				</a>
			{:else}
				<p class="empty">No albums yet.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.page {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.62) 100%);
		color: var(--cream);
	}

	.head {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 38px 30px 0;
	}

	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		opacity: 0.6;
	}

	.new,
	.newform button {
		min-height: 44px;
		border: 0;
		background: none;
		color: var(--dawn);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		padding: 0 12px;
		text-transform: uppercase;
	}

	.newform {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.newform input {
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 17px;
		padding: 10px 14px;
	}

	.err {
		color: var(--dawn);
		font-family: var(--font-sans);
		font-size: 11px;
	}

	.grid {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 26px 18px;
		padding: 26px 30px 60px;
	}

	.card {
		color: var(--cream);
		text-decoration: none;
	}

	.cover {
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	.cover img,
	.fill {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.title {
		display: block;
		margin-top: 10px;
		font-family: var(--font-serif);
		font-size: 21px;
		line-height: 1.2;
	}

	.count,
	.empty {
		display: block;
		margin-top: 4px;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		opacity: 0.6;
		text-transform: uppercase;
	}

	@media (max-width: 640px) {
		.head {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
			padding-inline: 18px;
		}

		.newform {
			align-items: stretch;
			flex-wrap: wrap;
			width: 100%;
		}

		.newform input {
			width: 100%;
		}

		.grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			padding-inline: 18px;
		}
	}
</style>
