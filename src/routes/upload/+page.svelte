<script lang="ts">
	import DatePicker from '$lib/ui/DatePicker.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { itemDateFrom, type ItemDate } from '$lib/domain/dates';
	import { derivePhoto } from '$lib/upload/derive-photo';
	import { deriveVideo } from '$lib/upload/derive-video';
	import { sha256File } from '$lib/upload/hash';
	import { apiCompleteUpload, apiInitUpload, uploadChunks } from '$lib/upload/uploader';
	import type { ItemDTO, UploadMeta } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type QueueResult = {
		name: string;
		status: 'waiting' | 'uploading' | 'complete' | 'duplicate' | 'error';
		item?: ItemDTO;
		error?: string;
	};

	const room = {
		stops: ['#1E1A1F', '#A0677E', '#D8B58D'] as [string, string, string],
		pools: [
			{ color: '#6E9FA866', pos: '96% 0%', size: '84% 58%' },
			{ color: '#D36B5F5c', pos: '-8% 22%', size: '76% 58%' },
			{ color: '#E5C26F3d', pos: '52% 112%', size: '88% 48%' }
		]
	};
	const mediaAccept =
		'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.rw2,.raf,.orf,video/mp4,video/webm,video/quicktime,video/x-m4v,.mov,.m4v';

	let files = $state<File[]>([]);
	let title = $state('');
	let description = $state('');
	let tapeLabel = $state('');
	let date = $state<ItemDate>(itemDateFrom({ precision: 'unknown' }));
	let selectedPeople = $state<string[]>([]);
	let personQuery = $state('');
	// svelte-ignore state_referenced_locally
	let peopleOptions = $state(data.people);
	let creatingPerson = $state(false);
	let newPersonName = $state('');
	let personError = $state('');
	let tags = $state('');
	let progress = $state(0);
	let currentIndex = $state(0);
	let busy = $state(false);
	let message = $state('');
	let allowDuplicate = $state(false);
	let results = $state<QueueResult[]>([]);

	const selectedPeopleDetail = $derived(
		peopleOptions.filter((person) => selectedPeople.includes(person.id))
	);
	const queueLabel = $derived(
		files.length === 0
			? 'No files selected'
			: files.length === 1
				? files[0].name
				: `${files.length} files selected`
	);
	const selectedCountLabel = $derived(
		files.length === 0
			? 'No files selected'
			: files.length === 1
				? '1 file selected'
				: `${files.length} files selected`
	);
	const personMatches = $derived.by(() => {
		const query = personQuery.trim().toLowerCase();
		if (query.length === 0) return [];
		return peopleOptions
			.filter(
				(person) =>
					!selectedPeople.includes(person.id) &&
					(query.length === 0 || person.name.toLowerCase().includes(query))
			)
			.slice(0, 14);
	});

	function chooseFiles(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		files = Array.from(input.files ?? []);
		results = files.map((file) => ({ name: file.name, status: 'waiting' }));
		currentIndex = 0;
		progress = 0;
		message = files.length ? 'Ready.' : '';
	}

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
		const { person } = await res.json();
		peopleOptions = [...peopleOptions, person].sort((a, b) => a.name.localeCompare(b.name));
		selectPerson(person.id);
		newPersonName = '';
		creatingPerson = false;
	}

	function tagsList(): string[] {
		return tags
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}

	function updateResult(index: number, patch: Partial<QueueResult>): void {
		results = results.map((result, i) => (i === index ? { ...result, ...patch } : result));
	}

	async function uploadOne(file: File, index: number): Promise<void> {
		currentIndex = index + 1;
		progress = 0;
		updateResult(index, { status: 'uploading', error: undefined });
		message = `Uploading ${file.name}`;

		const mime = mimeForFile(file);
		const sha256 = await sha256File(file);
		const init = await apiInitUpload({
			sha256,
			sizeBytes: file.size,
			mime,
			filename: file.name
		});
		if (init.duplicateItemId && !allowDuplicate) {
			updateResult(index, { status: 'duplicate', error: 'Duplicate found.' });
			return;
		}

		await uploadChunks(file, init, (sent, total) => {
			progress = total > 0 ? Math.round((sent / total) * 100) : 0;
		});

		message = `Processing ${file.name}`;
		const derived = mime.startsWith('image/') ? await derivePhoto(file) : await deriveVideo(file);
		const meta: UploadMeta = {
			type: mime.startsWith('image/') ? 'photo' : 'video',
			width: derived.width,
			height: derived.height,
			duration: 'duration' in derived ? derived.duration : null,
			title: files.length === 1 ? title.trim() || null : null,
			description: description.trim() || null,
			tapeLabel: tapeLabel.trim() || null,
			date: 'date' in derived ? (derived.date ?? date) : date,
			people: selectedPeople,
			tags: tagsList()
		};
		const complete = await apiCompleteUpload({
			uploadId: init.uploadId,
			allowDuplicate,
			meta,
			blurhash: 'blurhash' in derived ? derived.blurhash : null,
			derivatives: {
				poster: derived.poster,
				thumb_400: derived.thumb_400,
				thumb_800: derived.thumb_800,
				thumb_1600: derived.thumb_1600
			}
		});
		updateResult(index, { status: 'complete', item: complete.item });
	}

	function mimeForFile(file: File): string {
		const typed = file.type.toLowerCase();
		if (typed) return typed;
		const name = file.name.toLowerCase();
		if (name.endsWith('.heic')) return 'image/heic';
		if (name.endsWith('.heif')) return 'image/heif';
		if (name.endsWith('.mov')) return 'video/quicktime';
		if (name.endsWith('.m4v')) return 'video/x-m4v';
		// Camera RAW rarely carries a browser MIME; route it to the image path so
		// the server can sniff the exact format and build derivatives from it.
		if (/\.(cr2|cr3|nef|arw|dng|rw2|raf|orf)$/.test(name)) return 'image/x-raw';
		return 'application/octet-stream';
	}

	async function submit(): Promise<void> {
		if (files.length === 0 || busy) return;
		busy = true;
		message = 'Preparing.';
		results = files.map((file) => ({ name: file.name, status: 'waiting' }));
		try {
			for (let index = 0; index < files.length; index += 1) {
				try {
					await uploadOne(files[index], index);
				} catch (err) {
					updateResult(index, {
						status: 'error',
						error: err instanceof Error ? err.message : 'Upload failed.'
					});
				}
			}
			message = 'Upload queue complete.';
			progress = 100;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Upload - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="head">
			<span class="label">Upload</span>
			<span class="count">{selectedCountLabel}</span>
		</header>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<section class="picker">
				<label class="file-pick" data-tour="file-pick">
					<input type="file" multiple accept={mediaAccept} onchange={chooseFiles} />
					<span class="choose">Choose media</span>
					<span class="file-copy">
						<strong>{queueLabel}</strong>
						<small>Photos, iPhone media, and videos</small>
					</span>
				</label>

				<div class="queue" aria-label="Upload queue">
					{#if results.length === 0}
						<p>No files queued.</p>
					{:else}
						{#each results as result, index (`${result.name}-${index}`)}
							<div class="queue-row" data-state={result.status}>
								<span>{result.name}</span>
								<em>{result.error ?? result.status}</em>
							</div>
						{/each}
					{/if}
				</div>
			</section>

			<section class="meta">
				<div class="field-row">
					<label for="upload-title" class="field-label">Title</label>
					<div class="field-control">
						<input
							id="upload-title"
							bind:value={title}
							disabled={files.length > 1}
							placeholder={files.length > 1 ? 'Bulk uploads keep original titles' : ''}
						/>
					</div>
				</div>

				<div class="field-row">
					<label for="upload-tape" class="field-label">Tape label</label>
					<div class="field-control">
						<input id="upload-tape" bind:value={tapeLabel} />
					</div>
				</div>

				<div class="field-row">
					<label for="upload-description" class="field-label">Description</label>
					<div class="field-control">
						<textarea id="upload-description" bind:value={description}></textarea>
					</div>
				</div>

				<DatePicker bind:value={date} />

				<div class="field-row people-field" role="group" aria-labelledby="people-field-label">
					<span id="people-field-label" class="field-label">People</span>
					<div class="field-control people-control">
						{#if data.canCreatePeople}
							<button
								type="button"
								class="add-person"
								onclick={() => (creatingPerson = !creatingPerson)}
							>
								Add person
							</button>
						{/if}
						<input
							bind:value={personQuery}
							placeholder="Search people"
							aria-label="Search people to tag"
						/>
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
						{#if selectedPeopleDetail.length}
							<div class="selected-people" aria-label="Selected people">
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
					</div>
				</div>

				<div class="field-row">
					<label for="upload-tags" class="field-label">Tags</label>
					<div class="field-control">
						<input id="upload-tags" bind:value={tags} placeholder="lake, birthday, tape 7" />
					</div>
				</div>

				<label class="field-row check">
					<span class="field-label">Duplicates</span>
					<span class="check-control">
						<input type="checkbox" bind:checked={allowDuplicate} />
						<span>
							<strong>Import exact duplicates</strong>
							<small>Off skips files already in the archive. On keeps an additional copy.</small>
						</span>
					</span>
				</label>

				<div class="actions">
					<button class="primary" type="submit" disabled={busy || files.length === 0}>
						{busy ? 'Uploading' : files.length > 1 ? 'Upload queue' : 'Upload'}
					</button>
					<div class="status">
						<span class="track"><span style:width={`${progress}%`}></span></span>
						<p>{message || `${currentIndex}/${files.length} uploaded`}</p>
					</div>
				</div>
			</section>
		</form>
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
		padding: 38px 30px 86px;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.68) 100%);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 26px;
	}

	.label,
	.count,
	.field-label,
	.file-copy small,
	.queue-row em,
	.people-results p,
	.check-control small,
	.status p {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.label,
	.count,
	.file-copy small,
	.people-results p,
	.check-control small,
	.status p {
		opacity: 0.66;
	}

	form {
		display: grid;
		grid-template-columns: minmax(390px, 500px) minmax(0, 1fr);
		gap: 28px;
		align-items: start;
		max-width: 1680px;
	}

	.picker,
	.meta {
		display: grid;
		gap: 14px;
	}

	.field-row {
		display: grid;
		grid-template-columns: 132px minmax(0, 1fr);
		gap: 14px;
		align-items: start;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.field-label {
		padding-top: 16px;
		opacity: 0.78;
	}

	.field-control {
		min-width: 0;
	}

	.file-pick {
		position: relative;
		display: grid;
		grid-template-columns: minmax(190px, 0.82fr) minmax(220px, 1fr);
		min-height: 112px;
		overflow: hidden;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		cursor: pointer;
	}

	.file-pick input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.choose {
		display: grid;
		place-items: center;
		background: color-mix(in srgb, #d8b58d 76%, var(--cream));
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.file-copy {
		display: grid;
		align-content: center;
		gap: 7px;
		min-width: 0;
		padding: 18px 22px;
	}

	.file-copy strong {
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: clamp(22px, 2.2vw, 34px);
		font-weight: 520;
		line-height: 1.05;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue {
		display: grid;
		gap: 6px;
	}

	.queue p {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 18px;
		opacity: 0.72;
	}

	.queue-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	.queue-row span {
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue-row[data-state='complete'] em {
		color: #d8b58d;
	}

	.queue-row[data-state='error'] em,
	.queue-row[data-state='duplicate'] em {
		color: var(--dawn);
	}

	input,
	textarea {
		width: 100%;
		min-height: 48px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 13%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 17px;
		padding: 10px 12px;
	}

	input:disabled {
		opacity: 0.62;
	}

	textarea {
		min-height: 112px;
		resize: vertical;
	}

	.people-control {
		display: grid;
		gap: 8px;
	}

	.add-person {
		justify-self: start;
		min-height: 32px;
		border: 0;
		background: transparent;
		color: color-mix(in srgb, #d8b58d 82%, var(--cream));
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.create-person {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 8px;
	}

	.create-person button {
		min-height: 48px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.person-error {
		margin: 0;
		color: var(--dawn);
		font-family: var(--font-sans);
		font-size: 12px;
	}

	.people-results,
	.selected-people {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.people-results button,
	.selected-people button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 11%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.1;
		padding: 0 12px 0 8px;
	}

	.selected-people button {
		background: color-mix(in srgb, var(--person-accent) 72%, transparent);
		color: var(--ink);
	}

	.selected-people button.selected {
		background: color-mix(in srgb, var(--person-accent) 82%, var(--cream));
	}

	.selected-people em {
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.68;
	}

	.people-results span,
	.selected-people span {
		display: grid;
		width: 24px;
		height: 24px;
		place-items: center;
		background: var(--person-accent);
		color: var(--ink);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 800;
		line-height: 1;
	}

	.people-results p {
		margin: 0;
	}

	.check {
		cursor: pointer;
	}

	.check-control {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr);
		gap: 10px;
		align-items: center;
		min-height: 48px;
		padding: 9px 12px;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}

	.check-control > span {
		display: grid;
		gap: 3px;
	}

	.check-control strong {
		font-family: var(--font-serif);
		font-size: 17px;
		font-weight: 520;
	}

	.check-control input {
		width: 20px;
		min-height: 20px;
		accent-color: #d8b58d;
	}

	.actions {
		display: grid;
		grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
		gap: 14px;
		align-items: end;
		margin-left: 146px;
	}

	.primary {
		min-height: 48px;
		border: 0;
		background: color-mix(in srgb, #d8b58d 82%, var(--cream));
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.primary:disabled {
		cursor: default;
		opacity: 0.58;
	}

	.status {
		display: grid;
		gap: 8px;
	}

	.track {
		display: block;
		height: 3px;
		background: color-mix(in srgb, var(--cream) 18%, transparent);
	}

	.track span {
		display: block;
		height: 100%;
		background: color-mix(in srgb, #d8b58d 82%, var(--cream));
	}

	.status p {
		margin: 0;
	}

	@media (max-width: 1180px) {
		form {
			grid-template-columns: 1fr;
			gap: 22px;
		}
	}

	@media (max-width: 860px) {
		.field-row,
		.actions {
			grid-template-columns: 1fr;
		}

		.field-label {
			padding-top: 0;
		}

		.actions {
			margin-left: 0;
		}
	}

	@media (max-width: 720px) {
		.page {
			padding: 38px 16px 76px;
		}

		.file-pick {
			grid-template-columns: 1fr;
		}

		.choose {
			min-height: 54px;
		}
	}
</style>
