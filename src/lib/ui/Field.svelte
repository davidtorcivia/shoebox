<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props {
		label: string;
		name: string;
		type?: string;
		required?: boolean;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		value?: string;
	}
	let {
		label,
		name,
		type = 'text',
		required = false,
		autocomplete,
		value = $bindable('')
	}: Props = $props();
	const id = $derived(`field-${name}`);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<input {id} {name} {type} {required} {autocomplete} bind:value />
</div>

<style>
	.field {
		margin-bottom: 1.1rem;
	}

	label {
		display: block;
		margin-bottom: 0.4rem;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.72rem;
		opacity: 0.85;
	}

	input {
		width: 100%;
		min-height: 44px;
		padding: 0.6rem 0.8rem;
		border: 0;
		background: rgba(255, 245, 232, 0.14);
		color: inherit;
		font-family: var(--font-serif);
		font-size: 1rem;
	}

	:global(html.light) input {
		background: rgba(23, 20, 18, 0.08);
	}
</style>
