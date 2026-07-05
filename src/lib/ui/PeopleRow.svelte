<script lang="ts">
	import { CREAM, FONT, accentOn } from '$lib/ui/tokens';
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
				<a class="person" href={`/people/${person.id}`}>
					<span
						class="avatar"
						aria-hidden="true"
						style={`--avatar-bg: ${person.accentColor}; --avatar-fg: ${accentOn(person.accentColor)}`}
						>{person.name.slice(0, 1)}</span
					>
					<span class="name">{person.name}</span>
					{#if person.age != null}
						<span class="age">· age {person.age}</span>
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

	.avatar {
		display: inline-grid;
		width: 19px;
		height: 19px;
		place-items: center;
		font-family: var(--sans);
		font-size: 0.62rem;
		font-weight: 700;
		line-height: 1;
		color: var(--avatar-fg);
		background: var(--avatar-bg);
	}

	.age,
	.empty {
		font-family: var(--sans);
		font-size: 0.72rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}
</style>
