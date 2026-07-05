<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Invites - Shoebox admin</title></svelte:head>

<section class="shell">
	<p class="eyebrow">Admin</p>
	<h1>Invites</h1>

	{#if form && 'message' in form && form.message}<p class="error" role="alert">
			{form.message}
		</p>{/if}

	<form method="POST" action="?/create" class="create">
		<div class="control">
			<label for="role">Role</label>
			<select id="role" name="role" required>
				<option value="user">user</option>
				<option value="uploader">uploader</option>
				<option value="editor">editor</option>
				<option value="admin">admin</option>
			</select>
		</div>
		<div class="control">
			<label for="maxUses">Max uses</label>
			<input id="maxUses" name="maxUses" type="number" min="1" value="1" />
		</div>
		<div class="control">
			<label for="expiresInDays">Expires in days (blank = never)</label>
			<input id="expiresInDays" name="expiresInDays" type="number" min="1" />
		</div>
		<Button>Create invite</Button>
	</form>

	<ul class="invites">
		{#each data.invites as invite (invite.id)}
			<li>
				<code data-testid="invite-url">{data.origin}/invite/{invite.token}</code>
				<span class="meta">
					{invite.role} · {invite.useCount}/{invite.maxUses} used ·
					{invite.expiresAt
						? `expires ${invite.expiresAt.toISOString().slice(0, 10)}`
						: 'no expiry'}
				</span>
				<form method="POST" action="?/revoke">
					<input type="hidden" name="id" value={invite.id} />
					<button type="submit">Revoke</button>
				</form>
			</li>
		{:else}
			<li class="empty">No invites yet.</li>
		{/each}
	</ul>
</section>

<style>
	.shell {
		padding: 8vh 6vw;
		max-width: 56rem;
	}

	.eyebrow {
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 0.72rem;
		opacity: 0.75;
	}

	h1 {
		font-size: clamp(2.5rem, 6vw, 4.5rem);
		font-weight: 600;
		margin-bottom: 1.6rem;
	}

	.error {
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--dawn);
		margin-bottom: 1rem;
	}

	.create {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: flex-end;
		margin-bottom: 2.2rem;
	}

	.control label {
		display: block;
		margin-bottom: 0.4rem;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.72rem;
		opacity: 0.85;
	}

	.control select,
	.control input {
		min-height: 44px;
		padding: 0.5rem 0.7rem;
		border: 0;
		background: rgba(255, 245, 232, 0.14);
		color: inherit;
		font-family: var(--font-serif);
		font-size: 1rem;
	}

	:global(html.light) .control select,
	:global(html.light) .control input {
		background: rgba(23, 20, 18, 0.08);
	}

	.invites {
		list-style: none;
		display: grid;
		gap: 0.9rem;
	}

	.invites li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.9rem;
	}

	.invites code {
		font-size: 0.9rem;
		padding: 0.35rem 0.5rem;
		background: rgba(255, 245, 232, 0.1);
		user-select: all;
	}

	:global(html.light) .invites code {
		background: rgba(23, 20, 18, 0.06);
	}

	.meta {
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.7rem;
		opacity: 0.75;
	}

	.invites button {
		min-height: 44px;
		padding: 0 0.8rem;
		border: 0;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.7rem;
		color: var(--dawn);
	}

	.empty {
		opacity: 0.7;
	}
</style>
