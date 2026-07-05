<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const failed = $derived(data.jobs.filter((job) => job.status === 'failed'));
	const active = $derived(data.jobs.filter((job) => job.status !== 'failed'));

	function pretty(payload: string): string {
		try {
			return JSON.stringify(JSON.parse(payload), null, 2);
		} catch {
			return payload;
		}
	}

	function reason(payload: string): string | null {
		try {
			return (JSON.parse(payload) as { reason?: string }).reason ?? null;
		} catch {
			return null;
		}
	}

	async function retry(id: string): Promise<void> {
		await fetch(`/api/admin/jobs/${id}/retry`, { method: 'POST' });
		await invalidateAll();
	}
</script>

<h2>Jobs</h2>

<h3>Failed</h3>
{#if failed.length === 0}
	<p class="empty">No failed jobs.</p>
{:else}
	<ul>
		{#each failed as job (job.id)}
			<li data-testid="failed-job">
				<div class="head">
					<span class="kind">{job.kind}</span>
					<span class="meta"
						>{job.attempts} attempts / {new Date(job.createdAt).toLocaleString()}</span
					>
					{#if reason(job.payload)}
						<span class="reason">{reason(job.payload)}</span>
					{/if}
					<button type="button" onclick={() => retry(job.id)}>Retry</button>
				</div>
				<pre>{pretty(job.payload)}</pre>
			</li>
		{/each}
	</ul>
{/if}

<h3>Pending / running</h3>
{#if active.length === 0}
	<p class="empty">Queue is clear.</p>
{:else}
	<ul>
		{#each active as job (job.id)}
			<li>
				<div class="head">
					<span class="kind">{job.kind}</span>
					<span class="meta">{job.status} / runs {new Date(job.runAfter).toLocaleString()}</span>
				</div>
				<pre>{pretty(job.payload)}</pre>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h2 {
		margin: 0 0 16px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	h3 {
		margin: 24px 0 8px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		opacity: var(--chrome-opacity, 0.5);
		text-transform: uppercase;
	}

	.empty {
		font-family: var(--serif);
		font-size: 16px;
	}

	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		gap: 16px;
		list-style: none;
	}

	.head {
		display: flex;
		min-height: 48px;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}

	.kind {
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.meta {
		font-family: var(--sans);
		font-size: 13px;
		opacity: var(--chrome-opacity, 0.5);
	}

	.reason {
		font-family: var(--serif);
		font-size: 15px;
		font-weight: 600;
	}

	pre {
		overflow-x: auto;
		margin: 6px 0 0;
		padding: 10px;
		background: color-mix(in srgb, currentColor 8%, transparent);
		font-size: 12px;
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

	button:focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
