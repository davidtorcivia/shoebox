<script lang="ts">
	import Button from '$lib/ui/Button.svelte';
	import DatePicker from '$lib/ui/DatePicker.svelte';
	import { itemDateFrom, type ItemDate } from '$lib/domain/dates';
	import { derivePhoto } from '$lib/upload/derive-photo';
	import { deriveVideo } from '$lib/upload/derive-video';
	import { sha256File } from '$lib/upload/hash';
	import { apiCompleteUpload, apiInitUpload, uploadChunks } from '$lib/upload/uploader';
	import type { ItemDTO, UploadMeta } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let file = $state<File | null>(null);
	let title = $state('');
	let description = $state('');
	let tapeLabel = $state('');
	let date = $state<ItemDate>(itemDateFrom({ precision: 'unknown' }));
	let selectedPeople = $state<string[]>([]);
	let tags = $state('');
	let progress = $state(0);
	let busy = $state(false);
	let message = $state('');
	let duplicateItemId = $state<string | null>(null);
	let allowDuplicate = $state(false);
	let item = $state<ItemDTO | null>(null);

	async function submit() {
		if (!file || busy) return;
		busy = true;
		message = 'Preparing';
		progress = 0;
		item = null;
		try {
			const sha256 = await sha256File(file);
			const init = await apiInitUpload({
				sha256,
				sizeBytes: file.size,
				mime: file.type,
				filename: file.name
			});
			duplicateItemId = init.duplicateItemId;
			if (duplicateItemId && !allowDuplicate) {
				message = 'Duplicate found';
				return;
			}

			message = 'Uploading';
			await uploadChunks(file, init, (sent, total) => {
				progress = total > 0 ? Math.round((sent / total) * 100) : 0;
			});

			message = 'Processing';
			const derived = file.type.startsWith('image/')
				? await derivePhoto(file)
				: await deriveVideo(file);
			const meta: UploadMeta = {
				type: file.type.startsWith('image/') ? 'photo' : 'video',
				width: derived.width,
				height: derived.height,
				duration: 'duration' in derived ? derived.duration : null,
				title: title.trim() || null,
				description: description.trim() || null,
				tapeLabel: tapeLabel.trim() || null,
				date: 'date' in derived ? (derived.date ?? date) : date,
				people: selectedPeople,
				tags: tags
					.split(',')
					.map((tag) => tag.trim())
					.filter(Boolean)
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
			item = complete.item;
			message = 'Complete';
		} catch (err) {
			message = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Upload · Shoebox</title>
</svelte:head>

<section class="upload-room">
	<div class="heading">
		<p class="sans">Arrivals</p>
		<h1>Upload</h1>
	</div>

	<form
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<label class="drop">
			<span>Media</span>
			<input
				type="file"
				accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"
				onchange={(event) => {
					file = event.currentTarget.files?.[0] ?? null;
					duplicateItemId = null;
					allowDuplicate = false;
					item = null;
				}}
			/>
			<strong>{file?.name ?? 'Choose a photo or video'}</strong>
		</label>

		<div class="grid">
			<label>
				<span>Title</span>
				<input bind:value={title} />
			</label>
			<label>
				<span>Tape</span>
				<input bind:value={tapeLabel} />
			</label>
		</div>

		<label>
			<span>Description</span>
			<textarea bind:value={description}></textarea>
		</label>

		<DatePicker bind:value={date} />

		<label>
			<span>People</span>
			<select multiple bind:value={selectedPeople}>
				{#each data.people as person (person.id)}
					<option value={person.id}>{person.name}</option>
				{/each}
			</select>
		</label>

		<label>
			<span>Tags</span>
			<input bind:value={tags} />
		</label>

		{#if duplicateItemId}
			<label class="check">
				<input type="checkbox" bind:checked={allowDuplicate} />
				<span>Keep duplicate</span>
			</label>
		{/if}

		<div class="actions">
			<Button type="submit">{busy ? 'Working' : 'Upload'}</Button>
			{#if message}
				<p>{message}</p>
			{/if}
			{#if progress > 0 && progress < 100}
				<meter min="0" max="100" value={progress}>{progress}</meter>
			{/if}
			{#if item}
				<p>{item.title ?? item.displayDate}</p>
			{/if}
		</div>
	</form>
</section>

<style>
	.upload-room {
		width: min(100%, 58rem);
		padding: clamp(1.5rem, 4vw, 4rem);
	}

	.heading {
		margin-bottom: 2rem;
	}

	h1 {
		font-size: clamp(2.4rem, 8vw, 5.6rem);
		font-weight: 560;
		line-height: 0.95;
	}

	form {
		display: grid;
		gap: 1rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1rem;
	}

	label span,
	.drop > span {
		display: block;
		margin-bottom: 0.4rem;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.72rem;
		opacity: 0.85;
	}

	input,
	textarea,
	select {
		width: 100%;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		padding: 0.7rem 0.8rem;
		font-family: var(--font-serif);
		font-size: 1rem;
	}

	textarea {
		min-height: 7rem;
		resize: vertical;
	}

	select[multiple] {
		min-height: 8rem;
	}

	:global(html.light) input,
	:global(html.light) textarea,
	:global(html.light) select {
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}

	.drop {
		display: block;
		padding: 1rem;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
		cursor: pointer;
	}

	.drop input {
		margin-bottom: 0.8rem;
		padding: 0;
		background: transparent;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 44px;
	}

	.check input {
		width: 1.25rem;
		min-height: 1.25rem;
	}

	.check span {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		min-height: 44px;
	}

	meter {
		width: min(100%, 14rem);
		height: 0.8rem;
	}
</style>
