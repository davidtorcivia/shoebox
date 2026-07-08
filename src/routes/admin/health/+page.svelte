<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const health = $derived(data.health);
	const features = $derived(data.features);

	function fmtBytes(bytes: number): string {
		if (bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
		const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const value = bytes / 1024 ** exp;
		return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
	}

	function fmtCount(n: number): string {
		return n.toLocaleString('en-US');
	}

	function ageFrom(ts: number | null, now: number): string {
		if (ts === null) return 'never';
		const ms = Math.max(0, now - ts);
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s ago`;
		const m = Math.round(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.round(m / 60);
		if (h < 48) return `${h}h ago`;
		const d = Math.round(h / 24);
		return `${d}d ago`;
	}

	// "Stuck" heuristic: a pending job older than 10 minutes suggests the worker
	// isn't draining the queue.
	const STUCK_MS = 10 * 60 * 1000;
	const oldestPendingAge = $derived(ageFrom(health.jobs.oldestPendingAt, health.generatedAt));
	const jobsStuck = $derived(
		health.jobs.oldestPendingAt !== null &&
			health.generatedAt - health.jobs.oldestPendingAt > STUCK_MS
	);

	// Faces are considered "quiet" if enabled but no scan has completed in a day.
	const FACES_STALE_MS = 24 * 60 * 60 * 1000;
	const faceScanAge = $derived(ageFrom(health.faces.lastFaceScanAt, health.generatedAt));
	const facesStale = $derived(
		features.faces &&
			(health.faces.lastFaceScanAt === null ||
				health.generatedAt - health.faces.lastFaceScanAt > FACES_STALE_MS)
	);
</script>

<h2>Health</h2>

<section aria-labelledby="features-h">
	<h3 id="features-h">Features</h3>
	<div class="flags">
		<span class="flag" class:on={features.faces} data-testid="feature-faces">
			<span class="dot"></span>Faces {features.faces ? 'on' : 'off'}
		</span>
		<span class="flag" class:on={features.ingestion} data-testid="feature-ingestion">
			<span class="dot"></span>Ingestion {features.ingestion ? 'on' : 'off'}
		</span>
		<span
			class="flag"
			class:on={features.serverDerivatives}
			data-testid="feature-server-derivatives"
		>
			<span class="dot"></span>Server derivatives {features.serverDerivatives ? 'on' : 'off'}
		</span>
	</div>
</section>

<section aria-labelledby="queue-h">
	<h3 id="queue-h">Job queue</h3>
	<div class="cards">
		<div class="card">
			<span class="label">Pending</span>
			<span class="stat" data-testid="jobs-pending">{fmtCount(health.jobs.totalPending)}</span>
		</div>
		<div class="card">
			<span class="label">Running</span>
			<span class="stat" data-testid="jobs-running">{fmtCount(health.jobs.totalRunning)}</span>
		</div>
		<div class="card" class:alert={health.jobs.totalFailed > 0}>
			<span class="label">Failed</span>
			<span class="stat" data-testid="jobs-failed">{fmtCount(health.jobs.totalFailed)}</span>
		</div>
		<div class="card" class:alert={jobsStuck}>
			<span class="label">Oldest pending</span>
			<span class="stat sm" data-testid="jobs-oldest-pending">{oldestPendingAge}</span>
			{#if jobsStuck}<span class="flag-note">queue may be stuck</span>{/if}
		</div>
	</div>

	<table>
		<thead>
			<tr>
				<th>Kind</th>
				<th class="num">Pending</th>
				<th class="num">Running</th>
				<th class="num">Failed</th>
				<th class="num">Done</th>
			</tr>
		</thead>
		<tbody>
			{#each health.jobs.byKind as row (row.kind)}
				<tr data-testid={`jobkind-${row.kind}`}>
					<td class="kind">{row.kind}</td>
					<td class="num">{fmtCount(row.pending)}</td>
					<td class="num">{fmtCount(row.running)}</td>
					<td class="num" class:danger={row.failed > 0} data-testid={`jobkind-${row.kind}-failed`}>
						{fmtCount(row.failed)}
					</td>
					<td class="num muted">{fmtCount(row.done)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section aria-labelledby="ingest-h">
	<h3 id="ingest-h">Failed ingests</h3>
	<div class="cards">
		<div class="card" class:alert={health.failedIngests.count > 0}>
			<span class="label">Failed ingest scans</span>
			<span class="stat" data-testid="ingest-failed-count">
				{fmtCount(health.failedIngests.count)}
			</span>
		</div>
	</div>
	{#if health.failedIngests.recent.length === 0}
		<p class="empty">No failed ingest scans.</p>
	{:else}
		<ul class="reasons">
			{#each health.failedIngests.recent as row (row.id)}
				<li data-testid="ingest-failure">
					<span class="reason">{row.reason ?? 'unknown error'}</span>
					{#if row.path}<span class="path">{row.path}</span>{/if}
					<span class="when">{ageFrom(row.createdAt, health.generatedAt)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section aria-labelledby="faces-h">
	<h3 id="faces-h">Faces</h3>
	{#if !features.faces}
		<p class="empty" data-testid="faces-disabled">
			The faces feature is disabled (FACES_ENABLED is not set).
		</p>
	{/if}
	<div class="cards">
		<div class="card">
			<span class="label">Pending</span>
			<span class="stat" data-testid="faces-pending">{fmtCount(health.faces.pending)}</span>
		</div>
		<div class="card">
			<span class="label">Confirmed</span>
			<span class="stat" data-testid="faces-confirmed">{fmtCount(health.faces.confirmed)}</span>
		</div>
		<div class="card">
			<span class="label">Rejected</span>
			<span class="stat" data-testid="faces-rejected">{fmtCount(health.faces.rejected)}</span>
		</div>
		<div class="card">
			<span class="label">Clusters awaiting review</span>
			<span class="stat" data-testid="faces-pending-clusters">
				{fmtCount(health.faces.pendingClusters)}
			</span>
		</div>
		<div class="card" class:alert={facesStale}>
			<span class="label">Last face scan</span>
			<span class="stat sm" data-testid="faces-last-scan">{faceScanAge}</span>
			{#if facesStale}<span class="flag-note">worker may be idle/down</span>{/if}
		</div>
	</div>
	<p class="note">
		GPU / OpenVINO status for the faces service isn't directly observable here — the service logs
		<code>[faces]</code> on the worker. The last completed face scan above is the liveness proxy.
	</p>
</section>

<section aria-labelledby="library-h">
	<h3 id="library-h">Library</h3>
	<div class="cards">
		<div class="card">
			<span class="label">Photos (ready)</span>
			<span class="stat" data-testid="library-photos">{fmtCount(health.library.readyPhotos)}</span>
		</div>
		<div class="card">
			<span class="label">Videos (ready)</span>
			<span class="stat" data-testid="library-videos">{fmtCount(health.library.readyVideos)}</span>
		</div>
		<div class="card" class:alert={health.library.needsReview > 0}>
			<span class="label">Arrivals backlog</span>
			<span class="stat" data-testid="library-needs-review">
				{fmtCount(health.library.needsReview)}
			</span>
		</div>
		<div class="card">
			<span class="label">In trash</span>
			<span class="stat" data-testid="library-trashed">{fmtCount(health.library.trashed)}</span>
		</div>
		<div class="card">
			<span class="label">People</span>
			<span class="stat" data-testid="library-people">{fmtCount(health.library.people)}</span>
		</div>
		<div class="card">
			<span class="label">Media stored</span>
			<span class="stat sm" data-testid="library-bytes">{fmtBytes(health.library.totalBytes)}</span>
		</div>
	</div>
</section>

<style>
	h2 {
		margin: 0 0 16px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	h3 {
		margin: 28px 0 10px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		opacity: var(--chrome-opacity, 0.5);
		text-transform: uppercase;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 10px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		background: color-mix(in srgb, currentColor 7%, transparent);
	}

	.card.alert {
		background: color-mix(in srgb, var(--dawn) 22%, transparent);
		box-shadow: inset 3px 0 0 var(--dawn);
	}

	.label {
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.12em;
		opacity: var(--chrome-opacity, 0.5);
		text-transform: uppercase;
	}

	.stat {
		font-family: var(--serif);
		font-size: 34px;
		font-weight: 500;
		line-height: 1;
	}

	.stat.sm {
		font-size: 22px;
	}

	.flag-note {
		font-family: var(--sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dawn);
	}

	.flags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.flag {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background: color-mix(in srgb, currentColor 7%, transparent);
		font-family: var(--sans);
		font-size: 13px;
		opacity: 0.6;
	}

	.flag.on {
		opacity: 1;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		background: currentColor;
		opacity: 0.4;
	}

	.flag.on .dot {
		background: var(--dawn);
		opacity: 1;
	}

	table {
		width: 100%;
		margin-top: 14px;
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
		padding: 8px 12px 8px 0;
		font-family: var(--serif);
		font-size: 16px;
		border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}

	.num {
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.kind {
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.muted {
		opacity: var(--chrome-opacity, 0.5);
	}

	td.danger {
		color: var(--dawn);
		font-weight: 700;
	}

	.empty {
		margin: 4px 0 10px;
		font-family: var(--serif);
		font-size: 16px;
	}

	.reasons {
		display: flex;
		flex-direction: column;
		margin: 12px 0 0;
		padding: 0;
		gap: 8px;
		list-style: none;
	}

	.reasons li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 10px;
		padding: 10px 14px;
		background: color-mix(in srgb, var(--dawn) 14%, transparent);
		box-shadow: inset 3px 0 0 var(--dawn);
	}

	.reason {
		font-family: var(--serif);
		font-size: 15px;
		font-weight: 600;
	}

	.path {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		opacity: 0.7;
		word-break: break-all;
	}

	.when {
		margin-left: auto;
		font-family: var(--sans);
		font-size: 12px;
		opacity: var(--chrome-opacity, 0.5);
	}

	.note {
		max-width: 640px;
		margin-top: 14px;
		font-family: var(--sans);
		font-size: 12px;
		line-height: 1.5;
		opacity: var(--chrome-opacity, 0.5);
	}

	.note code {
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
</style>
