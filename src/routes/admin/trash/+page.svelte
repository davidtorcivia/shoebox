<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let confirmText = $state('');
	let emptying = $state(false);

	const total = $derived(
		data.trash.items.length + data.trash.albums.length + data.trash.comments.length
	);
	const sweptTotal = $derived(data.swept.items + data.swept.albums + data.swept.comments);

	async function restore(kind: 'item' | 'album' | 'comment', id: string): Promise<void> {
		await fetch('/api/admin/trash', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'restore', kind, id })
		});
		await invalidateAll();
	}

	async function empty(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		emptying = true;
		try {
			const res = await fetch('/api/admin/trash', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirm: confirmText })
			});
			if (res.ok) {
				confirmText = '';
				await invalidateAll();
			} else {
				alert('Not confirmed.');
			}
		} finally {
			emptying = false;
		}
	}
</script>

<h2>Trash</h2>
<p class="note">
	Deleted things stay here for 30 days, then are removed for good{#if sweptTotal > 0}
		; just swept {sweptTotal}
	{/if}.
</p>

{#if total === 0}
	<p class="empty">The trash is empty.</p>
{:else}
	{#if data.trash.items.length}
		<h3>Items</h3>
		<ul>
			{#each data.trash.items as item (item.id)}
				<li data-testid="trash-item">
					<span>
						{item.title ?? 'Untitled'} / {item.type} / deleted {new Date(
							item.deletedAt
						).toLocaleDateString()}
					</span>
					<button type="button" onclick={() => restore('item', item.id)}>Restore</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.trash.albums.length}
		<h3>Albums</h3>
		<ul>
			{#each data.trash.albums as album (album.id)}
				<li>
					<span>{album.title} / deleted {new Date(album.deletedAt).toLocaleDateString()}</span>
					<button type="button" onclick={() => restore('album', album.id)}>Restore</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.trash.comments.length}
		<h3>Comments</h3>
		<ul>
			{#each data.trash.comments as comment (comment.id)}
				<li>
					<span>
						"{comment.body.slice(0, 80)}" / deleted {new Date(
							comment.deletedAt
						).toLocaleDateString()}
					</span>
					<button type="button" onclick={() => restore('comment', comment.id)}>Restore</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="empty-form" onsubmit={empty}>
		<label for="confirm-empty">
			Type <strong>empty the trash</strong> to delete all {total} things forever
		</label>
		<input id="confirm-empty" bind:value={confirmText} autocomplete="off" />
		<button class="danger" type="submit" disabled={confirmText !== 'empty the trash' || emptying}>
			Empty trash
		</button>
	</form>
{/if}

<style>
	h2 {
		margin: 0 0 8px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	h3 {
		margin: 22px 0 8px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		opacity: 0.5;
		text-transform: uppercase;
	}

	.note,
	.empty {
		font-family: var(--serif);
		font-size: 16px;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		min-height: 48px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-family: var(--serif);
		font-size: 16px;
	}

	button {
		min-height: 48px;
		padding: 0 14px;
		border: 0;
		background: color-mix(in srgb, currentColor 10%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--sans);
		font-size: 13px;
	}

	button:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.empty-form {
		display: flex;
		max-width: 420px;
		flex-direction: column;
		margin-top: 32px;
		gap: 10px;
	}

	label {
		font-family: var(--sans);
		font-size: 13px;
	}

	input {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background: color-mix(in srgb, currentColor 8%, transparent);
		color: inherit;
		font-family: var(--serif);
		font-size: 16px;
	}

	.danger {
		font-weight: 700;
	}

	:is(button, input):focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
