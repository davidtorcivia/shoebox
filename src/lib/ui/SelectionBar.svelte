<script lang="ts">
	import { CREAM, DAWN, FONT, INK } from '$lib/ui/tokens';

	interface AlbumOption {
		id: string;
		title: string;
	}

	let {
		selectedIds,
		canDelete = false,
		onexit,
		ondeleted
	}: {
		selectedIds: string[];
		canDelete?: boolean;
		onexit: () => void;
		ondeleted: (ids: string[]) => void;
	} = $props();

	let mode = $state<'idle' | 'album' | 'confirmDelete'>('idle');
	let albums = $state<AlbumOption[]>([]);
	let albumsLoaded = $state(false);
	let query = $state('');
	let busy = $state(false);
	let notice = $state('');

	const count = $derived(selectedIds.length);
	const trimmed = $derived(query.trim());
	const matches = $derived(
		trimmed
			? albums.filter((album) => album.title.toLowerCase().includes(trimmed.toLowerCase()))
			: albums.slice(0, 8)
	);
	const exactExists = $derived(
		albums.some((album) => album.title.toLowerCase() === trimmed.toLowerCase())
	);

	async function openAlbumPicker(): Promise<void> {
		mode = 'album';
		notice = '';
		if (albumsLoaded) return;
		const res = await fetch('/api/albums');
		if (res.ok) {
			albums = ((await res.json()) as { albums: AlbumOption[] }).albums;
			albumsLoaded = true;
		}
	}

	async function addToAlbum(albumId: string): Promise<void> {
		busy = true;
		notice = '';
		const res = await fetch(`/api/albums/${albumId}/items`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ add: selectedIds })
		});
		busy = false;
		if (!res.ok) {
			notice = 'Could not add to album.';
			return;
		}
		onexit();
	}

	async function createAndAdd(): Promise<void> {
		if (!trimmed) return;
		busy = true;
		notice = '';
		const res = await fetch('/api/albums', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: trimmed })
		});
		if (!res.ok) {
			busy = false;
			notice = 'Could not create album.';
			return;
		}
		const { album } = (await res.json()) as { album: { id: string } };
		await addToAlbum(album.id);
	}

	async function confirmDelete(): Promise<void> {
		busy = true;
		notice = '';
		const deleted: string[] = [];
		for (const id of selectedIds) {
			const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
			if (res.ok) deleted.push(id);
		}
		busy = false;
		if (deleted.length > 0) ondeleted(deleted);
		if (deleted.length < selectedIds.length) {
			notice = `Deleted ${deleted.length} of ${selectedIds.length}.`;
			mode = 'idle';
		} else {
			onexit();
		}
	}
</script>

<div
	class="bar"
	role="dialog"
	aria-label="Selection actions"
	style:--cream={CREAM}
	style:--ink={INK}
	style:--dawn={DAWN}
	style:--sans={FONT.sans}
>
	<span class="count" data-testid="selection-count">{count} selected</span>

	{#if mode === 'album'}
		<div class="album-picker">
			<input
				bind:value={query}
				placeholder="Search or name a new album…"
				aria-label="Album name"
				autocomplete="off"
			/>
			<div class="album-list">
				{#each matches as album (album.id)}
					<button type="button" disabled={busy} onclick={() => void addToAlbum(album.id)}>
						{album.title}
					</button>
				{/each}
				{#if trimmed && !exactExists}
					<button
						type="button"
						class="create"
						disabled={busy}
						data-testid="create-album"
						onclick={() => void createAndAdd()}
					>
						Create “{trimmed}”
					</button>
				{:else if matches.length === 0}
					<span class="hint">No albums yet — type a name to create one.</span>
				{/if}
			</div>
			<button type="button" class="ghost" onclick={() => (mode = 'idle')}>Back</button>
		</div>
	{:else if mode === 'confirmDelete'}
		<div class="confirm">
			<span>Delete {count} {count === 1 ? 'item' : 'items'}? This moves them to the trash.</span>
			<button
				type="button"
				class="danger"
				disabled={busy}
				data-testid="confirm-delete"
				onclick={() => void confirmDelete()}>Delete</button
			>
			<button type="button" class="ghost" onclick={() => (mode = 'idle')}>Keep</button>
		</div>
	{:else}
		<div class="actions">
			<button type="button" class="primary" onclick={() => void openAlbumPicker()}
				>Add to album</button
			>
			{#if canDelete}
				<button type="button" class="danger" onclick={() => (mode = 'confirmDelete')}>Delete</button
				>
			{/if}
			<button type="button" class="ghost" data-testid="selection-cancel" onclick={onexit}
				>Cancel</button
			>
		</div>
	{/if}

	{#if notice}<span class="notice">{notice}</span>{/if}
</div>

<style>
	.bar {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		z-index: 30;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		max-width: min(680px, calc(100% - 1.5rem));
		padding: 12px 16px;
		background: color-mix(in srgb, var(--ink) 94%, transparent);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--cream) 12%, transparent),
			0 16px 44px rgb(0 0 0 / 0.5);
		color: var(--cream);
		transform: translateX(-50%);
	}

	/* Ethereal chrome: faintly translucent ink over a soft blur, matching the
	   dialogs. The near-opaque background above is the no-backdrop fallback. */
	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.bar {
			background: color-mix(in srgb, var(--ink) 76%, transparent);
			backdrop-filter: blur(10px) saturate(1.25);
			-webkit-backdrop-filter: blur(10px) saturate(1.25);
		}
	}

	.count {
		font-family: var(--sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.actions,
	.confirm,
	.album-picker {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.confirm span {
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.04em;
	}

	button {
		min-height: 40px;
		padding: 0 14px;
		border: 1px solid color-mix(in srgb, var(--cream) 28%, transparent);
		background: color-mix(in srgb, var(--cream) 8%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.primary {
		border-color: transparent;
		background: var(--dawn);
		color: var(--ink);
		font-weight: 700;
	}

	.danger {
		border-color: color-mix(in srgb, #da5b45 60%, transparent);
		color: #ffb9ab;
	}

	.ghost {
		border-color: transparent;
		background: none;
	}

	.album-picker {
		flex-direction: column;
		align-items: stretch;
		width: min(360px, 72vw);
	}

	.album-picker input {
		min-height: 40px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--font-serif, serif);
		font-size: 15px;
		padding: 8px 12px;
	}

	.album-list {
		display: flex;
		flex-direction: column;
		max-height: 40vh;
		overflow-y: auto;
		gap: 4px;
	}

	.album-list button {
		justify-content: flex-start;
		border: 0;
		background: none;
		text-align: left;
		text-transform: none;
		letter-spacing: 0;
		font-size: 14px;
	}

	.album-list button:hover {
		background: color-mix(in srgb, var(--cream) 12%, transparent);
	}

	.album-list .create {
		color: var(--dawn);
		font-weight: 700;
	}

	.hint {
		padding: 6px 4px;
		font-family: var(--sans);
		font-size: 11px;
		opacity: 0.7;
	}

	.notice {
		font-family: var(--sans);
		font-size: 11px;
		color: var(--dawn);
	}
</style>
