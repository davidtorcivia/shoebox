<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let tempPasswords = $state<Record<string, string>>({});
	let confirmingDelete = $state<string | null>(null);

	const isOwner = $derived(data.user.role === 'owner');
	const assignable = ['user', 'uploader', 'editor', 'admin'] as const;

	async function patch(id: string, body: Record<string, unknown>): Promise<void> {
		const res = await fetch(`/api/admin/users/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			alert('That change was not allowed.');
			return;
		}
		const out = (await res.json()) as { tempPassword?: string };
		if (out.tempPassword) tempPasswords = { ...tempPasswords, [id]: out.tempPassword };
		await invalidateAll();
	}

	async function remove(id: string): Promise<void> {
		const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
		confirmingDelete = null;
		if (res.ok) await invalidateAll();
		else alert('Delete failed.');
	}

	function roleOptions(row: PageData['users'][number]) {
		return assignable.filter((role) => (role === 'admin' || row.role === 'admin' ? isOwner : true));
	}
</script>

<h2>Users</h2>
<table>
	<thead>
		<tr>
			<th>Username</th>
			<th>Role</th>
			<th>Linked person</th>
			<th>Actions</th>
		</tr>
	</thead>
	<tbody>
		{#each data.users as user (user.id)}
			<tr>
				<td class="name" style:--accent={user.accentColor}>{user.username}</td>
				<td>
					{#if user.role === 'owner'}
						<span class="owner-badge">Owner</span>
					{:else}
						<select
							aria-label={`Role for ${user.username}`}
							value={user.role}
							disabled={user.role === 'admin' && !isOwner}
							onchange={(event) => patch(user.id, { role: event.currentTarget.value })}
						>
							{#each roleOptions(user) as role (role)}
								<option value={role}>{role}</option>
							{/each}
						</select>
					{/if}
				</td>
				<td>
					<select
						aria-label={`Linked person for ${user.username}`}
						value={user.personId ?? ''}
						onchange={(event) => patch(user.id, { personId: event.currentTarget.value || null })}
					>
						<option value="">none</option>
						{#each data.people as person (person.id)}
							<option value={person.id}>{person.name}</option>
						{/each}
					</select>
				</td>
				<td class="actions">
					<button type="button" onclick={() => patch(user.id, { resetPassword: true })}>
						Reset password
					</button>
					{#if tempPasswords[user.id]}<code class="temp">{tempPasswords[user.id]}</code>{/if}
					{#if user.role !== 'owner' && user.id !== data.user.id}
						{#if confirmingDelete === user.id}
							<span class="confirm">Reassigns their uploads, albums and comments to the owner.</span
							>
							<button class="danger" type="button" onclick={() => remove(user.id)}>
								Delete {user.username}
							</button>
							<button type="button" onclick={() => (confirmingDelete = null)}>Cancel</button>
						{:else}
							<button type="button" onclick={() => (confirmingDelete = user.id)}>Delete</button>
						{/if}
					{/if}
				</td>
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

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		padding: 8px 12px 8px 0;
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
		vertical-align: top;
	}

	.name {
		color: var(--accent);
		font-weight: 600;
	}

	.owner-badge {
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	select,
	button {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background-color: color-mix(in srgb, currentColor 10%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--sans);
		font-size: 13px;
	}

	select {
		padding-right: 2.2em;
	}

	.danger {
		font-weight: 700;
	}

	.temp {
		padding: 4px 6px;
		background: color-mix(in srgb, currentColor 12%, transparent);
		font-family: ui-monospace, monospace;
		font-size: 13px;
	}

	.confirm {
		max-width: 260px;
		font-family: var(--sans);
		font-size: 13px;
		line-height: 1.3;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	:is(select, button):focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
