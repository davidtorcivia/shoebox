<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let selectedFaces = $state<Record<string, string[]>>({});
	let personSelections = $state<Record<string, string>>({});
	let boxDrafts = $state<Record<string, string>>({});
	// Faces whose crop image 404'd (scanned before crop generation existed);
	// these fall back to the boxed item thumbnail.
	let brokenCrops = $state<Record<string, boolean>>({});
	// svelte-ignore state_referenced_locally
	let suggestions = $state(data.suggestions);
	// svelte-ignore state_referenced_locally
	let unmatched = $state(data.unmatched.faces);
	let unmatchedPeople = $state<Record<string, string>>({});
	let busy = $state<string | null>(null);
	let notice = $state('');

	$effect(() => {
		suggestions = data.suggestions;
		const nextPeople: Record<string, string> = {};
		const nextBoxes: Record<string, string> = {};
		for (const cluster of data.suggestions) {
			nextPeople[cluster.clusterId] = cluster.suggestedPerson?.id ?? '';
			for (const face of cluster.faces) nextBoxes[face.id] ??= JSON.stringify(face.box);
		}
		personSelections = nextPeople;
		boxDrafts = nextBoxes;
	});

	function selected(clusterId: string): string[] {
		return selectedFaces[clusterId] ?? [];
	}

	function toggle(clusterId: string, faceId: string): void {
		const current = selected(clusterId);
		selectedFaces = {
			...selectedFaces,
			[clusterId]: current.includes(faceId)
				? current.filter((id) => id !== faceId)
				: [...current, faceId]
		};
	}

	async function mutate(
		key: string,
		url: string,
		init: Parameters<typeof fetch>[1]
	): Promise<boolean> {
		busy = key;
		notice = '';
		const res = await fetch(url, init);
		busy = null;
		if (!res.ok) {
			notice = await res.text();
			return false;
		}
		notice = 'Updated.';
		void invalidateAll();
		return true;
	}

	// The stable face ids the admin is looking at. Sending these (rather than
	// relying on the cluster id) keeps assign/reject working even if the worker
	// reclusters and renames the cluster between page load and the click.
	function faceIdsFor(clusterId: string): string[] {
		return (
			suggestions
				.find((cluster) => cluster.clusterId === clusterId)
				?.faces.map((face) => face.id) ?? []
		);
	}

	async function assign(clusterId: string): Promise<void> {
		const personId = personSelections[clusterId];
		if (!personId) {
			notice = 'Choose a person before assigning.';
			return;
		}
		if (
			await mutate(`assign-${clusterId}`, `/api/admin/faces/clusters/${clusterId}/assign`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ personId, faceIds: faceIdsFor(clusterId) })
			})
		) {
			suggestions = suggestions.filter((cluster) => cluster.clusterId !== clusterId);
		}
	}

	async function reject(clusterId: string): Promise<void> {
		if (
			await mutate(`reject-${clusterId}`, `/api/admin/faces/clusters/${clusterId}/reject`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ faceIds: faceIdsFor(clusterId) })
			})
		) {
			suggestions = suggestions.filter((cluster) => cluster.clusterId !== clusterId);
		}
	}

	async function split(clusterId: string): Promise<void> {
		const faceIds = selected(clusterId);
		if (faceIds.length === 0) {
			notice = 'Select at least one face to split.';
			return;
		}
		await mutate(`split-${clusterId}`, `/api/admin/faces/clusters/${clusterId}/split`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ faceIds })
		});
		selectedFaces = { ...selectedFaces, [clusterId]: [] };
	}

	async function rejectFaceBox(clusterId: string, faceId: string): Promise<void> {
		if (
			await mutate(`reject-face-${faceId}`, `/api/admin/faces/faces/${faceId}/reject`, {
				method: 'POST'
			})
		) {
			suggestions = suggestions
				.map((cluster) =>
					cluster.clusterId === clusterId
						? {
								...cluster,
								faces: cluster.faces.filter((face) => face.id !== faceId),
								count: cluster.faces.filter((face) => face.id !== faceId).length
							}
						: cluster
				)
				.filter((cluster) => cluster.faces.length > 0);
		}
	}

	// Unmatched (noise) faces: assign straight to a person, or reject.
	async function assignUnmatched(faceId: string): Promise<void> {
		const personId = unmatchedPeople[faceId];
		if (!personId) {
			notice = 'Choose a person first.';
			return;
		}
		if (
			await mutate(`um-assign-${faceId}`, `/api/admin/faces/faces/${faceId}/assign`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ personId })
			})
		) {
			unmatched = unmatched.filter((face) => face.id !== faceId);
		}
	}

	async function rejectUnmatched(faceId: string): Promise<void> {
		if (
			await mutate(`um-reject-${faceId}`, `/api/admin/faces/faces/${faceId}/reject`, {
				method: 'POST'
			})
		) {
			unmatched = unmatched.filter((face) => face.id !== faceId);
		}
	}

	async function saveBox(faceId: string): Promise<void> {
		let box: unknown;
		try {
			box = JSON.parse(boxDrafts[faceId] ?? '');
		} catch {
			notice = 'Box must be valid JSON.';
			return;
		}
		await mutate(`box-${faceId}`, `/api/admin/faces/faces/${faceId}/box`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ box })
		});
	}
</script>

<div class="faces-page">
	<section class="review-hero">
		<div>
			<p>Face Review</p>
			<h2>
				{suggestions.length} suggested {suggestions.length === 1 ? 'cluster' : 'clusters'}
			</h2>
		</div>
		<span>{data.people.length} known people</span>
	</section>

	{#if notice}
		<p class="notice">{notice}</p>
	{/if}

	{#if suggestions.length === 0 && unmatched.length === 0}
		<p class="empty">No face suggestions are waiting for review.</p>
	{/if}

	{#if suggestions.length > 0}
		<div class="clusters">
			{#each suggestions as cluster (cluster.clusterId)}
				<section class="cluster" data-testid="face-cluster">
					<div class="cluster-head">
						<div>
							<p>{cluster.suggestedPerson ? `Looks like ${cluster.suggestedPerson.name}` : 'Cluster'}</p>
							<h3>{cluster.count} {cluster.count === 1 ? 'face' : 'faces'}</h3>
						</div>
						<div class="cluster-actions">
							<select
								data-testid="face-person-select"
								aria-label={`Person for cluster ${cluster.clusterId}`}
								value={personSelections[cluster.clusterId] ?? ''}
								onchange={(event) =>
									(personSelections = {
										...personSelections,
										[cluster.clusterId]: event.currentTarget.value
									})}
							>
								<option value="">Choose person</option>
								{#each data.people as person (person.id)}
									<option value={person.id}>{person.name}</option>
								{/each}
							</select>
							<button
								data-testid="face-assign"
								type="button"
								disabled={busy === `assign-${cluster.clusterId}`}
								onclick={() => assign(cluster.clusterId)}
							>
								Assign
							</button>
							<button
								class="secondary"
								data-testid="face-split"
								type="button"
								disabled={busy === `split-${cluster.clusterId}`}
								onclick={() => split(cluster.clusterId)}
							>
								Split {selected(cluster.clusterId).length || ''}
							</button>
							<button
								class="danger"
								data-testid="face-reject"
								type="button"
								disabled={busy === `reject-${cluster.clusterId}`}
								onclick={() => reject(cluster.clusterId)}
							>
								Reject
							</button>
						</div>
					</div>

					<div class="faces">
						{#each cluster.faces as face (face.id)}
							<article class:selected={selected(cluster.clusterId).includes(face.id)}>
								<button
									class="thumb"
									type="button"
									aria-pressed={selected(cluster.clusterId).includes(face.id)}
									onclick={() => toggle(cluster.clusterId, face.id)}
								>
									{#if face.cropUrl && !brokenCrops[face.id]}
										<img
											src={face.cropUrl}
											alt=""
											loading="lazy"
											onerror={() => (brokenCrops = { ...brokenCrops, [face.id]: true })}
										/>
									{:else if face.thumbUrl}
										<img src={face.thumbUrl} alt="" loading="lazy" />
										<span
											class="face-box"
											style={`--x:${face.box.x * 100}%;--y:${face.box.y * 100}%;--w:${face.box.w * 100}%;--h:${face.box.h * 100}%;`}
										></span>
									{:else}
										<span>No thumbnail</span>
									{/if}
								</button>
								<div class="face-meta">
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- item id is dynamic -->
									<a href={`/item/${face.itemId}`}>{face.itemType}</a>
									<span>{face.frameTime == null ? 'still' : `${face.frameTime.toFixed(1)}s`}</span>
								</div>
								<label>
									<span>Box</span>
									<textarea bind:value={boxDrafts[face.id]} rows="3"></textarea>
								</label>
								<div class="face-tools">
									<button
										class="secondary save-box"
										type="button"
										disabled={busy === `box-${face.id}`}
										onclick={() => saveBox(face.id)}
									>
										Save box
									</button>
									<button
										class="danger reject-face"
										data-testid="face-reject-one"
										type="button"
										disabled={busy === `reject-face-${face.id}`}
										onclick={() => rejectFaceBox(cluster.clusterId, face.id)}
									>
										Reject box
									</button>
								</div>
							</article>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	{#if unmatched.length > 0}
		<section class="cluster unmatched" data-testid="unmatched-faces">
			<div class="cluster-head">
				<div>
					<p>Unmatched faces</p>
					<h3>
						{data.unmatched.total} not in any cluster{data.unmatched.total > unmatched.length
							? ` · showing ${unmatched.length}`
							: ''}
					</h3>
				</div>
			</div>
			<p class="unmatched-hint">
				Faces seen too briefly to group — assign them directly so the person still gets credited
				(and future scans learn from it).
			</p>
			<div class="faces">
				{#each unmatched as face (face.id)}
					<article>
						<div class="thumb">
							{#if face.cropUrl && !brokenCrops[face.id]}
								<img
									src={face.cropUrl}
									alt=""
									loading="lazy"
									onerror={() => (brokenCrops = { ...brokenCrops, [face.id]: true })}
								/>
							{:else if face.thumbUrl}
								<img src={face.thumbUrl} alt="" loading="lazy" />
								<span
									class="face-box"
									style={`--x:${face.box.x * 100}%;--y:${face.box.y * 100}%;--w:${face.box.w * 100}%;--h:${face.box.h * 100}%;`}
								></span>
							{:else}
								<span>No thumbnail</span>
							{/if}
						</div>
						<div class="face-meta">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- item id is dynamic -->
							<a href={`/item/${face.itemId}`}>{face.itemTitle ?? face.itemType}</a>
							<span>{face.frameTime == null ? 'still' : `${face.frameTime.toFixed(1)}s`}</span>
						</div>
						<select
							aria-label="Person for this face"
							value={unmatchedPeople[face.id] ?? ''}
							onchange={(event) =>
								(unmatchedPeople = { ...unmatchedPeople, [face.id]: event.currentTarget.value })}
						>
							<option value="">Choose person</option>
							{#each data.people as person (person.id)}
								<option value={person.id}>{person.name}</option>
							{/each}
						</select>
						<div class="face-tools">
							<button
								type="button"
								data-testid="unmatched-assign"
								disabled={busy === `um-assign-${face.id}`}
								onclick={() => assignUnmatched(face.id)}
							>
								Assign
							</button>
							<button
								class="danger"
								type="button"
								data-testid="unmatched-reject"
								disabled={busy === `um-reject-${face.id}`}
								onclick={() => rejectUnmatched(face.id)}
							>
								Reject
							</button>
						</div>
					</article>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.faces-page {
		display: grid;
		gap: 18px;
	}

	.review-hero {
		display: flex;
		min-height: 132px;
		align-items: end;
		justify-content: space-between;
		gap: 18px;
		padding: 22px;
		background:
			linear-gradient(135deg, rgb(218 137 115 / 0.45), transparent 48%),
			linear-gradient(315deg, rgb(106 144 165 / 0.36), transparent 58%),
			color-mix(in srgb, currentColor 8%, transparent);
	}

	.review-hero p,
	.cluster-head p {
		margin: 0 0 6px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		opacity: var(--chrome-opacity, 0.65);
		text-transform: uppercase;
	}

	h2,
	h3 {
		margin: 0;
		font-family: var(--serif);
		font-weight: 500;
		line-height: 1;
	}

	h2 {
		font-size: clamp(30px, 5vw, 54px);
	}

	h3 {
		font-size: 28px;
	}

	.review-hero > span,
	.notice,
	.empty {
		font-family: var(--sans);
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.notice {
		margin: 0;
		padding: 12px 14px;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}

	.empty {
		margin: 0;
		padding: 24px 0;
		opacity: var(--chrome-opacity, 0.65);
	}

	.clusters {
		display: grid;
		gap: 18px;
	}

	.cluster {
		padding: 18px;
		background:
			linear-gradient(120deg, rgb(255 255 255 / 0.08), transparent 42%),
			color-mix(in srgb, currentColor 7%, transparent);
	}

	.cluster-head {
		display: grid;
		grid-template-columns: minmax(160px, 1fr) auto;
		gap: 16px;
		align-items: end;
		margin-bottom: 16px;
	}

	.cluster-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}

	select,
	button,
	textarea {
		border: 0;
		background-color: color-mix(in srgb, currentColor 10%, transparent);
		color: inherit;
	}

	select,
	button {
		min-height: 44px;
		padding: 0 12px;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	button {
		cursor: pointer;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.secondary {
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	.danger {
		background: color-mix(in srgb, #da8973 40%, transparent);
	}

	.faces {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 12px;
	}

	.unmatched-hint {
		margin: -6px 0 16px;
		font-family: var(--sans);
		font-size: 13px;
		opacity: 0.75;
	}

	article {
		display: grid;
		gap: 10px;
		padding: 10px;
		background: color-mix(in srgb, currentColor 7%, transparent);
	}

	article.selected {
		outline: 2px solid currentColor;
		outline-offset: -2px;
	}

	.thumb {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		padding: 0;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb > span:not(.face-box) {
		display: grid;
		height: 100%;
		place-items: center;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.face-box {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--w);
		height: var(--h);
		border: 2px solid white;
		box-shadow: 0 0 0 999px rgb(0 0 0 / 0.22);
	}

	.face-meta {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.face-meta a {
		color: inherit;
		font-weight: 700;
		text-decoration: none;
	}

	label {
		display: grid;
		gap: 5px;
	}

	label span {
		font-family: var(--sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		opacity: var(--chrome-opacity, 0.58);
		text-transform: uppercase;
	}

	textarea {
		min-height: 68px;
		resize: vertical;
		padding: 9px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		line-height: 1.35;
	}

	.face-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.save-box {
		justify-self: start;
	}

	select {
		padding-right: 2.2em;
	}

	:is(select, button, textarea):focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}

	@media (max-width: 760px) {
		.review-hero,
		.cluster-head {
			display: grid;
			grid-template-columns: 1fr;
		}

		.cluster-actions {
			justify-content: start;
		}
	}
</style>
