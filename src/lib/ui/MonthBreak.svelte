<script lang="ts">
	interface Props {
		label: string;
	}

	let { label }: Props = $props();
	const month = $derived(label.split(' ')[0]?.toUpperCase() ?? label.toUpperCase());
</script>

<div class="month-break">
	<span>{label}</span>
	<h2>{month}</h2>
</div>

<style>
	.month-break {
		margin: 0 0 0.875rem;
		padding-top: 0.625rem;
		color: var(--timeline-chrome, var(--ink));
	}

	span {
		display: block;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--timeline-muted, rgba(23, 20, 18, 0.62));
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
