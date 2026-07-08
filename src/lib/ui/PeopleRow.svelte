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

	// Desktop shows the labelled row with each avatar + full name. Mobile is
	// decluttered: bare avatars that reveal the name (a link) when tapped.
	const expanded = new SvelteSet<string>();
	function toggle(id: string): void {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}
	function ageText(person: ItemDTO['people'][number]): string {
		return person.age != null ? ` · ${person.ageApprox ? 'circa ' : ''}age ${person.age}` : '';
	}
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
				<a class="person desktop" href={resolve(`/people/${person.slug}`)}>
					<Avatar
						name={person.name}
						accentColor={person.accentColor}
						size={19}
						avatarUrl={person.avatarUrl}
						avatarCrop={person.avatarCrop}
					/>
					<span class="name">{person.name}{ageText(person)}</span>
				</a>
				<span class="person mobile" class:expanded={expanded.has(person.id)}>
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
						<a class="name" href={resolve(`/people/${person.slug}`)}>{person.name}{ageText(person)}</a>
					{/if}
				</span>
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

	.person.mobile {
		display: none;
	}

	.person.desktop {
		display: inline-flex;
		gap: 0.42rem;
		align-items: center;
		min-height: 19px;
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--cream);
		text-decoration: none;
	}

	.name {
		font-family: var(--serif);
		font-size: 1rem;
		color: var(--cream);
		text-decoration: none;
	}

	.empty {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}

	/* Mobile: drop the label, show avatars only, reveal names on tap. */
	@media (max-width: 760px) {
		.social-row {
			display: block;
		}

		.label {
			display: none;
		}

		.content {
			gap: 0.5rem 0.6rem;
			min-height: 34px;
		}

		.person.desktop {
			display: none;
		}

		.person.mobile {
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

		.mobile .name:hover {
			text-decoration: underline;
			text-underline-offset: 3px;
		}
	}
</style>
