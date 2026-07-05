<script module lang="ts">
	import type { ItemDate } from '$lib/domain/dates';

	export type MetaPatchPayload = {
		title: string | null;
		description: string | null;
		dateStart: string | null;
		dateEnd: string | null;
		datePrecision: ItemDate['precision'];
		tapeLabel: string | null;
		people: string[];
		tags: string[];
	};

	export function buildMetaPayload(input: {
		title: string;
		description: string;
		date: ItemDate;
		tapeLabel: string;
		peopleText: string;
		tagsText: string;
	}): MetaPatchPayload {
		return {
			title: input.title.trim() || null,
			description: input.description.trim() || null,
			dateStart: input.date.dateStart,
			dateEnd: input.date.dateEnd,
			datePrecision: input.date.precision,
			tapeLabel: input.tapeLabel.trim() || null,
			people: csv(input.peopleText),
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
	import DatePicker from '$lib/ui/DatePicker.svelte';
	import { CREAM, DAWN, FONT, INK } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/dto';

	interface Props {
		item: ItemDTO;
		onsubmit: (payload: MetaPatchPayload) => void;
	}

	let { item, onsubmit }: Props = $props();

	let loadedItemId = $state<string | null>(null);
	let title = $state('');
	let description = $state('');
	let tapeLabel = $state('');
	let date = $state<ItemDTO['date']>({ dateStart: null, dateEnd: null, precision: 'unknown' });
	let peopleText = $state('');
	let tagsText = $state('');

	$effect(() => {
		if (loadedItemId === item.id) return;
		loadedItemId = item.id;
		title = item.title ?? '';
		description = item.description ?? '';
		tapeLabel = item.tapeLabel ?? '';
		date = item.date;
		peopleText = item.people.map((person) => person.id).join(', ');
		tagsText = item.tags.map((tag) => tag.name).join(', ');
	});

	const payload = $derived(
		buildMetaPayload({ title, description, date, tapeLabel, peopleText, tagsText })
	);

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
		<span>Description</span>
		<textarea name="description" bind:value={description}></textarea>
	</label>

	<DatePicker bind:value={date} />
	<input type="hidden" name="dateStart" value={date.dateStart ?? ''} />
	<input type="hidden" name="dateEnd" value={date.dateEnd ?? ''} />
	<input type="hidden" name="datePrecision" value={date.precision} />

	<label>
		<span>People IDs</span>
		<input name="people" bind:value={peopleText} />
	</label>

	<label>
		<span>Tags</span>
		<input name="tags" bind:value={tagsText} />
	</label>

	<button type="submit">Save</button>
</form>

<style>
	.meta-form {
		display: grid;
		gap: 0.85rem;
		padding: 1rem 0;
		color: var(--cream);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.85rem;
	}

	label span {
		display: block;
		margin-bottom: 0.35rem;
		font-family: var(--sans);
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.72;
	}

	input,
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
</style>
