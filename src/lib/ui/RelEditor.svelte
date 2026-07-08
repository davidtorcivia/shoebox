<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import { canonicalRel, type Rel } from '$lib/domain/relationships';
	import type { FamilyRefs, PersonRef } from '$lib/domain/people-dto';

	let {
		personId,
		others,
		family: initialFamily
	}: { personId: string; others: PersonRef[]; family: FamilyRefs } = $props();

	type Kind = 'parent' | 'child' | 'spouse' | 'sibling';
	type Row = {
		label: string;
		key: string;
		list: PersonRef[];
		kind: Kind | null;
	};

	// svelte-ignore state_referenced_locally
	let family = $state(initialFamily);
	let kind = $state<Kind>('spouse');
	let otherId = $state('');
	let relError = $state('');

	function relFor(k: Kind, other: string): Rel {
		if (k === 'parent') return { personA: other, personB: personId, type: 'parent-of' };
		if (k === 'child') return { personA: personId, personB: other, type: 'parent-of' };
		return canonicalRel({
			personA: personId,
			personB: other,
			type: k === 'spouse' ? 'spouse-of' : 'sibling-of'
		});
	}

	async function patch(body: { add?: Rel[]; remove?: Rel[] }) {
		relError = '';
		const res = await fetch(`/api/people/${personId}/relationships`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			relError =
				res.status === 409
					? 'That relationship already exists.'
					: 'Could not update relationships.';
			return;
		}
		family = ((await res.json()) as { family: FamilyRefs }).family;
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!otherId) return;
		await patch({ add: [relFor(kind, otherId)] });
		otherId = '';
	}

	const rows = $derived(
		[
			{ label: 'Parents', key: 'parents', list: family.parents, kind: 'parent' },
			{ label: 'Spouse', key: 'spouse', list: family.spouses, kind: 'spouse' },
			{ label: 'Children', key: 'children', list: family.children, kind: 'child' },
			{ label: 'Siblings', key: 'siblings', list: family.siblings, kind: 'sibling' },
			{ label: 'Grandparents', key: 'grandparents', list: family.grandparents, kind: null },
			{ label: 'Grandkids', key: 'grandkids', list: family.grandchildren, kind: null }
		].filter((row): row is Row => row.list.length > 0)
	);
</script>

<div class="releditor" data-testid="rel-editor">
	<form class="addrow" onsubmit={add}>
		<select bind:value={kind} data-testid="rel-kind" aria-label="Relationship">
			<option value="spouse">Spouse</option>
			<option value="parent">Parent</option>
			<option value="child">Child</option>
			<option value="sibling">Sibling</option>
		</select>
		<select bind:value={otherId} data-testid="rel-person" aria-label="Person">
			<option value="" disabled>Choose a person...</option>
			{#each others as other (other.id)}
				<option value={other.id}>{other.name}</option>
			{/each}
		</select>
		<button type="submit" data-testid="rel-add">Add</button>
		{#if relError}<span class="err" data-testid="rel-error">{relError}</span>{/if}
	</form>

	{#each rows as row (row.key)}
		<div class="grp" data-testid={`rel-row-${row.key}`}>
			<span class="g">{row.label}</span>
			<span class="names">
				{#each row.list as member (member.id)}
					<span class="p">
						<Avatar
							name={member.name}
							accentColor={member.accentColor}
							size={19}
							avatarUrl={member.avatarUrl}
							avatarCrop={member.avatarCrop}
						/>
						<a href={`/people/${member.slug}`}>{member.name}</a>
						{#if row.kind}
							<button
								type="button"
								class="x"
								aria-label={`Remove ${member.name}`}
								onclick={() => {
									if (row.kind) void patch({ remove: [relFor(row.kind, member.id)] });
								}}
							>
								x
							</button>
						{/if}
					</span>
				{/each}
			</span>
		</div>
	{/each}
</div>

<style>
	.addrow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 20px;
	}

	select {
		min-height: 44px;
		border: 0;
		background-color: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		color-scheme: dark;
		font-family: var(--font-serif);
		font-size: 16px;
		padding: 10px 2.2em 10px 12px;
	}

	.addrow button[type='submit'] {
		min-height: 44px;
		border: 0;
		background: var(--person-accent, var(--dawn));
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		padding: 0 18px;
		text-transform: uppercase;
	}

	.grp {
		display: flex;
		align-items: baseline;
		gap: 14px;
		margin-bottom: 14px;
	}

	.g {
		flex: none;
		width: 96px;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		font-family: var(--font-sans);
		font-size: 9.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		font-family: var(--font-serif);
		font-size: 17px;
	}

	.p {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	a {
		color: var(--cream);
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.x {
		min-width: 32px;
		min-height: 32px;
		border: 0;
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		cursor: pointer;
		font-size: 16px;
	}

	.err {
		color: var(--person-accent, var(--dawn));
		font-family: var(--font-sans);
		font-size: 11px;
	}

	@media (max-width: 640px) {
		.grp {
			display: block;
		}

		.g {
			display: block;
			width: auto;
			margin-bottom: 8px;
		}
	}
</style>
