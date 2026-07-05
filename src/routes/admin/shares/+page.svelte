<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let copied = $state('');

	async function revoke(id: string): Promise<void> {
		await fetch(`/api/shares/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	async function copy(token: string): Promise<void> {
		await navigator.clipboard.writeText(new URL(`/share/${token}`, location.origin).href);
		copied = token;
		setTimeout(() => (copied = ''), 1500);
	}
</script>

<h2>Shares</h2>
{#if data.shares.length === 0}
	<p class="empty">No share links yet.</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>Target</th>
				<th>Protection</th>
				<th>Expires</th>
				<th>Downloads</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.shares as share (share.id)}
				<tr>
					<td>{share.targetType === 'album' ? 'Album' : 'Item'} / {share.targetTitle}</td>
					<td>{share.hasPassword ? 'Password' : 'Open'}</td>
					<td>{share.expiresAt ? new Date(share.expiresAt).toLocaleDateString() : 'never'}</td>
					<td>{share.allowDownload ? 'allowed' : 'view only'}</td>
					<td class="actions">
						<button type="button" onclick={() => copy(share.token)}>
							{copied === share.token ? 'Copied' : 'Copy link'}
						</button>
						<button type="button" onclick={() => revoke(share.id)}>Revoke</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	h2 {
		margin: 0 0 16px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	.empty {
		font-family: var(--serif);
		font-size: 17px;
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

	button {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background: color-mix(in srgb, currentColor 10%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--sans);
		font-size: 13px;
	}

	button:focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}

	.actions {
		display: flex;
		gap: 6px;
	}
</style>
