<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let role = $state<'admin' | 'editor' | 'uploader' | 'user'>('user');
	let expiry = $state<'never' | '7d' | '30d'>('7d');
	let maxUses = $state(1);
	let copied = $state('');

	const canMintAdmin = $derived(data.user.role === 'owner');

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const expiresInDays = expiry === 'never' ? undefined : expiry === '7d' ? 7 : 30;
		const res = await fetch('/api/invites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ role, expiresInDays, maxUses })
		});
		if (res.ok) await invalidateAll();
		else alert('Could not create the invite.');
	}

	async function revoke(id: string): Promise<void> {
		await fetch(`/api/invites/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	async function copy(token: string): Promise<void> {
		await navigator.clipboard.writeText(new URL(`/invite/${token}`, location.origin).href);
		copied = token;
		setTimeout(() => (copied = ''), 1500);
	}
</script>

<h2>Invites</h2>
<form onsubmit={create}>
	<label>
		<span>Role</span>
		<select bind:value={role}>
			<option value="user">user</option>
			<option value="uploader">uploader</option>
			<option value="editor">editor</option>
			{#if canMintAdmin}<option value="admin">admin</option>{/if}
		</select>
	</label>
	<label>
		<span>Expires</span>
		<select bind:value={expiry}>
			<option value="7d">In 7 days</option>
			<option value="30d">In 30 days</option>
			<option value="never">Never</option>
		</select>
	</label>
	<label>
		<span>Max uses</span>
		<input type="number" min="1" max="100" bind:value={maxUses} />
	</label>
	<button type="submit">Create invite</button>
</form>

<table>
	<thead>
		<tr>
			<th>Link</th>
			<th>Role</th>
			<th>Usage</th>
			<th>Expires</th>
			<th></th>
		</tr>
	</thead>
	<tbody>
		{#each data.invites as invite (invite.id)}
			<tr>
				<td>
					<button type="button" onclick={() => copy(invite.token)}>
						{copied === invite.token ? 'Copied' : 'Copy link'}
					</button>
				</td>
				<td>{invite.role}</td>
				<td>{invite.useCount} / {invite.maxUses}</td>
				<td>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'never'}</td>
				<td><button type="button" onclick={() => revoke(invite.id)}>Revoke</button></td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	h2 {
		margin: 0 0 16px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		margin-bottom: 26px;
		gap: 14px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	select,
	input,
	button {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background: color-mix(in srgb, currentColor 10%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--sans);
		font-size: 14px;
	}

	input[type='number'] {
		width: 90px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		padding-right: 12px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		opacity: var(--chrome-opacity, 0.5);
		text-align: left;
		text-transform: uppercase;
	}

	td {
		padding: 6px 12px 6px 0;
		font-family: var(--serif);
		font-size: 16px;
	}

	:is(select, input, button):focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
