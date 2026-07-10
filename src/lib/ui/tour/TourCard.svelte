<script lang="ts">
	import { CREAM, FONT, INK } from '$lib/ui/tokens';
	import { comfortMode } from '$lib/ui/theme';
	import { tour } from './tour.svelte';

	let card = $state<HTMLElement | null>(null);
	let primary = $state<HTMLButtonElement | null>(null);

	const step = $derived(tour.step);
	const isWelcome = $derived(step?.id === 'welcome');
	const isLast = $derived(tour.index === tour.count - 1);

	// Land keyboard focus on the primary action at every stop, so Enter walks
	// the whole tour and screen readers follow along via the live region.
	$effect(() => {
		void tour.index;
		primary?.focus();
	});

	function onWindowKey(event: KeyboardEvent) {
		if (tour.active && event.key === 'Escape') {
			event.preventDefault();
			tour.skip();
		}
	}

	// The card is deliberately non-modal (the page behind is the exhibit), but
	// Tab wraps within it so keyboard users cannot silently drift out mid-step.
	function onCardKey(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !card) return;
		const nodes = [...card.querySelectorAll<HTMLElement>('button:not([disabled])')];
		if (nodes.length === 0) return;
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#if tour.active && step}
	<div
		class="card"
		role="dialog"
		aria-label="Guided tour"
		tabindex="-1"
		data-testid="tour-card"
		bind:this={card}
		onkeydown={onCardKey}
		style={`--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
	>
		<div aria-live="polite">
			<div class="eyebrow">
				<span>{step.eyebrow}</span>
				<span class="counter" data-testid="tour-counter">Step {tour.index + 1} of {tour.count}</span
				>
			</div>
			<h2>{step.title}</h2>
			<p class="body">{step.body}</p>
			{#if step.menuHint}
				<p class="body menu-hint">
					You will find it behind the menu button at the top of the screen.
				</p>
			{/if}
		</div>

		{#if isWelcome}
			<div class="choices">
				<button
					class="primary"
					type="button"
					data-testid="tour-comfort-yes"
					bind:this={primary}
					onclick={() => tour.applyComfort(true)}
				>
					{$comfortMode
						? 'Keep larger text and calmer motion'
						: 'Yes, larger text and calmer motion'}
				</button>
				<button
					class="quiet"
					type="button"
					data-testid="tour-comfort-no"
					onclick={() => tour.applyComfort(false)}
				>
					No thank you, keep it as it is
				</button>
			</div>
		{/if}

		<div class="controls">
			{#if !isWelcome && tour.index > 1}
				<button class="quiet" type="button" data-testid="tour-back" onclick={() => tour.back()}>
					Back
				</button>
			{/if}
			<span class="spacer"></span>
			<button class="skip" type="button" data-testid="tour-skip" onclick={() => tour.skip()}>
				Skip tour
			</button>
			{#if !isWelcome}
				<button
					class="primary"
					type="button"
					data-testid="tour-next"
					bind:this={primary}
					onclick={() => tour.next()}
				>
					{isLast ? 'Finish' : 'Next'}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.card {
		position: fixed;
		z-index: 51;
		bottom: 24px;
		left: 50%;
		width: min(620px, calc(100vw - 32px));
		max-height: 80vh;
		overflow-y: auto;
		padding: 24px 26px;
		/* Same warm-dawn family as the share dialog: a glow and a cool pool over ink. */
		background:
			radial-gradient(
				90% 60% at 92% -12%,
				color-mix(in srgb, var(--dawn) 38%, transparent),
				transparent 55%
			),
			radial-gradient(
				80% 72% at -12% 112%,
				color-mix(in srgb, #48929b 30%, transparent),
				transparent 60%
			),
			linear-gradient(158deg, color-mix(in srgb, var(--cream) 8%, var(--ink)) 0%, var(--ink) 100%);
		color: var(--cream);
		box-shadow: 0 30px 70px rgb(0 0 0 / 0.5);
		transform: translateX(-50%);
	}

	.eyebrow {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 12px;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	.counter {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	h2 {
		margin: 0 0 10px;
		font-family: var(--serif);
		font-size: 28px;
		font-weight: 500;
		line-height: 1.1;
	}

	.body {
		margin: 0;
		color: color-mix(in srgb, var(--cream) 90%, transparent);
		font-family: var(--serif);
		font-size: 18px;
		line-height: 1.5;
	}

	.menu-hint {
		display: none;
		margin-top: 10px;
		color: color-mix(in srgb, var(--cream) 72%, transparent);
		font-size: 16px;
	}

	@media (max-width: 760px) {
		.menu-hint {
			display: block;
		}
	}

	.choices {
		display: grid;
		gap: 10px;
		margin-top: 18px;
	}

	button {
		min-height: 48px;
		border: 0;
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.primary {
		padding: 0 20px;
		background: var(--cream);
		color: var(--ink);
		font-weight: 700;
	}

	.quiet {
		padding: 0 20px;
		background: color-mix(in srgb, var(--cream) 14%, transparent);
	}

	.skip {
		padding: 0 14px;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
	}

	.skip:hover,
	.skip:focus-visible {
		color: var(--cream);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 18px;
	}

	.spacer {
		flex: 1;
	}

	button:focus-visible {
		outline: 3px solid var(--dawn);
		outline-offset: 2px;
	}

	@media (max-width: 640px) {
		.card {
			right: 0;
			bottom: 0;
			left: 0;
			width: auto;
			max-height: 70vh;
			padding: 20px 18px calc(20px + env(safe-area-inset-bottom, 0px));
			transform: none;
		}

		h2 {
			font-size: 24px;
		}

		.body {
			font-size: 17px;
		}
	}
</style>
