<script lang="ts">
	import { ACCENTS } from '$lib/ui/tokens';

	let { value = $bindable() }: { value: string } = $props();
</script>

<div class="swatches" role="radiogroup" aria-label="Accent color">
	{#each ACCENTS as accent (accent.hex)}
		<button
			type="button"
			class="swatch"
			class:active={value === accent.hex}
			style:background={accent.hex}
			role="radio"
			aria-checked={value === accent.hex}
			aria-label={`Accent ${accent.hex}`}
			data-testid={`accent-${accent.hex.slice(1)}`}
			onclick={() => (value = accent.hex)}
		></button>
	{/each}
</div>

<style>
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.swatch {
		width: 44px;
		height: 44px;
		border: 0;
		cursor: pointer;
		padding: 0;
	}

	.swatch.active {
		outline: 3px solid var(--cream);
		outline-offset: 2px;
	}
</style>
