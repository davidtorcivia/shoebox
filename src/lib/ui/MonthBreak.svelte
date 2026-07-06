<script lang="ts">
	interface Props {
		label: string;
	}

	let { label }: Props = $props();
	const month = $derived(label.split(' ')[0]?.toUpperCase() ?? label.toUpperCase());
</script>

<div class="month-break">
	<span class="eyebrow">{label}</span>
	<h2>{month}</h2>
</div>

<style>
	.month-break {
		margin: 0 0 0.875rem;
		padding-top: 0.625rem;
		color: var(--timeline-chrome, var(--ink));
	}

	.eyebrow {
		display: block;
		margin-bottom: 0.25rem;
		font-family: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
		font-size: 0.6rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--timeline-chrome-muted, color-mix(in srgb, var(--ink, #171412) 60%, transparent));
	}

	h2 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: clamp(1.4rem, 5vw, 1.95rem);
		font-weight: 800;
		line-height: 0.95;
		letter-spacing: 0;
	}
</style>
