<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/ui/Avatar.svelte';
	import CroppedPortrait from '$lib/ui/CroppedPortrait.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import PersonYearSection from '$lib/ui/PersonYearSection.svelte';
	import { renderMarkdown } from '$lib/ui/markdown';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { PersonRef } from '$lib/domain/people-dto';

	let { data } = $props();
	let editingBio = $state(false);
	let bioDraft = $state('');
	let bioSaving = $state(false);
	let bioError = $state('');
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

	function startBioEdit() {
		bioDraft = person.bio ?? '';
		bioError = '';
		editingBio = true;
	}

	async function saveBio() {
		bioSaving = true;
		bioError = '';
		const res = await fetch(`/api/people/${person.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ bio: bioDraft })
		});
		bioSaving = false;
		if (!res.ok) {
			bioError = 'Could not save.';
			return;
		}
		editingBio = false;
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>{person.name} - Shoebox</title>
</svelte:head>

<div class="room" data-testid="person-room" data-accent={person.accentColor}>
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<div class="hero">
			<div class="portrait-stack">
				<div class="portrait" data-testid="person-portrait">
					{#if person.avatarUrl && person.avatarCrop}
						<CroppedPortrait url={person.avatarUrl} crop={person.avatarCrop} name={person.name} />
					{:else}
						<div class="portrait-fill" style:background={fallbackBackground}>
							<span>{initial}</span>
						</div>
					{/if}
				</div>
				{#if data.canEdit}
					<a class="portrait-action" href={resolve(`/people/${person.slug}/edit`)}
						>Choose portrait</a
					>
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
				{#if editingBio}
					<textarea
						class="bio-edit"
						data-testid="bio-textarea"
						bind:value={bioDraft}
						rows="8"
						placeholder="Their story, in markdown…"
					></textarea>
					<div class="bio-actions">
						<button data-testid="bio-save" onclick={saveBio} disabled={bioSaving}>Save</button>
						<button onclick={() => (editingBio = false)}>Cancel</button>
						{#if bioError}<span class="bio-err">{bioError}</span>{/if}
					</div>
				{:else}
					{#if person.bio}
						<div class="bio-text bio-md" data-testid="person-bio">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown sanitizes output -->
							{@html renderMarkdown(person.bio)}
						</div>
					{:else}
						<p class="bio-text" data-testid="person-bio">No story yet.</p>
					{/if}
					{#if data.canEditBio}
						<button class="edit" data-testid="edit-bio" onclick={startBioEdit}>
							{data.isLinked && !data.canEdit
								? 'Edit bio — you are linked to this person'
								: 'Edit bio'}
						</button>
					{/if}
				{/if}
			</section>
			<section class="family" data-testid="family-rows">
				<div class="label">Family</div>
				{#each familyRows as [label, members] (label)}
					<div class="group" data-testid={`family-row-${label.toLowerCase()}`}>
						<span class="group-label">{label}</span>
						<span class="names">
							{#each members as member (member.id)}
								<a class="person-link" href={resolve(`/people/${member.slug}`)}>
									<Avatar name={member.name} accentColor={member.accentColor} size={19} />
									{member.name}
								</a>
							{/each}
						</span>
					</div>
				{/each}
				{#if data.canEdit}
					<a
						class="editlink"
						href={resolve(`/people/${person.slug}/edit`)}
						data-testid="edit-person"
					>
						Edit person
					</a>
				{/if}
			</section>
		</div>

		{#each person.years as personYear (personYear.year)}
			<PersonYearSection
				personId={person.id}
				year={personYear.year}
				count={personYear.count}
				age={personYear.age}
				allYears={person.years.map((entry) => entry.year)}
			/>
		{/each}
	</section>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
		--timeline-chrome: var(--cream);
		--timeline-muted: color-mix(in srgb, var(--cream) 72%, transparent);
		--timeline-soft: color-mix(in srgb, var(--cream) 16%, transparent);
		--timeline-strong: color-mix(in srgb, var(--cream) 90%, transparent);
	}

	.page {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		background:
			radial-gradient(90% 70% at 100% 0%, rgb(23 20 18 / 0.08) 0%, transparent 64%),
			linear-gradient(180deg, rgb(23 20 18 / 0.2) 0%, rgb(23 20 18 / 0.72) 100%);
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

	.portrait-stack {
		display: grid;
		flex: none;
		gap: 10px;
	}

	.portrait {
		width: 168px;
		height: 210px;
		overflow: hidden;
	}

	.portrait-action {
		color: color-mix(in srgb, var(--cream) 68%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.18em;
		text-decoration: none;
		text-transform: uppercase;
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

	.bio-md :global(p) {
		margin: 0 0 12px;
	}

	.bio-md :global(em) {
		font-style: normal;
	}

	.bio-md :global(a) {
		color: var(--dawn);
		text-decoration: none;
	}

	.bio-edit {
		width: 100%;
		padding: 14px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
	}

	.bio-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}

	.bio-actions button,
	.edit {
		min-height: 44px;
		padding: 0 10px 0 0;
		border: 0;
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-align: left;
		text-transform: uppercase;
	}

	.bio-actions button[data-testid='bio-save'] {
		color: var(--dawn);
	}

	.bio-actions button:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	.bio-err {
		color: var(--dawn);
		font-family: var(--font-sans);
		font-size: 11px;
	}

	.edit {
		display: block;
		margin-top: 12px;
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
