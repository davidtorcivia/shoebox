<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { CREAM, FONT } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/dto';

	interface Props {
		people: ItemDTO['people'];
	}

	let { people }: Props = $props();

	// People show as bare avatars; tapping one reveals the name (a link to the
	// person). Keeps the media page uncluttered, especially on mobile.
	const expanded = new SvelteSet<string>();
	function toggle(id: string): void {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}
</script>

<section
	class="social-row"
	aria-label="People"
	style:--cream={CREAM}
	style:--serif={FONT.serif}
	style:--sans={FONT.sans}
>
	{#if people.length === 0}
		<span class="empty">Unidentified</span>
	{:else}
		{#each people as person (person.id)}
			<span class="person" class:expanded={expanded.has(person.id)}>
				<button
					class="avatar-btn"
					type="button"
					onclick={() => toggle(person.id)}
					aria-expanded={expanded.has(person.id)}
					aria-label={person.name}
					title={person.name}
				>
					<Avatar
						name={person.name}
						accentColor={person.accentColor}
						size={34}
						avatarUrl={person.avatarUrl}
						avatarCrop={person.avatarCrop}
					/>
				</button>
				{#if expanded.has(person.id)}
					<a class="name" href={resolve(`/people/${person.slug}`)}>
						{person.name}{#if person.age != null}<span class="age">
								· {person.ageApprox ? 'circa ' : ''}age {person.age}</span
							>{/if}
					</a>
				{/if}
			</span>
		{/each}
	{/if}
</section>

<style>
	.social-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.6rem;
		align-items: center;
		min-height: 34px;
		color: var(--cream);
	}

	.person {
		display: inline-flex;
		gap: 0.42rem;
		align-items: center;
	}

	.avatar-btn {
		display: inline-grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		margin: -5px 0;
		padding: 5px;
		border: 0;
		background: none;
		cursor: pointer;
	}

	.name {
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--cream);
		text-decoration: none;
	}

	.name:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.age {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}

	.empty {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}
</style>
