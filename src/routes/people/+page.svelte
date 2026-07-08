<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Gradient from '$lib/ui/Gradient.svelte';
	import PersonCard from '$lib/ui/PersonCard.svelte';

	let { data } = $props();
	let creating = $state(false);
	let newName = $state('');
	let createError = $state('');
	const peopleGradient = {
		stops: ['#2B2621', '#A8D8EA', '#FFD9A8'] as [string, string, string],
		pools: [
			{ color: '#FA7B6255', pos: '4% 8%', size: '78% 54%' },
			{ color: '#5E6F4D66', pos: '96% 28%', size: '72% 58%' },
			{ color: '#C3272B44', pos: '42% 105%', size: '88% 48%' }
		]
	};

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
		await goto(resolve(`/people/${person.slug}/edit`));
	}
</script>

<svelte:head>
	<title>People - Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={peopleGradient.stops} pools={peopleGradient.pools} />
	<section class="page">
		<header class="head">
			<span class="label">People</span>
			{#if data.canCreate}
				{#if creating}
					<form class="newform" onsubmit={createPerson}>
						<input
							name="name"
							placeholder="Full name"
							bind:value={newName}
							required
							minlength="1"
						/>
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
		overflow: hidden;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.62) 100%);
		color: var(--cream);
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
