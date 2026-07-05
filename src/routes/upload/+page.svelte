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

	let files = $state<File[]>([]);
	let title = $state('');
	let description = $state('');
	let tapeLabel = $state('');
	let date = $state<ItemDate>(itemDateFrom({ precision: 'unknown' }));
	let selectedPeople = $state<string[]>([]);
	let tags = $state('');
	let progress = $state(0);
	let currentIndex = $state(0);
	let busy = $state(false);
	let message = $state('');
	let allowDuplicate = $state(false);
	let results = $state<QueueResult[]>([]);

	const selectedNames = $derived(
		data.people.filter((person) => selectedPeople.includes(person.id)).map((person) => person.name)
	);
	const queueLabel = $derived(
		files.length === 0
			? 'No files selected'
			: files.length === 1
				? files[0].name
				: `${files.length} files selected`
	);

	function chooseFiles(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		files = Array.from(input.files ?? []);
		results = files.map((file) => ({ name: file.name, status: 'waiting' }));
		currentIndex = 0;
		progress = 0;
		message = files.length ? 'Ready.' : '';
	}

	function togglePerson(id: string): void {
		selectedPeople = selectedPeople.includes(id)
			? selectedPeople.filter((personId) => personId !== id)
			: [...selectedPeople, id];
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

		const sha256 = await sha256File(file);
		const init = await apiInitUpload({
			sha256,
			sizeBytes: file.size,
			mime: file.type,
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
		const derived = file.type.startsWith('image/')
			? await derivePhoto(file)
			: await deriveVideo(file);
		const meta: UploadMeta = {
			type: file.type.startsWith('image/') ? 'photo' : 'video',
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
			<span class="count">{files.length || 'No'} selected</span>
		</header>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<section class="picker">
				<label class="file-pick">
					<input
						type="file"
						multiple
						accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"
						onchange={chooseFiles}
					/>
					<span class="choose">Choose media</span>
					<span class="file-copy">
						<strong>{queueLabel}</strong>
						<small>Photos and videos, single or bulk</small>
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
				<div class="field-grid">
					<label>
						<span>Title</span>
						<input
							bind:value={title}
							disabled={files.length > 1}
							placeholder={files.length > 1 ? 'Bulk uploads keep original titles' : ''}
						/>
					</label>
					<label>
						<span>Tape label</span>
						<input bind:value={tapeLabel} />
					</label>
				</div>

				<label>
					<span>Description</span>
					<textarea bind:value={description}></textarea>
				</label>

				<DatePicker bind:value={date} />

				<fieldset>
					<legend>People</legend>
					<div class="people-picker">
						{#each data.people as person (person.id)}
							<button
								type="button"
								class:active={selectedPeople.includes(person.id)}
								style:--person-accent={person.accentColor}
								onclick={() => togglePerson(person.id)}
							>
								<span>{person.name.slice(0, 1)}</span>
								{person.name}
							</button>
						{/each}
					</div>
					{#if selectedNames.length}
						<p class="selected">{selectedNames.join(', ')}</p>
					{/if}
				</fieldset>

				<label>
					<span>Tags</span>
					<input bind:value={tags} placeholder="lake, birthday, tape 7" />
				</label>

				<label class="check">
					<input type="checkbox" bind:checked={allowDuplicate} />
					<span>Keep duplicates</span>
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
	label span,
	legend,
	.file-copy small,
	.queue-row em,
	.selected,
	.status p {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.label,
	.count,
	.file-copy small,
	.selected,
	.status p {
		opacity: 0.66;
	}

	form {
		display: grid;
		grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
		gap: 18px;
		align-items: start;
	}

	.picker,
	.meta {
		display: grid;
		gap: 14px;
	}

	.file-pick {
		position: relative;
		display: grid;
		grid-template-columns: 180px minmax(0, 1fr);
		min-height: 86px;
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
		padding: 14px 18px;
	}

	.file-copy strong {
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: 24px;
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

	.field-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}

	label,
	fieldset {
		display: grid;
		gap: 7px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
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

	.people-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.people-picker button {
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
		padding: 0 12px 0 8px;
	}

	.people-picker button.active {
		background: color-mix(in srgb, var(--person-accent) 72%, transparent);
		color: var(--ink);
	}

	.people-picker span {
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

	.selected {
		margin: 0;
	}

	.check {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: 10px;
	}

	.check input {
		width: 20px;
		min-height: 20px;
		accent-color: #d8b58d;
	}

	.actions {
		display: grid;
		grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
		gap: 14px;
		align-items: end;
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

	@media (max-width: 860px) {
		form,
		.field-grid,
		.actions {
			grid-template-columns: 1fr;
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
