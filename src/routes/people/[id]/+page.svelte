<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import CroppedPortrait from '$lib/ui/CroppedPortrait.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { PersonRef } from '$lib/domain/people-dto';

	let { data } = $props();
	const person = $derived(data.person);
	const room = $derived(personRoomFor(person.accentColor));
	const fallbackBackground = $derived(
		[
			`linear-gradient(145deg, color-mix(in srgb, ${room.stops[2]} 82%, var(--cream)) 0%, transparent 34%)`,
			`linear-gradient(28deg, ${room.stops[0]} 0%, ${room.stops[1]} 54%, ${room.stops[2]} 118%)`
		].join(', ')
	);
	const initial = $derived(person.name.trim().charAt(0).toUpperCase());

	const eyebrow = $derived.by(() => {
		const born = person.birthdate?.slice(0, 4);
		const died = person.deathDate?.slice(0, 4);
		const life = born ? (died ? `${born} — ${died}` : `b. ${born}`) : null;
		const place = person.birthPlace ? `Born ${person.birthPlace}` : null;
		return [life, place].filter(Boolean).join(' · ');
	});
	const onFilm = $derived.by(() => {
		const span = person.stats.onFilm;
		if (!span) return '—';
		return span.from === span.to ? String(span.from) : `${span.from}–${span.to}`;
	});
	const familyRows = $derived(
		(
			[
				['Parents', person.family.parents],
				['Spouse', person.family.spouses],
				['Children', person.family.children],
				['Siblings', person.family.siblings],
				['Grandparents', person.family.grandparents],
				['Grandkids', person.family.grandchildren]
			] as [string, PersonRef[]][]
		).filter(([, members]) => members.length > 0)
	);
</script>

<svelte:head>
	<title>{person.name} - Shoebox</title>
</svelte:head>

<div class="room" data-testid="person-room" data-accent={person.accentColor}>
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<div class="hero">
			<div class="portrait" data-testid="person-portrait">
				{#if person.avatarUrl && person.avatarCrop}
					<CroppedPortrait url={person.avatarUrl} crop={person.avatarCrop} name={person.name} />
				{:else}
					<div class="portrait-fill" style:background={fallbackBackground}>
						<span>{initial}</span>
					</div>
				{/if}
			</div>
			<div class="who">
				{#if eyebrow}
					<div class="eyebrow" data-testid="person-eyebrow">{eyebrow}</div>
				{/if}
				<h1 data-testid="person-name">{person.name}</h1>
				<div class="stats">
					<span><b data-testid="stat-moments">{person.stats.moments}</b>Moments</span>
					<span><b data-testid="stat-onfilm">{onFilm}</b>On film</span>
					<span><b data-testid="stat-albums">{person.stats.albums}</b>Albums</span>
				</div>
			</div>
		</div>

		<div class="body">
			<section class="bio">
				<div class="label">Story</div>
				<p class="bio-text" data-testid="person-bio">{person.bio ?? 'No story yet.'}</p>
			</section>
			<section class="family" data-testid="family-rows">
				<div class="label">Family</div>
				{#each familyRows as [label, members] (label)}
					<div class="group" data-testid={`family-row-${label.toLowerCase()}`}>
						<span class="group-label">{label}</span>
						<span class="names">
							{#each members as member (member.id)}
								<a class="person-link" href={`/people/${member.id}`}>
									<Avatar name={member.name} accentColor={member.accentColor} size={19} />
									{member.name}
								</a>
							{/each}
						</span>
					</div>
				{/each}
				{#if data.canEdit}
					<a class="editlink" href={`/people/${person.id}/edit`} data-testid="edit-person">
						Edit person
					</a>
				{/if}
			</section>
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
		background: linear-gradient(180deg, rgb(23 20 18 / 0.05) 0%, rgb(23 20 18 / 0.58) 100%);
		color: var(--cream);
	}

	.hero {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		gap: 30px;
		padding: 38px 30px 0;
	}

	.portrait {
		width: 168px;
		height: 210px;
		flex: none;
		overflow: hidden;
	}

	.portrait-fill {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
	}

	.portrait-fill span {
		font-family: var(--font-serif);
		font-size: 72px;
		line-height: 1;
	}

	.who {
		display: flex;
		height: 210px;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.eyebrow {
		margin: 2px 0 10px;
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 58px;
		font-weight: 400;
		letter-spacing: 0;
		line-height: 0.95;
	}

	.stats {
		display: flex;
		gap: 34px;
		margin-top: auto;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.stats b {
		display: block;
		margin-bottom: 3px;
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 22px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	.body {
		position: relative;
		z-index: 1;
		display: flex;
		gap: 44px;
		padding: 30px 30px 0;
	}

	.bio {
		min-width: 0;
		flex: 1.45;
	}

	.bio-text {
		margin: 0;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
	}

	.label {
		margin-bottom: 14px;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	.family {
		min-width: 0;
		flex: 1;
	}

	.group {
		display: flex;
		align-items: baseline;
		gap: 14px;
		margin-bottom: 16px;
	}

	.group-label {
		width: 82px;
		flex: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		font-family: var(--font-sans);
		font-size: 9.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		font-family: var(--font-serif);
		font-size: 17px;
	}

	.person-link {
		display: inline-flex;
		min-height: 24px;
		align-items: center;
		gap: 8px;
		color: var(--cream);
		text-decoration: none;
	}

	.editlink {
		display: inline-block;
		min-height: 44px;
		margin-top: 8px;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		line-height: 44px;
		text-decoration: none;
		text-transform: uppercase;
	}

	@media (max-width: 720px) {
		.hero {
			gap: 18px;
			padding-inline: 18px;
		}

		.portrait {
			width: 128px;
			height: 160px;
		}

		.who {
			height: 160px;
		}

		h1 {
			font-size: 34px;
		}

		.stats {
			gap: 20px;
		}

		.body {
			flex-direction: column;
			gap: 30px;
			padding-inline: 18px;
		}
	}
</style>
