<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { yearOf } from '$lib/domain/dates';
	import { eyebrowFor } from '$lib/domain/provenance';
	import type { PlayerAction } from '$lib/ui/player-keys';
	import { isTypingTag, mapPlayerKey } from '$lib/ui/player-keys';
	import { GRAIN_URI, playerRoomFor } from '$lib/ui/tokens';
	import AlbumToggle from '$lib/ui/AlbumToggle.svelte';
	import Comments from '$lib/ui/Comments.svelte';
	import Lightbox from '$lib/ui/Lightbox.svelte';
	import MetaForm, { type MetaPatchPayload } from '$lib/ui/MetaForm.svelte';
	import PeopleRow from '$lib/ui/PeopleRow.svelte';
	import Player from '$lib/ui/Player.svelte';
	import TagsRow from '$lib/ui/TagsRow.svelte';
	import type { ItemDTO } from '$lib/dto';
	import type { PageData } from './$types';

	type PlayerHandle = {
		handleAction: (action: PlayerAction) => void;
		isPaused: () => boolean;
	};

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let item = $state<ItemDTO>(data.item);
	// svelte-ignore state_referenced_locally
	let loadedItemId = $state(data.item.id);
	let player = $state<PlayerHandle | null>(null);
	let saveState = $state('');

	const year = $derived(yearOf(item.date));
	const roomYear = $derived(year ?? data.backYear ?? new Date().getFullYear());
	const room = $derived(playerRoomFor(roomYear));
	const backLabel = $derived(data.backYear ?? year ?? 'Timeline');
	const title = $derived(item.title ?? item.displayDate);
	const mediaSrc = $derived(item.urls.original ?? item.urls.thumb1600 ?? item.urls.poster);
	const poster = $derived(item.urls.poster || item.urls.thumb800 || item.urls.thumb1600);

	$effect(() => {
		if (data.item.id === loadedItemId) return;
		loadedItemId = data.item.id;
		item = data.item;
		saveState = '';
	});

	function navigateTo(id: string | null) {
		if (!id) return;
		void goto(resolve(`/item/${id}${data.contextQuery ? `?${data.contextQuery}` : ''}`));
	}

	function handleRoomAction(action: PlayerAction) {
		if (
			action.type === 'toggle-play' ||
			action.type === 'shuttle' ||
			action.type === 'seek-by' ||
			action.type === 'step' ||
			action.type === 'fullscreen' ||
			action.type === 'mute'
		) {
			player?.handleAction(action);
		} else if (action.type === 'prev-item') {
			navigateTo(data.neighbors.prevId);
		} else if (action.type === 'next-item') {
			navigateTo(data.neighbors.nextId);
		} else if (action.type === 'close') {
			void goto(data.backYear ? resolve(`/?y=${data.backYear}`) : resolve('/'));
		}
	}

	async function save(payload: MetaPatchPayload) {
		saveState = 'Saving';
		const res = await fetch(`/api/items/${item.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			saveState = 'Could not save';
			return;
		}
		const body = (await res.json()) as { item: ItemDTO };
		item = body.item;
		saveState = 'Saved';
	}
</script>

<svelte:head>
	<title>{title} · Shoebox</title>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && isTypingTag(target.tagName, target.isContentEditable)) return;
		const action = mapPlayerKey(event.key, {
			paused: player?.isPaused() ?? true,
			isVideo: item.type === 'video'
		});
		if (!action) return;
		event.preventDefault();
		handleRoomAction(action);
	}}
/>

<section
	class="item-room"
	style={`--stop-0: ${room.stops[0]}; --stop-1: ${room.stops[1]}; --stop-2: ${room.stops[2]}; --pool: ${room.pool}; --grain: url("${GRAIN_URI}")`}
>
	<header class="topbar">
		<a href={data.backYear ? resolve(`/?y=${data.backYear}`) : resolve('/')}
			>← Back to {backLabel}</a
		>
		<h1>{title}</h1>
		<a href={data.backYear ? resolve(`/?y=${data.backYear}`) : resolve('/')} aria-label="Close"
			>✕ Close</a
		>
	</header>

	<div class="room-grid">
		<div class="stage-column">
			<div class="stage">
				{#if item.type === 'video'}
					<Player
						bind:this={player}
						src={mediaSrc}
						{poster}
						duration={item.duration}
						title={item.title ?? item.displayDate}
					/>
				{:else}
					<Lightbox src={mediaSrc} alt={item.title ?? item.displayDate} />
				{/if}

				<button
					class="edge prev"
					type="button"
					disabled={!data.neighbors.prevId}
					aria-label="Previous item"
					onclick={() => navigateTo(data.neighbors.prevId)}>↑</button
				>
				<button
					class="edge next"
					type="button"
					disabled={!data.neighbors.nextId}
					aria-label="Next item"
					onclick={() => navigateTo(data.neighbors.nextId)}>↓</button
				>
			</div>

			<div class="social">
				<PeopleRow people={item.people} />
				<TagsRow tags={item.tags} albums={item.albums} />
			</div>
		</div>

		<aside class="rail">
			<p class="eyebrow">{eyebrowFor(item.date, data.source, item.tapeLabel)} · {item.type}</p>
			<p class="date">{item.displayDate}</p>
			{#if item.tapeLabel}
				<p class="tape">{item.tapeLabel}</p>
			{/if}
			{#if item.description}
				<p class="story">{item.description}</p>
			{/if}

			<div data-testid="comments-slot">
				<Comments itemId={item.id} currentUser={data.me} />
			</div>

			{#if data.canEdit}
				<details class="edit">
					<summary>Edit metadata</summary>
					<MetaForm {item} onsubmit={(payload) => void save(payload)} />
					<AlbumToggle itemId={item.id} memberships={item.albums} />
					{#if saveState}
						<p class="save-state">{saveState}</p>
					{/if}
				</details>
			{/if}
		</aside>
	</div>
</section>

<style>
	.item-room {
		min-height: 100svh;
		padding: clamp(1rem, 2vw, 2rem);
		color: var(--cream);
		background-image:
			var(--grain), radial-gradient(80% 60% at 100% 0%, var(--pool) 0%, transparent 60%),
			linear-gradient(160deg, var(--stop-0) 0%, var(--stop-1) 55%, var(--stop-2) 100%);
		background-blend-mode: overlay, normal, normal;
	}

	.topbar {
		display: grid;
		grid-template-columns: 1fr minmax(12rem, 40rem) 1fr;
		gap: 1rem;
		align-items: center;
		margin-bottom: clamp(1.5rem, 5vw, 4rem);
	}

	.topbar a {
		font-family: var(--font-sans);
		font-size: 0.75rem;
		letter-spacing: 0.13em;
		color: var(--cream);
		text-decoration: none;
		text-transform: uppercase;
		opacity: 0.82;
	}

	.topbar a:last-child {
		text-align: right;
	}

	h1 {
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: clamp(1.4rem, 3vw, 2.8rem);
		font-weight: 460;
		line-height: 1.05;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.room-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
		gap: clamp(1.5rem, 4vw, 4rem);
		align-items: start;
		width: min(100%, 92rem);
		margin: 0 auto;
	}

	.stage {
		position: relative;
	}

	.social {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.4rem;
	}

	.edge {
		position: absolute;
		top: 42%;
		width: 44px;
		height: 44px;
		padding: 0;
		font-family: var(--font-serif);
		font-size: 2.4rem;
		line-height: 1;
		color: var(--cream);
		cursor: pointer;
		background: transparent;
		border: 0;
		transform: translateY(-50%);
	}

	.edge:disabled {
		cursor: default;
		opacity: 0.2;
	}

	.prev {
		left: -3.2rem;
	}

	.next {
		right: -3.2rem;
	}

	.rail {
		display: grid;
		gap: 1rem;
		color: var(--cream);
	}

	.eyebrow,
	.tape,
	.save-state,
	summary {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.date {
		font-family: var(--font-serif);
		font-size: clamp(2rem, 5vw, 4.4rem);
		font-weight: 460;
		line-height: 0.95;
	}

	.story {
		max-width: 34rem;
		font-family: var(--font-serif);
		font-size: 1.08rem;
		line-height: 1.5;
	}

	[data-testid='comments-slot'] {
		min-height: 5rem;
		border-top: 1px solid color-mix(in srgb, var(--cream) 24%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--cream) 16%, transparent);
	}

	.edit {
		margin-top: 0.5rem;
	}

	summary {
		min-height: 44px;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.topbar {
			grid-template-columns: 1fr auto;
		}

		.topbar h1 {
			grid-column: 1 / -1;
			grid-row: 2;
			text-align: left;
		}

		.room-grid {
			grid-template-columns: 1fr;
		}

		.edge {
			top: auto;
			bottom: -3.7rem;
		}

		.prev {
			left: 0;
		}

		.next {
			right: 0;
		}

		.social {
			margin-top: 4rem;
		}
	}
</style>
