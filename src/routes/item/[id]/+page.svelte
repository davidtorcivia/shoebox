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
	import FaceBoxes from '$lib/ui/FaceBoxes.svelte';
	import Lightbox from '$lib/ui/Lightbox.svelte';
	import MetaForm, { type MetaPatchPayload } from '$lib/ui/MetaForm.svelte';
	import PeopleRow from '$lib/ui/PeopleRow.svelte';
	import Player from '$lib/ui/Player.svelte';
	import ShareDialog from '$lib/ui/ShareDialog.svelte';
	import TagsRow from '$lib/ui/TagsRow.svelte';
	import ThumbnailPicker from '$lib/ui/ThumbnailPicker.svelte';
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
	let shareOpen = $state(false);
	let thumbPickerOpen = $state(false);
	let thumbState = $state('');
	let savingThumb = $state(false);
	let confirmingDelete = $state(false);
	let deleteState = $state('');
	// svelte-ignore state_referenced_locally
	let facesVisible = $state(data.item.type === 'photo' && data.faces.length > 0);

	const year = $derived(yearOf(item.date));
	const roomYear = $derived(year ?? data.backYear ?? new Date().getFullYear());
	const room = $derived(playerRoomFor(roomYear));
	const backLabel = $derived(data.backYear ?? year ?? 'Timeline');
	const title = $derived(item.title);
	const pageTitle = $derived(item.title ?? item.displayDate);
	const mediaSrc = $derived(
		item.urls.playback ?? item.urls.original ?? item.urls.thumb1600 ?? item.urls.poster
	);
	const poster = $derived(item.urls.poster || item.urls.thumb800 || item.urls.thumb1600);
	const hasKnownDate = $derived(item.date.precision !== 'unknown');
	// Faces move frame-to-frame in video, so overlay boxes are meaningless there.
	// Collapse them to a de-duplicated list of the people detected in the clip.
	const videoFacePeople = $derived(
		item.type === 'video'
			? Array.from(new Map(data.faces.map((f) => [f.person.id, f.person])).values())
			: []
	);

	$effect(() => {
		if (data.item.id === loadedItemId) return;
		loadedItemId = data.item.id;
		item = data.item;
		saveState = '';
		facesVisible = data.item.type === 'photo' && data.faces.length > 0;
	});

	function navigateTo(id: string | null) {
		if (!id) return;
		void goto(resolve(`/item/${id}${data.contextQuery ? `?${data.contextQuery}` : ''}`));
	}

	// Touch swipe to move between items (replaces the on-screen arrows on mobile).
	let swipeX = 0;
	let swipeY = 0;

	function onStagePointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse') return;
		swipeX = event.clientX;
		swipeY = event.clientY;
	}

	function onStagePointerUp(event: PointerEvent) {
		if (event.pointerType === 'mouse') return;
		const dx = event.clientX - swipeX;
		const dy = event.clientY - swipeY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
			navigateTo(dx < 0 ? data.neighbors.nextId : data.neighbors.prevId);
		}
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

	async function chooseThumbnail(posterTime: number) {
		savingThumb = true;
		thumbState = '';
		const res = await fetch(`/api/items/${item.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'setPoster', posterTime })
		});
		savingThumb = false;
		if (!res.ok) {
			thumbState = 'Could not update thumbnail';
			return;
		}
		const body = (await res.json()) as { item: ItemDTO };
		item = body.item;
		thumbPickerOpen = false;
		// The poster is regenerated inline and the URL is cache-busted, so the new
		// frame shows immediately.
		thumbState = 'Thumbnail updated.';
	}

	async function deleteMedia() {
		deleteState = 'Deleting';
		const res = await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
		if (!res.ok) {
			deleteState = 'Could not delete';
			confirmingDelete = false;
			return;
		}
		void goto(data.backYear ? resolve(`/?y=${data.backYear}`) : resolve('/'));
	}
</script>

<svelte:head>
	<title>{pageTitle} · Shoebox</title>
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
		{#if title}
			<h1>{title}</h1>
		{:else}
			<span class="topbar-spacer" aria-hidden="true"></span>
		{/if}
		<span class="topbar-spacer" aria-hidden="true"></span>
	</header>

	<div class="room-grid">
		<div class="stage-column">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="stage" onpointerdown={onStagePointerDown} onpointerup={onStagePointerUp}>
				<div class="media-frame">
					{#if item.type === 'video'}
						<Player bind:this={player} src={mediaSrc} {poster} duration={item.duration} {title} />
					{:else}
						<Lightbox src={mediaSrc} alt={item.title ?? 'Photo'} />
					{/if}
					{#if facesVisible && item.type === 'photo' && data.faces.length > 0}
						<FaceBoxes faces={data.faces} />
					{/if}
				</div>

				<button
					class="edge prev"
					type="button"
					disabled={!data.neighbors.prevId}
					aria-label="Previous item"
					onclick={() => navigateTo(data.neighbors.prevId)}>‹</button
				>
				<button
					class="edge next"
					type="button"
					disabled={!data.neighbors.nextId}
					aria-label="Next item"
					onclick={() => navigateTo(data.neighbors.nextId)}>›</button
				>
			</div>

			<div class="social">
				<PeopleRow people={item.people} />
				<TagsRow tags={item.tags} albums={item.albums} />
			</div>
		</div>

		<aside class="rail">
			<p class="eyebrow">{eyebrowFor(item.date, null)}</p>
			{#if hasKnownDate}
				<p class="date">{item.displayDate}</p>
			{/if}
			{#if item.description}
				<p class="story">{item.description}</p>
			{/if}

			{#if item.type === 'video' && videoFacePeople.length > 0}
				<div class="faces-note" data-testid="faces-in-video">
					<span class="faces-note-label">In this video</span>
					<span class="faces-note-people">
						{#each videoFacePeople as person (person.id)}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- person slug is dynamic -->
							<a href={`/people/${person.slug}`} style:--accent={person.accentColor}
								>{person.name}</a
							>
						{/each}
					</span>
				</div>
			{/if}

			<div class="rail-actions">
				{#if item.urls.original}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- storage adapters return media URLs, not app routes -->
					<a
						class="download-original"
						data-testid="download-original"
						href={item.urls.original}
						download>Download original</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
				{#if data.canShare}
					<button
						class="share-action"
						data-testid="share-button"
						onclick={() => (shareOpen = true)}
					>
						Share
					</button>
					<ShareDialog
						targetType="item"
						targetId={item.id}
						open={shareOpen}
						onClose={() => (shareOpen = false)}
					/>
				{/if}
				{#if data.facesEnabled && item.type === 'photo' && data.faces.length > 0}
					<button
						class="face-toggle"
						type="button"
						aria-pressed={facesVisible}
						onclick={() => (facesVisible = !facesVisible)}
					>
						Faces
					</button>
				{/if}
				{#if data.canDelete}
					{#if confirmingDelete}
						<button
							class="delete-action confirm"
							type="button"
							data-testid="delete-confirm"
							onclick={() => void deleteMedia()}
						>
							Confirm delete
						</button>
						<button class="delete-action" type="button" onclick={() => (confirmingDelete = false)}>
							Cancel
						</button>
					{:else}
						<button
							class="delete-action"
							type="button"
							data-testid="delete-button"
							onclick={() => (confirmingDelete = true)}
						>
							Delete
						</button>
					{/if}
					{#if deleteState}
						<span class="delete-state" role="status">{deleteState}</span>
					{/if}
				{/if}
			</div>

			<div data-testid="comments-slot">
				<Comments itemId={item.id} currentUser={data.me} />
			</div>

			{#if data.canEdit}
				<details class="edit">
					<summary>Edit metadata</summary>
					<MetaForm
						{item}
						people={data.people}
						canCreatePeople={data.canCreatePeople}
						onsubmit={(payload) => void save(payload)}
					/>
					<AlbumToggle itemId={item.id} memberships={item.albums} />
					{#if item.type === 'video' && item.urls.sprite}
						<div class="thumb-picker">
							<button
								class="thumb-action"
								type="button"
								data-testid="choose-thumbnail"
								onclick={() => (thumbPickerOpen = true)}
							>
								Choose thumbnail
							</button>
							<ThumbnailPicker
								open={thumbPickerOpen}
								spriteUrl={item.urls.sprite}
								duration={item.duration}
								currentPosterTime={item.posterTime ?? null}
								saving={savingThumb}
								onClose={() => (thumbPickerOpen = false)}
								onChoose={(time) => void chooseThumbnail(time)}
							/>
							{#if thumbState}
								<span class="thumb-state" role="status">{thumbState}</span>
							{/if}
						</div>
					{/if}
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
		margin-top: -56px;
		/* Starts at the viewport top (pulled up under the nav by the negative
		   margin), so it must be a full 100svh tall to reach the bottom — the
		   earlier `- 56px` left a dark body-coloured strip at the bottom edge. */
		min-height: 100svh;
		padding: calc(56px + clamp(1rem, 2vw, 2rem)) clamp(1rem, 2vw, 2rem) clamp(1rem, 2vw, 2rem);
		color: var(--cream);
		background-image:
			var(--grain),
			linear-gradient(
				90deg,
				rgb(23 20 18 / 0.62) 0%,
				rgb(23 20 18 / 0.16) 46%,
				rgb(23 20 18 / 0.52) 100%
			),
			linear-gradient(180deg, rgb(23 20 18 / 0.24) 0%, rgb(23 20 18 / 0.48) 100%),
			radial-gradient(80% 60% at 100% 0%, var(--pool) 0%, transparent 60%),
			linear-gradient(160deg, var(--stop-0) 0%, var(--stop-1) 55%, var(--stop-2) 100%);
		background-blend-mode: overlay, normal, normal, normal, normal;
	}

	.topbar {
		display: grid;
		grid-template-columns: 1fr minmax(12rem, 40rem) 1fr;
		gap: 1rem;
		align-items: center;
		margin-bottom: clamp(1.5rem, 5vw, 4rem);
	}

	.topbar-spacer {
		min-height: 1px;
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
		/* Room for descenders (y, g, p): overflow:hidden clips the horizontal
		   ellipsis, but a tight line-height would also crop the bottoms of glyphs. */
		line-height: 1.3;
		padding-bottom: 0.1em;
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

	.media-frame {
		position: relative;
		display: grid;
		align-items: start;
		max-height: min(72svh, calc(100svh - 220px));
	}

	.social {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.4rem;
	}

	.edge {
		position: absolute;
		top: 42%;
		z-index: 2;
		width: 48px;
		height: 48px;
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
		left: 0.75rem;
	}

	.next {
		right: 0.75rem;
	}

	.rail {
		display: grid;
		gap: 1rem;
		color: var(--cream);
	}

	.eyebrow,
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

	.rail-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}

	.faces-note {
		display: grid;
		gap: 0.5rem;
	}

	.faces-note-label {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.faces-note-people {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.9rem;
		font-family: var(--font-serif);
		font-size: 1.02rem;
	}

	.faces-note-people a {
		color: var(--cream);
		text-decoration: underline;
		text-decoration-color: var(--accent, var(--dawn));
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
	}

	.download-original,
	.share-action,
	.thumb-action,
	.face-toggle,
	.delete-action {
		min-height: 48px;
		border: 0;
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		line-height: 48px;
		text-decoration: none;
		text-transform: uppercase;
	}

	.delete-action {
		opacity: 0.7;
	}

	.delete-action.confirm {
		color: var(--dawn);
		font-weight: 800;
		opacity: 1;
	}

	.delete-state,
	.thumb-state {
		align-self: center;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.7;
	}

	.face-toggle[aria-pressed='true'] {
		font-weight: 800;
		text-decoration: underline;
		text-underline-offset: 5px;
	}

	[data-testid='comments-slot'] {
		min-height: 5rem;
		border-top: 1px solid color-mix(in srgb, var(--cream) 24%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--cream) 16%, transparent);
	}

	.edit {
		margin-top: 0.5rem;
	}

	.thumb-picker {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}

	.thumb-picker .thumb-action {
		min-height: 40px;
		padding: 0 16px;
		border: 1px solid color-mix(in srgb, var(--cream) 32%, transparent);
		background: color-mix(in srgb, var(--cream) 6%, transparent);
		line-height: normal;
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

		/* Arrows give way to swipe navigation on touch screens. */
		.edge {
			display: none;
		}

		.social {
			margin-top: 1.4rem;
		}
	}
</style>
