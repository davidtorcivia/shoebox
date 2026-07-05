<script lang="ts">
	import type { Role } from '$lib/server/roles';
	import CommentList, { type CommentView } from './CommentList.svelte';

	let { itemId, currentUser }: { itemId: string; currentUser: { id: string; role: Role } | null } =
		$props();

	let loadedItemId = $state('');
	let comments = $state<CommentView[]>([]);
	let body = $state('');
	let error = $state('');
	let loading = $state(false);

	$effect(() => {
		if (loadedItemId === itemId) return;
		loadedItemId = itemId;
		comments = [];
		body = '';
		error = '';
		void load();
	});

	async function load() {
		loading = true;
		const res = await fetch(`/api/items/${itemId}/comments`);
		loading = false;
		if (!res.ok) {
			error = 'Could not load memories.';
			return;
		}
		comments = ((await res.json()) as { comments: CommentView[] }).comments;
	}

	function canDelete(comment: CommentView): boolean {
		if (!currentUser) return false;
		if (comment.canDelete !== undefined) return comment.canDelete;
		return (
			comment.user.id === currentUser.id || ['editor', 'admin', 'owner'].includes(currentUser.role)
		);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const res = await fetch(`/api/items/${itemId}/comments`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ body })
		});
		if (!res.ok) {
			error = 'Could not add memory.';
			return;
		}
		const { comment } = (await res.json()) as { comment: CommentView };
		comments = [...comments, comment];
		body = '';
	}

	async function remove(id: string) {
		error = '';
		const res = await fetch(`/api/items/${itemId}/comments/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			error = 'Could not delete memory.';
			return;
		}
		comments = comments.filter((comment) => comment.id !== id);
	}
</script>

<section class="memories" data-testid="comments">
	<div class="label">Memories</div>
	{#if loading}
		<p class="hint">Loading memories.</p>
	{:else if comments.length}
		<CommentList {comments} {canDelete} ondelete={remove} />
	{:else}
		<p class="hint">No memories yet.</p>
	{/if}
	<form onsubmit={submit}>
		<textarea bind:value={body} placeholder="Add a memory…" rows="3" maxlength="2000"></textarea>
		<div class="actions">
			<button type="submit" disabled={!body.trim()}>Add memory</button>
			{#if error}<span class="err">{error}</span>{/if}
		</div>
	</form>
</section>

<style>
	.memories {
		display: grid;
		gap: 14px;
		padding: 18px 0;
	}

	.label {
		color: color-mix(in srgb, var(--cream) 56%, transparent);
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	.hint {
		margin: 0;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		font-family: var(--font-serif);
		font-size: 15px;
	}

	form {
		display: grid;
		gap: 10px;
	}

	textarea {
		width: 100%;
		min-height: 96px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.5;
		padding: 12px 14px;
		resize: vertical;
	}

	textarea::placeholder {
		color: color-mix(in srgb, var(--cream) 48%, transparent);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}

	button {
		min-height: 44px;
		border: 0;
		background: var(--dawn);
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		padding: 0 18px;
		text-transform: uppercase;
	}

	button:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.err {
		color: var(--dawn);
		font-family: var(--font-sans);
		font-size: 11px;
	}
</style>
