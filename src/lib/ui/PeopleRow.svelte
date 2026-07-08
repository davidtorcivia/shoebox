<script lang="ts">
	import { resolve } from '$app/paths';
	import Avatar from '$lib/ui/Avatar.svelte';
	import { CREAM, FONT } from '$lib/ui/tokens';
	import type { ItemDTO } from '$lib/dto';

	interface Props {
		people: ItemDTO['people'];
	}

	let { people }: Props = $props();
</script>

<section
	class="social-row"
	aria-label="People"
	style:--cream={CREAM}
	style:--serif={FONT.serif}
	style:--sans={FONT.sans}
>
	<span class="label">People</span>
	<div class="content">
		{#if people.length === 0}
			<span class="empty">Unidentified</span>
		{:else}
			{#each people as person (person.id)}
				<a class="person" href={resolve(`/people/${person.slug}`)}>
					<Avatar
						name={person.name}
						accentColor={person.accentColor}
						size={19}
						avatarUrl={person.avatarUrl}
						avatarCrop={person.avatarCrop}
					/>
					<span class="name">{person.name}</span>
					{#if person.age != null}
						<span class="age">· {person.ageApprox ? 'circa ' : ''}age {person.age}</span>
					{/if}
				</a>
			{/each}
		{/if}
	</div>
</section>

<style>
	.social-row {
		display: grid;
		grid-template-columns: 5rem 1fr;
		gap: 1rem;
		align-items: center;
		min-height: 19px;
		color: var(--cream);
	}

	.label {
		font-family: var(--sans);
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.content {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: center;
	}

	.person {
		display: inline-flex;
		gap: 0.42rem;
		align-items: center;
		min-height: 19px;
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--cream);
		text-decoration: none;
	}

	.age,
	.empty {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}
</style>
