<script lang="ts">
	import { CREAM, FONT, INK } from '$lib/ui/tokens';
	import { comfortMode } from '$lib/ui/theme';
	import { tour } from './tour.svelte';

	type Rect = { top: number; left: number; width: number; height: number };

	let card = $state<HTMLElement | null>(null);
	let primary = $state<HTMLButtonElement | null>(null);
	let cardHeight = $state(0);
	let spotRect = $state<Rect | null>(null);
	let viewportH = $state(0);

	const step = $derived(tour.step);
	const isWelcome = $derived(step?.id === 'welcome');
	const isLast = $derived(tour.index === tour.count - 1);

	// Land keyboard focus on the primary action at every stop, so Enter walks
	// the whole tour and screen readers follow along via the live region.
	$effect(() => {
		void tour.index;
		primary?.focus({ preventScroll: true });
	});

	function visible(el: Element): boolean {
		if (el instanceof HTMLElement && typeof el.checkVisibility === 'function') {
			if (!el.checkVisibility()) return false;
		}
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	}

	function findSpot(selectors: string[] | undefined): Element | null {
		for (const selector of selectors ?? []) {
			const el = document.querySelector(selector);
			if (el && visible(el)) return el;
		}
		return null;
	}

	// Track the spotlighted element's rectangle while the tour is running. A
	// frame loop is the simple, robust way to follow scrolling, images loading
	// in, and layout shifts; it reads one rectangle per frame, which is cheap.
	$effect(() => {
		if (!tour.active) {
			spotRect = null;
			return;
		}
		let raf = 0;
		let scrolledForIndex = -1;
		const PAD = 8;
		const tick = () => {
			viewportH = window.innerHeight;
			const current = tour.step;
			const el = findSpot(current?.spot);
			if (el) {
				// Bring an off-screen target into view once per stop, then follow it.
				if (scrolledForIndex !== tour.index) {
					const r = el.getBoundingClientRect();
					if (r.top < 0 || r.bottom > window.innerHeight) {
						el.scrollIntoView({ block: 'center', behavior: 'auto' });
					}
					scrolledForIndex = tour.index;
				}
				const r = el.getBoundingClientRect();
				const next: Rect = {
					top: Math.round(r.top - PAD),
					left: Math.round(r.left - PAD),
					width: Math.round(r.width + PAD * 2),
					height: Math.round(r.height + PAD * 2)
				};
				if (
					!spotRect ||
					spotRect.top !== next.top ||
					spotRect.left !== next.left ||
					spotRect.width !== next.width ||
					spotRect.height !== next.height
				) {
					spotRect = next;
				}
			} else if (spotRect) {
				spotRect = null;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// The card sits dead centre unless that would cover the spotlight; then it
	// slides into the larger free region above or below the highlighted spot.
	const cardTop = $derived.by(() => {
		if (!spotRect || !viewportH || !cardHeight) return viewportH ? viewportH / 2 : null;
		const margin = 16;
		const centre = viewportH / 2;
		const overlaps =
			centre + cardHeight / 2 > spotRect.top &&
			centre - cardHeight / 2 < spotRect.top + spotRect.height;
		if (!overlaps) return centre;
		const above = spotRect.top;
		const below = viewportH - (spotRect.top + spotRect.height);
		const target = above >= below ? above / 2 : spotRect.top + spotRect.height + below / 2;
		return Math.min(Math.max(target, margin + cardHeight / 2), viewportH - margin - cardHeight / 2);
	});

	function onWindowKey(event: KeyboardEvent) {
		if (tour.active && event.key === 'Escape') {
			event.preventDefault();
			tour.skip();
		}
	}

	// The card is deliberately non-modal (the spotlighted control stays live so
	// people can try it), but Tab wraps within the card so keyboard users cannot
	// silently drift out mid-step.
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
	<!-- The veil: gently dim and soften everything except the spotlighted
	     control. Four panes leave a clear window over the target; with no
	     target the veil covers the whole page evenly. -->
	{#if spotRect}
		<div
			class="veil"
			style:inset="0 0 auto 0"
			style:height={`${Math.max(spotRect.top, 0)}px`}
		></div>
		<div
			class="veil"
			style:top={`${spotRect.top + spotRect.height}px`}
			style:left="0"
			style:right="0"
			style:bottom="0"
		></div>
		<div
			class="veil"
			style:top={`${Math.max(spotRect.top, 0)}px`}
			style:left="0"
			style:width={`${Math.max(spotRect.left, 0)}px`}
			style:height={`${spotRect.height}px`}
		></div>
		<div
			class="veil"
			style:top={`${Math.max(spotRect.top, 0)}px`}
			style:left={`${spotRect.left + spotRect.width}px`}
			style:right="0"
			style:height={`${spotRect.height}px`}
		></div>
		<div
			class="halo"
			style:top={`${spotRect.top}px`}
			style:left={`${spotRect.left}px`}
			style:width={`${spotRect.width}px`}
			style:height={`${spotRect.height}px`}
		></div>
	{:else}
		<div class="veil" style:inset="0"></div>
	{/if}

	<div
		class="card"
		role="dialog"
		aria-label="Guided tour"
		tabindex="-1"
		data-testid="tour-card"
		bind:this={card}
		bind:offsetHeight={cardHeight}
		onkeydown={onCardKey}
		style={`--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
		style:top={cardTop === null ? '50%' : `${cardTop}px`}
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
	/* A very slight dim and soften over everything the tour is not pointing at.
	   Where backdrop-filter is unavailable the dim alone carries the effect. */
	.veil {
		position: fixed;
		z-index: 45;
		background: rgb(23 20 18 / 0.4);
	}

	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.veil {
			background: rgb(23 20 18 / 0.32);
			backdrop-filter: blur(2.5px);
			-webkit-backdrop-filter: blur(2.5px);
		}
	}

	/* A soft dawn ring around the spotlighted control. pointer-events none so
	   the control underneath stays clickable for anyone who wants to try it. */
	.halo {
		position: fixed;
		z-index: 46;
		box-shadow:
			inset 0 0 0 2px color-mix(in srgb, var(--dawn, #fa7b62) 70%, transparent),
			0 0 24px color-mix(in srgb, var(--dawn, #fa7b62) 28%, transparent);
		pointer-events: none;
	}

	.card {
		position: fixed;
		z-index: 51;
		top: 50%;
		left: 50%;
		width: min(560px, calc(100vw - 32px));
		max-height: min(76vh, calc(100vh - 32px));
		overflow-y: auto;
		padding: 24px 26px;
		/* Ethereal material: room-family tints over a faintly translucent ink
		   pane that blurs the page behind it. The near-opaque gradient is the
		   fallback where backdrop-filter is absent or misbehaves. */
		background:
			radial-gradient(
				90% 60% at 92% -12%,
				color-mix(in srgb, var(--dawn) 34%, transparent),
				transparent 55%
			),
			radial-gradient(
				80% 72% at -12% 112%,
				color-mix(in srgb, #48929b 28%, transparent),
				transparent 60%
			),
			linear-gradient(
				158deg,
				color-mix(in srgb, var(--cream) 8%, var(--ink)) 0%,
				color-mix(in srgb, var(--ink) 96%, transparent) 100%
			);
		color: var(--cream);
		box-shadow: 0 30px 70px rgb(0 0 0 / 0.5);
		transform: translate(-50%, -50%);
	}

	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.card {
			background:
				radial-gradient(
					90% 60% at 92% -12%,
					color-mix(in srgb, var(--dawn) 34%, transparent),
					transparent 55%
				),
				radial-gradient(
					80% 72% at -12% 112%,
					color-mix(in srgb, #48929b 28%, transparent),
					transparent 60%
				),
				linear-gradient(
					158deg,
					color-mix(in srgb, var(--cream) 10%, color-mix(in srgb, var(--ink) 84%, transparent)) 0%,
					color-mix(in srgb, var(--ink) 84%, transparent) 100%
				);
			backdrop-filter: blur(18px) saturate(1.35);
			-webkit-backdrop-filter: blur(18px) saturate(1.35);
		}
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
			padding: 20px 18px;
		}

		h2 {
			font-size: 24px;
		}

		.body {
			font-size: 17px;
		}
	}
</style>
