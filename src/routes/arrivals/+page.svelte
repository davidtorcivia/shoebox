<script lang="ts">
	import DatePicker from '$lib/ui/DatePicker.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { reducedMotion } from '$lib/ui/theme';
	import { MOTION } from '$lib/ui/tokens';
	import type { ItemDate } from '$lib/domain/dates';
	import { moveFocus, parseTagsInput, rangeSelect } from './selection';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type QueueItem = PageData['items'][number];

	const arrivalGradient = {
		dusk: '#23191E',
		verdigris: '#48929B',
		earthenware: '#C4967C',
		silk: '#E0D0A8'
	};

	const room = {
		stops: [arrivalGradient.dusk, arrivalGradient.verdigris, arrivalGradient.earthenware] as [
			string,
			string,
			string
		],
		pools: [
			{ color: `${arrivalGradient.verdigris}55`, pos: '104% 2%', size: '86% 58%' },
			{ color: `${arrivalGradient.earthenware}4d`, pos: '-6% 104%', size: '82% 54%' },
			{ color: `${arrivalGradient.silk}26`, pos: '48% 112%', size: '90% 44%' }
		]
	};

	let updatedItems = $state<Record<string, QueueItem>>({});
	let removedIds = $state<string[]>([]);
	let focusIndex = $state(0);
	let anchorIndex = $state<number | null>(null);
	let selectedIds = $state<string[]>([]);
	let leavingIds = $state<string[]>([]);
	let date = $state<ItemDate>({ dateStart: null, dateEnd: null, precision: 'unknown' });
	let peopleIds = $state<string[]>([]);
	let personQuery = $state('');
	// svelte-ignore state_referenced_locally
	let peopleOptions = $state(data.people);
	let creatingPerson = $state(false);
	let newPersonName = $state('');
	let personError = $state('');
	let tagsText = $state('');
	let title = $state('');
	let tapeLabel = $state('');
	let albumId = $state('');
	let lastLoadedId = $state<string | null>(null);

	const queue = $derived(
		data.items
			.filter((item) => !removedIds.includes(item.id))
			.map((item) => updatedItems[item.id] ?? item)
	);
	const focused = $derived(queue[focusIndex] ?? null);
	const selectedCount = $derived(selectedIds.length || (focused ? 1 : 0));
	const selectedPeopleDetail = $derived(
		peopleOptions.filter((person) => peopleIds.includes(person.id))
	);
	const personMatches = $derived.by(() => {
		const query = personQuery.trim().toLowerCase();
		if (query.length === 0) return [];
		return peopleOptions
			.filter(
				(person) => !peopleIds.includes(person.id) && person.name.toLowerCase().includes(query)
			)
			.slice(0, 14);
	});

	$effect(() => {
		const item = queue[focusIndex];
		if (!item || item.id === lastLoadedId) return;
		lastLoadedId = item.id;
		date = { ...item.date };
		peopleIds = item.people.map((person) => person.id);
		personQuery = '';
		creatingPerson = false;
		tagsText = item.tags.map((tag) => tag.name).join(', ');
		title = item.title ?? '';
		tapeLabel = item.tapeLabel ?? '';
		albumId = item.albums[0]?.id ?? '';
	});

	function targetIds(): string[] {
		if (selectedIds.length > 0) return selectedIds;
		return focused ? [focused.id] : [];
	}

	function buildApply(): Record<string, unknown> {
		return {
			date: date.precision === 'unknown' ? undefined : date,
			people: peopleIds,
			tags: parseTagsInput(tagsText),
			albumId: albumId || undefined
		};
	}

	async function postArrivals(itemIds: string[], approve: boolean): Promise<boolean> {
		const res = await fetch('/api/arrivals', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ itemIds, apply: buildApply(), approve })
		});
		return res.ok;
	}

	async function savePerItemFields(itemId: string): Promise<void> {
		await fetch(`/api/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: title.trim() || null, tapeLabel: tapeLabel.trim() || null })
		});
	}

	function removeFromQueue(ids: string[]): void {
		const finish = (): void => {
			const remainingCount = queue.filter((item) => !ids.includes(item.id)).length;
			removedIds = [...new Set([...removedIds, ...ids])];
			leavingIds = leavingIds.filter((id) => !ids.includes(id));
			selectedIds = [];
			anchorIndex = null;
			focusIndex = moveFocus(remainingCount, focusIndex, 0);
			lastLoadedId = null;
		};

		if ($reducedMotion) {
			finish();
			return;
		}

		leavingIds = [...new Set([...leavingIds, ...ids])];
		setTimeout(finish, MOTION.slow);
	}

	async function approve(): Promise<void> {
		const ids = targetIds();
		if (ids.length === 0) return;
		if (focused && ids.includes(focused.id)) await savePerItemFields(focused.id);
		if (await postArrivals(ids, true)) removeFromQueue(ids);
	}

	async function applyToSelection(): Promise<void> {
		const ids = targetIds();
		if (ids.length === 0) return;
		if (!(await postArrivals(ids, false))) return;
		const tags = parseTagsInput(tagsText);
		const next = { ...updatedItems };
		for (const item of queue) {
			if (!ids.includes(item.id)) continue;
			next[item.id] = {
				...item,
				date: date.precision === 'unknown' ? item.date : { ...date },
				tags: [
					...item.tags,
					...tags
						.filter((name) => !item.tags.some((tag) => tag.name === name))
						.map((name) => ({ id: name, name, kind: 'topic' as const }))
				]
			};
		}
		updatedItems = next;
	}

	function onCardClick(event: MouseEvent, index: number): void {
		const ids = queue.map((item) => item.id);
		if (event.shiftKey && anchorIndex !== null) {
			selectedIds = rangeSelect(ids, anchorIndex, index);
		} else {
			anchorIndex = index;
			selectedIds = [ids[index]];
		}
		focusIndex = index;
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		if (target.closest('input, textarea, select, [contenteditable]')) {
			if (event.key === 'Escape') target.blur();
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
			event.preventDefault();
			focusIndex = moveFocus(queue.length, focusIndex, 1);
		} else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
			event.preventDefault();
			focusIndex = moveFocus(queue.length, focusIndex, -1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			void approve();
		} else if (event.key === 'a' || event.key === 'A') {
			event.preventDefault();
			void applyToSelection();
		}
	}

	function selectPerson(id: string): void {
		if (!peopleIds.includes(id)) peopleIds = [...peopleIds, id];
		personQuery = '';
	}

	function removePerson(id: string): void {
		peopleIds = peopleIds.filter((personId) => personId !== id);
	}

	async function createPerson(): Promise<void> {
		const name = newPersonName.trim();
		if (!name) return;
		personError = '';
		const res = await fetch('/api/people', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		if (!res.ok) {
			personError = 'Could not add person.';
			return;
		}
		const { person } = await res.json();
		peopleOptions = [...peopleOptions, person].sort((a, b) => a.name.localeCompare(b.name));
		selectPerson(person.id);
		newPersonName = '';
		creatingPerson = false;
	}

	function previewUrl(item: QueueItem): string {
		return item.urls.thumb1600 || item.urls.thumb800 || item.urls.poster || item.urls.thumb400;
	}
</script>

<svelte:head>
	<title>Arrivals - Shoebox</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page" aria-label="Arrivals">
		<header class="head">
			<span class="label">Arrivals</span>
			<p class="count">{queue.length} waiting</p>
		</header>

		{#if queue.length === 0}
			<section class="empty">
				<h2>All arrivals are reviewed.</h2>
				{#if data.ingestionEnabled}
					<p data-testid="ingest-hint">Ingest folder is active.</p>
				{/if}
			</section>
		{:else}
			<div class="layout">
				<ol class="queue" aria-label="Review queue">
					{#each queue as item, index (item.id)}
						<li
							class="row"
							class:focused={index === focusIndex}
							class:selected={selectedIds.includes(item.id)}
							class:leaving={leavingIds.includes(item.id)}
							data-testid="arrivals-row"
							data-item-id={item.id}
						>
							<button
								type="button"
								class="row-button"
								onclick={(event) => onCardClick(event, index)}
							>
								<img
									src={previewUrl(item)}
									alt={item.title ?? item.displayDate}
									width="104"
									height="70"
								/>
								<span class="row-copy">
									<span class="row-title">{item.title ?? 'Untitled'}</span>
									<span class="row-date" data-testid="arrivals-date">{item.displayDate}</span>
									<span class="row-tags">
										{#each item.tags as tag (tag.id)}
											<span class="chip" data-testid="hint-chip">{tag.name}</span>
										{/each}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ol>

				{#if focused}
					<section class="preview" data-testid="arrivals-preview" aria-label="Preview">
						<img src={previewUrl(focused)} alt={focused.title ?? focused.displayDate} />
					</section>

					<form
						class="meta"
						aria-label="Metadata"
						onsubmit={(event) => {
							event.preventDefault();
							void approve();
						}}
					>
						<div class="meta-head">
							<p class="kicker">{selectedCount} selected</p>
							<h2>{focused.title ?? 'Untitled'}</h2>
						</div>

						<label>
							<span>Title</span>
							<input type="text" bind:value={title} />
						</label>

						<DatePicker bind:value={date} />

						<div class="people-field" role="group" aria-labelledby="arrivals-people-label">
							<div class="people-label-row">
								<span id="arrivals-people-label">People</span>
								{#if data.canCreatePeople}
									<button
										type="button"
										class="inline-action"
										onclick={() => (creatingPerson = !creatingPerson)}
									>
										Add person
									</button>
								{/if}
							</div>
							<input
								bind:value={personQuery}
								placeholder="Search people"
								aria-label="Search people to tag"
							/>
							{#if selectedPeopleDetail.length}
								<div class="selected-people" aria-label="Selected people">
									{#each selectedPeopleDetail as person (person.id)}
										<button
											type="button"
											class="selected-person"
											style:--person-accent={person.accentColor}
											onclick={() => removePerson(person.id)}
											aria-label={`Remove ${person.name}`}
										>
											<span>{person.name.slice(0, 1)}</span>
											{person.name}
											<em>Remove</em>
										</button>
									{/each}
								</div>
							{/if}
							{#if personQuery.trim()}
								<div class="people-results">
									{#each personMatches as person (person.id)}
										<button
											type="button"
											style:--person-accent={person.accentColor}
											onclick={() => selectPerson(person.id)}
										>
											<span>{person.name.slice(0, 1)}</span>
											{person.name}
										</button>
									{:else}
										<p>No matching people.</p>
									{/each}
								</div>
							{/if}
							{#if creatingPerson}
								<div class="create-person">
									<input
										bind:value={newPersonName}
										placeholder="New person name"
										aria-label="New person name"
									/>
									<button type="button" onclick={() => void createPerson()}>Add</button>
									<button type="button" onclick={() => (creatingPerson = false)}>Cancel</button>
								</div>
								{#if personError}<p class="person-error">{personError}</p>{/if}
							{/if}
						</div>

						<label>
							<span>Tags</span>
							<input type="text" bind:value={tagsText} />
						</label>

						<label>
							<span>Tape label</span>
							<input type="text" bind:value={tapeLabel} />
						</label>

						{#if data.albums.length}
							<label>
								<span>Album</span>
								<select bind:value={albumId}>
									<option value="">None</option>
									{#each data.albums as album (album.id)}
										<option value={album.id}>{album.title}</option>
									{/each}
								</select>
							</label>
						{/if}

						<div class="actions">
							<button type="button" class="secondary" onclick={() => void applyToSelection()}>
								Apply
							</button>
							<button type="submit" class="primary" data-testid="approve-button">Approve</button>
						</div>

						{#if data.ingestionEnabled}
							<p class="ingest" data-testid="ingest-hint">Ingest folder is active.</p>
						{/if}
					</form>
				{/if}
			</div>
		{/if}
	</section>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.page {
		position: relative;
		min-height: 100vh;
		padding: 38px 30px 78px;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--ink) 8%, transparent) 0%,
				color-mix(in srgb, var(--ink) 74%, transparent) 100%
			),
			linear-gradient(110deg, color-mix(in srgb, var(--cream) 8%, transparent), transparent 46%);
		color: var(--cream);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 26px;
	}

	.label,
	.kicker,
	.count,
	.row-date,
	.meta label > span,
	.people-label-row > span,
	.ingest {
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.kicker,
	.label,
	.count,
	.ingest {
		opacity: 0.66;
	}

	h2 {
		margin: 0;
		font-family: var(--font-serif);
		font-weight: 600;
		line-height: 1.02;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(230px, 292px) minmax(360px, 1fr) minmax(360px, 430px);
		gap: 18px;
		align-items: start;
	}

	.queue {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: calc(100vh - 144px);
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.row {
		background: color-mix(in srgb, var(--cream) 9%, transparent);
		transition:
			opacity 300ms ease,
			transform 300ms ease,
			background 200ms ease;
	}

	.row.selected {
		background: color-mix(in srgb, var(--cream) 17%, transparent);
	}

	.row.leaving {
		opacity: 0;
		transform: translateX(18px);
	}

	.row-button {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		gap: 10px;
		width: 100%;
		min-height: 72px;
		padding: 8px;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row.focused .row-button {
		outline: 2px solid var(--cream);
		outline-offset: -2px;
	}

	.row-button img {
		width: 88px;
		height: 58px;
		object-fit: cover;
		filter: sepia(0.24) contrast(0.94) saturate(0.9);
	}

	.row-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 5px;
		justify-content: center;
	}

	.row-title {
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.12;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-date {
		opacity: 0.68;
	}

	.row-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 22px;
		padding: 0 7px;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.preview {
		min-height: 0;
		background: color-mix(in srgb, var(--cream) 8%, transparent);
	}

	.preview img {
		display: block;
		width: 100%;
		height: min(58vh, 560px);
		object-fit: contain;
		filter: sepia(0.24) contrast(0.94) saturate(0.9);
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--cream) 8%, transparent), transparent 72%),
			color-mix(in srgb, var(--ink) 26%, transparent);
	}

	.meta-head h2 {
		margin-top: 4px;
		overflow-wrap: anywhere;
		font-size: 22px;
		line-height: 1.08;
	}

	.meta label > span,
	.people-label-row > span {
		display: block;
		margin-bottom: 7px;
		opacity: 0.76;
	}

	.meta input:not([type='checkbox']),
	.meta select,
	.people-field > input {
		width: 100%;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 16px;
		padding: 7px 9px;
	}

	.meta :global(legend),
	.meta :global(label > span),
	.meta :global(.date-label) {
		margin-bottom: 7px;
		font-size: 11px;
		letter-spacing: 0.18em;
		opacity: 0.76;
	}

	.meta :global(.date-field) {
		grid-template-columns: 1fr;
		gap: 8px;
	}

	.meta :global(.date-label) {
		padding: 0;
	}

	.meta :global(.controls),
	.meta :global(.range-row) {
		grid-template-columns: 1fr;
		gap: 10px;
	}

	.meta :global(input:not([type='checkbox'])),
	.meta :global(select),
	.meta :global(.year-box button) {
		min-height: 44px;
		color: inherit;
		font-size: 16px;
		padding: 7px 9px;
	}

	.meta :global(.year-box) {
		grid-template-columns: 44px minmax(72px, 1fr) 44px;
	}

	.people-field {
		display: grid;
		gap: 8px;
	}

	.people-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.inline-action {
		border: 0;
		background: transparent;
		color: var(--dawn);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.selected-people,
	.people-results {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.selected-person,
	.people-results button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-serif);
		font-size: 15px;
		line-height: 1;
		padding: 7px 9px;
	}

	.selected-person {
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--person-accent) 30%, transparent),
				transparent
			),
			color-mix(in srgb, var(--cream) 11%, transparent);
	}

	.selected-person span,
	.people-results button span {
		display: inline-grid;
		width: 22px;
		height: 22px;
		place-items: center;
		background: var(--person-accent);
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 800;
		text-transform: uppercase;
	}

	.selected-person em {
		font-family: var(--font-sans);
		font-size: 9px;
		font-style: normal;
		letter-spacing: 0.14em;
		opacity: 0.62;
		text-transform: uppercase;
	}

	.people-results p,
	.person-error {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 15px;
		opacity: 0.72;
	}

	.create-person {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 6px;
	}

	.create-person button {
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 15%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.actions button {
		min-height: 44px;
		border: 0;
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.secondary {
		background: color-mix(in srgb, var(--cream) 15%, transparent);
		color: var(--cream);
	}

	.primary {
		background: var(--cream);
		color: var(--ink);
	}

	.empty {
		padding: 18vh 0;
	}

	.empty h2 {
		font-size: clamp(34px, 5vw, 64px);
	}

	.empty p {
		margin-top: 12px;
		font-family: var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.68;
	}

	@media (max-width: 1080px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.queue {
			max-height: none;
		}

		.preview,
		.preview img {
			min-height: 0;
			height: auto;
			max-height: 58vh;
		}
	}

	@media (max-width: 720px) {
		.page {
			padding: 24px 16px 78px;
		}

		.head {
			align-items: start;
			flex-direction: column;
			gap: 8px;
		}

		.row-button {
			grid-template-columns: 88px minmax(0, 1fr);
		}

		.row-button img {
			width: 88px;
			height: 58px;
		}

		.actions {
			grid-template-columns: 1fr;
		}
	}
</style>
