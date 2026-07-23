<script module lang="ts">
	import type { ItemDate } from '$lib/domain/dates';

	export type MetaPatchPayload = {
		title: string | null;
		description: string | null;
		dateStart: string | null;
		dateEnd: string | null;
		datePrecision: ItemDate['precision'];
		/** Omitted = unchanged; null = clear; "HH:MM" = set time-of-day. */
		captureTime?: string | null;
		tapeLabel: string | null;
		location: string | null;
		people: string[];
		tags: string[];
	};

	export function buildMetaPayload(input: {
		title: string;
		description: string;
		date: ItemDate;
		tapeLabel: string;
		location: string;
		captureTime?: string | null;
		peopleText?: string;
		peopleIds?: string[];
		tagsText: string;
	}): MetaPatchPayload {
		return {
			title: input.title.trim() || null,
			description: input.description.trim() || null,
			dateStart: input.date.dateStart,
			dateEnd: input.date.dateEnd,
			datePrecision: input.date.precision,
			...(input.captureTime === undefined ? {} : { captureTime: input.captureTime }),
			tapeLabel: input.tapeLabel.trim() || null,
			location: input.location.trim() || null,
			people: input.peopleIds ? [...new Set(input.peopleIds)] : csv(input.peopleText ?? ''),
			tags: [...new Set(csv(input.tagsText).map((tag) => tag.toLowerCase()))]
		};
	}

	function csv(value: string): string[] {
		return [
			...new Set(
				value
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean)
			)
		];
	}
</script>

<script lang="ts">
	import { DAY_PERIODS, periodForTime } from '$lib/domain/day-period';
	import DatePicker from '$lib/ui/DatePicker.svelte';
	import { CREAM, DAWN, FONT, INK } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/dto';

	type PersonOption = { id: string; name: string; accentColor: string };

	interface Props {
		item: ItemDTO;
		people?: PersonOption[];
		canCreatePeople?: boolean;
		onsubmit: (payload: MetaPatchPayload) => void;
	}

	let { item, people = [], canCreatePeople = false, onsubmit }: Props = $props();

	let loadedItemId = $state<string | null>(null);
	let title = $state('');
	let description = $state('');
	let tapeLabel = $state('');
	let location = $state('');
	let date = $state<ItemDTO['date']>({ dateStart: null, dateEnd: null, precision: 'unknown' });
	let selectedPeople = $state<string[]>([]);
	let personQuery = $state('');
	let creatingPerson = $state(false);
	let newPersonName = $state('');
	let personError = $state('');
	let tagsText = $state('');
	// Time-of-day for same-day ordering: a coarse day-period (the common case for
	// scans, whose real clock time is unknown) or an exact time. Prefilled only
	// when the stored capture timestamp is anchored to the item's day (not a
	// transfer timestamp from digitization); sent only when the user changes it,
	// so an untouched form never clobbers a probe-derived value.
	let timeChoice = $state(''); // '' | day-period id | 'exact'
	let timeOfDay = $state(''); // "HH:MM" when timeChoice is 'exact'
	let timeInitial = $state('');
	let peopleOptions = $derived<PersonOption[]>(people);

	$effect(() => {
		if (loadedItemId === item.id) return;
		loadedItemId = item.id;
		title = item.title ?? '';
		description = item.description ?? '';
		tapeLabel = item.tapeLabel ?? '';
		location = item.location ?? '';
		date = item.date;
		selectedPeople = item.people.map((person) => person.id);
		tagsText = item.tags.map((tag) => tag.name).join(', ');
		const onDay =
			item.date.precision === 'day' &&
			item.date.dateStart != null &&
			item.captureTime?.startsWith(`${item.date.dateStart}T`);
		const timePart = onDay ? (item.captureTime?.slice(11) ?? '') : '';
		const period = timePart ? periodForTime(timePart) : null;
		timeChoice = period ?? (timePart ? 'exact' : '');
		timeOfDay = period || !timePart ? '' : timePart.slice(0, 5);
		timeInitial = `${timeChoice}~${timeOfDay}`;
	});

	const timeDirty = $derived(`${timeChoice}~${timeOfDay}` !== timeInitial);

	const selectedPeopleDetail = $derived(
		peopleOptions.filter((person) => selectedPeople.includes(person.id))
	);
	const peopleValue = $derived(selectedPeople.join(', '));
	const personMatches = $derived.by(() => {
		const query = personQuery.trim().toLowerCase();
		if (query.length === 0) return [];
		return peopleOptions
			.filter(
				(person) =>
					!selectedPeople.includes(person.id) &&
					(query.length === 0 || person.name.toLowerCase().includes(query))
			)
			.slice(0, query.length === 0 ? 8 : 14);
	});
	const payload = $derived(
		buildMetaPayload({
			title,
			description,
			date,
			tapeLabel,
			location,
			captureTime: !timeDirty
				? undefined
				: date.precision !== 'day'
					? undefined
					: timeChoice === 'exact'
						? timeOfDay || null
						: timeChoice || null,
			peopleIds: selectedPeople,
			tagsText
		})
	);

	function selectPerson(id: string): void {
		if (!selectedPeople.includes(id)) selectedPeople = [...selectedPeople, id];
		personQuery = '';
	}

	function removePerson(id: string): void {
		selectedPeople = selectedPeople.filter((personId) => personId !== id);
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
		const { person } = (await res.json()) as { person: PersonOption };
		peopleOptions = [...peopleOptions, person].sort((a, b) => a.name.localeCompare(b.name));
		selectPerson(person.id);
		newPersonName = '';
		creatingPerson = false;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit(payload);
	}
</script>

<form
	class="meta-form"
	aria-label="Edit metadata"
	style:--cream={CREAM}
	style:--dawn={DAWN}
	style:--ink={INK}
	style:--serif={FONT.serif}
	style:--sans={FONT.sans}
	onsubmit={submit}
>
	<div class="grid">
		<label>
			<span>Title</span>
			<input name="title" bind:value={title} />
		</label>
		<label>
			<span>Tape</span>
			<input name="tapeLabel" bind:value={tapeLabel} />
		</label>
	</div>

	<label>
		<span>Location</span>
		<input name="location" bind:value={location} placeholder="e.g. Big Sur, California" />
	</label>

	<label>
		<span>Description</span>
		<textarea name="description" bind:value={description}></textarea>
	</label>

	<DatePicker bind:value={date} />
	<input type="hidden" name="dateStart" value={date.dateStart ?? ''} />
	<input type="hidden" name="dateEnd" value={date.dateEnd ?? ''} />
	<input type="hidden" name="datePrecision" value={date.precision} />

	{#if date.precision === 'day'}
		<label class="time-field">
			<span>Time of day (orders same-day items)</span>
			<div class="time-controls">
				<select name="captureTimeChoice" bind:value={timeChoice}>
					<option value="">Unknown</option>
					{#each DAY_PERIODS as period (period.id)}
						<option value={period.id}>{period.label}</option>
					{/each}
					<option value="exact">Exact time…</option>
				</select>
				{#if timeChoice === 'exact'}
					<input type="time" name="captureTime" bind:value={timeOfDay} />
				{/if}
			</div>
		</label>
	{/if}

	<div class="people-field">
		<div class="label-row">
			<span>People</span>
			{#if canCreatePeople}
				<button
					type="button"
					class="inline-action"
					onclick={() => (creatingPerson = !creatingPerson)}
				>
					Add person
				</button>
			{/if}
		</div>
		<input type="hidden" name="people" value={peopleValue} />
		<input bind:value={personQuery} placeholder="Search people" aria-label="Search people" />
		{#if selectedPeopleDetail.length}
			<div class="people-chips" aria-label="Selected people">
				{#each selectedPeopleDetail as person (person.id)}
					<button
						type="button"
						class="selected"
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
			<div class="people-chips">
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
					<p class="hint">No matching people.</p>
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
			{#if personError}<p class="err">{personError}</p>{/if}
		{/if}
	</div>

	<label>
		<span>Tags</span>
		<input name="tags" bind:value={tagsText} />
	</label>

	<button type="submit">Save</button>
</form>

<style>
	.meta-form {
		display: grid;
		gap: 0.95rem;
		padding: 1rem 0;
		color: var(--cream);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.85rem;
	}

	label span,
	.label-row span {
		display: block;
		margin-bottom: 0.35rem;
		font-family: var(--sans);
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.72;
	}

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	input,
	select,
	textarea {
		width: 100%;
		min-height: 44px;
		padding: 0.62rem 0.75rem;
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--cream);
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		border: 0;
	}

	select option {
		color: var(--ink);
	}

	.time-controls {
		display: flex;
		gap: 0.5rem;
	}

	textarea {
		min-height: 5rem;
		resize: vertical;
	}

	button {
		justify-self: start;
		min-height: 44px;
		padding: 0 1rem;
		font-family: var(--sans);
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		color: var(--ink);
		text-transform: uppercase;
		cursor: pointer;
		background: var(--dawn);
		border: 0;
	}

	.inline-action {
		min-height: 32px;
		padding: 0;
		color: var(--dawn);
		background: transparent;
	}

	.people-field {
		display: grid;
		gap: 0.5rem;
	}

	.people-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.people-chips button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 38px;
		padding: 0 0.65rem 0 0.45rem;
		color: var(--cream);
		background: color-mix(in srgb, var(--cream) 11%, transparent);
	}

	.people-chips button.selected {
		color: var(--ink);
		background: color-mix(in srgb, var(--person-accent) 78%, var(--cream));
	}

	.people-chips em {
		font-family: var(--sans);
		font-size: 0.62rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.72;
	}

	.hint {
		margin: 0;
		font-family: var(--serif);
		font-size: 0.95rem;
		opacity: 0.72;
	}

	.people-chips button span {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		margin: 0;
		color: var(--ink);
		background: var(--person-accent);
		font-size: 0.65rem;
		font-weight: 800;
		line-height: 1;
	}

	.create-person {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.5rem;
	}

	.err {
		color: var(--dawn);
		font-family: var(--sans);
		font-size: 0.75rem;
	}

	:global(.meta-form .date-field),
	:global(.meta-form .date-field .controls),
	:global(.meta-form .date-field .range-row) {
		grid-template-columns: 1fr;
	}

	:global(.meta-form .date-field .date-label) {
		padding: 0;
	}

	:global(.meta-form .date-field .range-copy) {
		padding: 0.7rem 0.75rem;
		line-height: 1.25;
		letter-spacing: 0.12em;
	}
</style>
