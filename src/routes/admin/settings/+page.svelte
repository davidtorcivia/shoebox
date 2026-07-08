<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let siteName = $state('');
	const holidaySet = new SvelteSet<string>();
	let saved = $state(false);

	$effect(() => {
		siteName = data.settings.siteName;
		holidaySet.clear();
		for (const id of data.settings.holidaySet) holidaySet.add(id);
	});

	function toggle(id: string): void {
		if (holidaySet.has(id)) holidaySet.delete(id);
		else holidaySet.add(id);
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const res = await fetch('/api/admin/settings', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ siteName, holidaySet: [...holidaySet] })
		});
		if (!res.ok) {
			alert('Could not save settings.');
			return;
		}
		saved = true;
		setTimeout(() => (saved = false), 1500);
		await invalidateAll();
	}
</script>

<h2>Settings</h2>
<form onsubmit={save}>
	<label class="stack" for="site-name">
		Site name
		<input id="site-name" bind:value={siteName} maxlength="80" required />
	</label>

	<fieldset>
		<legend>Holidays tagged automatically</legend>
		<div class="checks">
			{#each data.holidayOptions as holiday (holiday.id)}
				<label class="row">
					<input
						type="checkbox"
						checked={holidaySet.has(holiday.id)}
						onchange={() => toggle(holiday.id)}
					/>
					<span>{holiday.label}</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<button type="submit">{saved ? 'Saved' : 'Save settings'}</button>
</form>

<h3>Platform features</h3>
<ul class="features">
	<li>Ingestion folder <strong>{data.features.ingestion ? 'on' : 'off'}</strong></li>
	<li>Face suggestions <strong>{data.features.faces ? 'on' : 'off'}</strong></li>
	<li>
		Server derivatives and export
		<strong>{data.features.serverDerivatives ? 'on' : 'off'}</strong>
	</li>
</ul>
<p class="note">Feature flags come from the deployment platform and are read-only here.</p>

<style>
	h2 {
		margin: 0 0 16px;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 500;
	}

	h3 {
		margin: 34px 0 8px;
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		opacity: var(--chrome-opacity, 0.5);
		text-transform: uppercase;
	}

	form {
		display: flex;
		max-width: 560px;
		flex-direction: column;
		gap: 18px;
	}

	.stack,
	legend {
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	input:not([type='checkbox']) {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background: color-mix(in srgb, currentColor 8%, transparent);
		color: inherit;
		font-family: var(--serif);
		font-size: 17px;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.checks {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		margin-top: 8px;
		gap: 4px 16px;
	}

	.row {
		display: flex;
		min-height: 48px;
		align-items: center;
		gap: 10px;
		font-family: var(--serif);
		font-size: 17px;
	}

	input[type='checkbox'] {
		width: 22px;
		height: 22px;
		accent-color: currentColor;
	}

	button {
		min-height: 48px;
		align-self: flex-start;
		padding: 0 20px;
		border: 0;
		background: color-mix(in srgb, currentColor 12%, transparent);
		color: inherit;
		cursor: pointer;
		font-family: var(--sans);
		font-size: 13px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.features {
		display: grid;
		max-width: 560px;
		margin: 0;
		padding: 0;
		gap: 8px;
		list-style: none;
	}

	.features li {
		display: flex;
		min-height: 40px;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		font-family: var(--serif);
		font-size: 16px;
	}

	.features strong {
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.note {
		max-width: 560px;
		font-family: var(--sans);
		font-size: 13px;
		opacity: var(--chrome-opacity, 0.5);
	}

	:is(input, button):focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
