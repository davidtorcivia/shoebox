<script lang="ts">
	import { goto } from '$app/navigation';
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';
	import CropPicker from '$lib/ui/CropPicker.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import RelEditor from '$lib/ui/RelEditor.svelte';
	import { makePortraitCrop } from '$lib/ui/crop';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { CropRect } from '$lib/domain/people-dto';
	import type { ItemDTO } from '$lib/types';

	let { data } = $props();
	const person = $derived(data.person);

	// svelte-ignore state_referenced_locally
	let name = $state(data.person.name),
		birthdate = $state(data.person.birthdate ?? ''),
		deathDate = $state(data.person.deathDate ?? ''),
		birthPlace = $state(data.person.birthPlace ?? ''),
		accentColor = $state(data.person.accentColor),
		avatarItemId = $state(data.person.avatarItemId),
		avatarCrop = $state(data.person.avatarCrop);
	let saveError = $state('');
	let deleteError = $state('');
	let taggedItems = $state<ItemDTO[]>([]);
	const activeAccent = $derived(accentColor);
	const room = $derived(personRoomFor(activeAccent));

	$effect(() => {
		let cancelled = false;
		fetch(`/api/items?people=${person.id}&limit=100`)
			.then((res) => res.json())
			.then((body: { items: ItemDTO[] }) => {
				if (!cancelled) taggedItems = body.items;
			});
		return () => {
			cancelled = true;
		};
	});

	const selectedItem = $derived(taggedItems.find((item) => item.id === avatarItemId) ?? null);

	function pickAvatar(item: ItemDTO) {
		avatarItemId = item.id;
		avatarCrop = makePortraitCrop(item.width, item.height, 0.9, 0.5, 0.4);
	}

	function clearAvatar() {
		avatarItemId = null;
		avatarCrop = null;
	}

	async function save() {
		saveError = '';
		const res = await fetch(`/api/people/${person.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name,
				birthdate: birthdate || null,
				deathDate: deathDate || null,
				birthPlace: birthPlace || null,
				accentColor,
				avatarItemId,
				avatarCrop
			})
		});
		if (!res.ok) {
			saveError =
				((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
				'Could not save.';
			return;
		}
		const { person: saved } = (await res.json()) as { person: { slug: string } };
		await goto(`/people/${saved.slug}`);
	}

	async function destroy() {
		deleteError = '';
		if (!confirm(`Delete ${person.name}? This cannot be undone.`)) return;
		const res = await fetch(`/api/people/${person.id}`, { method: 'DELETE' });
		if (res.status === 409) {
			const body = (await res.json()) as { count: number };
			deleteError = `Still tagged in ${body.count} item${body.count === 1 ? '' : 's'} — untag first.`;
			return;
		}
		if (!res.ok) {
			deleteError = 'Could not delete.';
			return;
		}
		await goto('/people');
	}
</script>

<svelte:head>
	<title>Edit {person.name} - Shoebox</title>
</svelte:head>

<div class="room" style={`--person-accent: ${activeAccent}`}>
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<div class="wrap">
			<a class="back" href={`/people/${person.slug}`}>← Back to {person.name}</a>
			<h1>Edit person</h1>

			<section>
				<div class="label">Details</div>
				<label class="field">
					<span>Name</span>
					<input data-testid="edit-name" bind:value={name} />
				</label>
				<div class="row">
					<label class="field">
						<span>Born</span>
						<input type="date" data-testid="edit-birthdate" bind:value={birthdate} />
					</label>
					<label class="field">
						<span>Died</span>
						<input type="date" data-testid="edit-deathdate" bind:value={deathDate} />
					</label>
				</div>
				<label class="field">
					<span>Birth place</span>
					<input data-testid="edit-birthplace" bind:value={birthPlace} />
				</label>
			</section>

			<section>
				<div class="label">Accent</div>
				<AccentSwatches bind:value={accentColor} />
			</section>

			<section>
				<div class="label">Portrait</div>
				{#if selectedItem && avatarCrop}
					<div class="cropwrap">
						<CropPicker
							imageUrl={selectedItem.urls.thumb800 || selectedItem.urls.poster}
							imageW={selectedItem.width}
							imageH={selectedItem.height}
							bind:crop={avatarCrop}
						/>
						<button class="minor" type="button" onclick={clearAvatar}>Remove portrait</button>
					</div>
				{/if}
				<div class="thumbs" data-testid="avatar-picker">
					{#each taggedItems as item (item.id)}
						<button
							type="button"
							class="thumb"
							class:selected={item.id === avatarItemId}
							onclick={() => pickAvatar(item)}
						>
							<img src={item.urls.thumb400 || item.urls.poster} alt={item.title ?? 'Tagged item'} />
						</button>
					{:else}
						<p class="hint">Tag {person.name} in an item to pick a portrait.</p>
					{/each}
				</div>
			</section>

			<section>
				<div class="label">Family</div>
				<RelEditor personId={person.id} others={data.others} family={person.family} />
			</section>

			<div class="actions">
				<button class="save" data-testid="save-person" onclick={save}>Save</button>
				{#if saveError}<span class="err">{saveError}</span>{/if}
				{#if data.isAdmin}
					<button class="danger" data-testid="delete-person" onclick={destroy}>Delete person</button>
					{#if deleteError}<span class="err" data-testid="delete-error">{deleteError}</span>{/if}
				{/if}
			</div>
		</div>
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
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.68) 100%);
	}

	.wrap {
		max-width: 760px;
		padding: 30px;
	}

	.back {
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-decoration: none;
		text-transform: uppercase;
	}

	h1 {
		margin: 14px 0 26px;
		font-family: var(--font-serif);
		font-size: 40px;
		font-weight: 400;
		line-height: 1;
	}

	section {
		margin-bottom: 34px;
	}

	.label {
		margin-bottom: 14px;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	.field {
		display: block;
		margin-bottom: 14px;
	}

	.field span {
		display: block;
		margin-bottom: 6px;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.field input {
		width: 100%;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 17px;
		padding: 12px 14px;
	}

	.row {
		display: flex;
		gap: 14px;
	}

	.row .field {
		flex: 1;
	}

	.cropwrap {
		max-width: 420px;
		margin-bottom: 16px;
	}

	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 8px;
	}

	.thumb {
		aspect-ratio: 1;
		overflow: hidden;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}

	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb.selected {
		outline: 3px solid var(--person-accent);
		outline-offset: -3px;
	}

	.hint {
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		font-family: var(--font-serif);
		font-size: 15px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 18px;
	}

	.save,
	.danger,
	.minor {
		min-height: 44px;
		border: 0;
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	.save {
		background: var(--person-accent);
		color: var(--ink);
		padding: 0 22px;
	}

	.danger {
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		padding: 0 22px;
	}

	.minor {
		background: none;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		padding: 0;
	}

	.err {
		color: var(--person-accent);
		font-family: var(--font-sans);
		font-size: 11px;
	}

	@media (max-width: 640px) {
		.wrap {
			padding-inline: 18px;
		}

		.row {
			flex-direction: column;
			gap: 0;
		}
	}
</style>
