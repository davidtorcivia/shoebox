<script lang="ts">
	import type { PersonListDTO } from '$lib/domain/people-dto';
	import { personRoomFor } from '$lib/ui/tokens';
	import CroppedPortrait from './CroppedPortrait.svelte';

	let { person }: { person: PersonListDTO } = $props();

	const stops = $derived(personRoomFor(person.accentColor).stops);
	const fillBackground = $derived(
		[
			`linear-gradient(145deg, color-mix(in srgb, ${stops[2]} 82%, var(--cream)) 0%, transparent 32%)`,
			`linear-gradient(30deg, ${stops[0]} 0%, ${stops[1]} 52%, ${stops[2]} 118%)`,
			`linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${stops[0]} 80%, var(--ink)) 100%)`
		].join(', ')
	);
	const lifespan = $derived.by(() => {
		const born = person.birthdate?.slice(0, 4);
		const died = person.deathDate?.slice(0, 4);
		if (born && died) return `${born}-${died}`;
		if (born) return `b. ${born}`;
		return '';
	});
	const initial = $derived(person.name.trim().charAt(0).toUpperCase());
</script>

<a class="card" href={`/people/${person.id}`} data-testid="person-card">
	<div class="square">
		{#if person.avatarUrl && person.avatarCrop}
			<div class="portrait-slot" data-testid="person-card-photo">
				<CroppedPortrait url={person.avatarUrl} crop={person.avatarCrop} name={person.name} />
			</div>
		{:else}
			<div
				class="fill"
				data-testid="person-card-fill"
				style:background={fillBackground}
			>
				<span>{initial}</span>
			</div>
		{/if}
	</div>
	<span class="name">{person.name}</span>
	<span class="life">{lifespan || ' '}</span>
</a>

<style>
	.card {
		display: block;
		min-width: 0;
		color: var(--cream);
		text-decoration: none;
	}

	.square {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
		background: color-mix(in srgb, var(--cream) 8%, var(--ink));
	}

	.square::after {
		position: absolute;
		inset: 0;
		content: '';
		background:
			linear-gradient(180deg, color-mix(in srgb, var(--cream) 22%, transparent) 0%, transparent 38%),
			linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--ink) 28%, transparent) 100%);
		pointer-events: none;
	}

	.portrait-slot {
		position: absolute;
		top: -12.5%;
		left: 0;
		width: 100%;
		height: 125%;
	}

	.fill {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.fill span {
		font-family: var(--font-serif);
		font-size: 64px;
		line-height: 1;
		color: var(--cream);
	}

	.name {
		display: block;
		margin-top: 8px;
		overflow: hidden;
		font-family: var(--font-serif);
		font-size: 19px;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.life {
		display: block;
		min-height: 12px;
		margin-top: 3px;
		overflow: hidden;
		font-family: var(--font-sans);
		font-size: 10px;
		line-height: 1.2;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.6;
	}
</style>
