<script lang="ts">
	import { goto } from '$app/navigation';
	import PersonCard from '$lib/ui/PersonCard.svelte';
	import { GRAIN_URI } from '$lib/ui/tokens';

	let { data } = $props();
	let creating = $state(false);
	let newName = $state('');
	let createError = $state('');

	async function createPerson(event: SubmitEvent) {
		event.preventDefault();
		createError = '';
		const res = await fetch('/api/people', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: newName })
		});
		if (!res.ok) {
			createError = 'Could not create person.';
			return;
		}
		const { person } = await res.json();
		await goto(`/people/${person.id}/edit`);
	}
</script>

<svelte:head>
	<title>People - Shoebox</title>
</svelte:head>

<section class="page" style:--grain={`url("${GRAIN_URI}")`}>
	<header class="head">
		<span class="label">People</span>
		{#if data.canCreate}
			{#if creating}
				<form class="newform" onsubmit={createPerson}>
					<input name="name" placeholder="Full name" bind:value={newName} required minlength="1" />
					<button type="submit" data-testid="create-person">Add</button>
					<button type="button" onclick={() => (creating = false)}>Cancel</button>
				</form>
				{#if createError}<span class="err">{createError}</span>{/if}
			{:else}
				<button class="new" data-testid="new-person" onclick={() => (creating = true)}>
					New person
				</button>
			{/if}
		{/if}
	</header>

	<div class="grid" data-testid="people-grid">
		{#each data.people as person (person.id)}
			<PersonCard {person} />
		{/each}
	</div>
</section>

<style>
	.page {
		position: relative;
		min-height: calc(100vh - 56px);
		overflow: hidden;
		background:
			linear-gradient(115deg, rgb(73 42 42 / 0.72) 0%, transparent 36%),
			conic-gradient(
				from 214deg at 74% 18%,
				rgb(255 217 168 / 0.54),
				rgb(168 216 234 / 0.34),
				rgb(94 111 77 / 0.46),
				rgb(195 39 43 / 0.38),
				rgb(255 217 168 / 0.54)
			),
			linear-gradient(180deg, rgb(23 20 18 / 0.2) 0%, var(--ink) 72%),
			var(--ink);
		color: var(--cream);
	}

	.page::before {
		position: absolute;
		inset: 0;
		content: '';
		background-image:
			var(--grain),
			linear-gradient(180deg, rgb(255 245 232 / 0.1), transparent 34%, rgb(23 20 18 / 0.72));
		background-size:
			140px 140px,
			100% 100%;
		mix-blend-mode: overlay;
		opacity: 0.44;
		pointer-events: none;
	}

	.head {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 38px 30px 0;
	}

	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		opacity: 0.6;
	}

	.new,
	.newform button {
		min-height: 44px;
		padding: 0 12px;
		border: 0;
		background: none;
		color: var(--dawn);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.newform {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.newform input {
		min-height: 44px;
		padding: 10px 14px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 17px;
	}

	.err {
		color: var(--dawn);
		font-family: var(--font-sans);
		font-size: 11px;
	}

	.grid {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 22px 16px;
		padding: 26px 30px 60px;
	}

	@media (max-width: 640px) {
		.head {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
			padding-inline: 18px;
		}

		.newform {
			align-items: stretch;
			flex-wrap: wrap;
			width: 100%;
		}

		.newform input {
			width: 100%;
		}

		.grid {
			grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
			padding-inline: 18px;
		}
	}
</style>
