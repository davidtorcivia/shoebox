<script lang="ts">
	// Pick a video poster frame from the pre-rendered storyboard sprite.
	// The sprite is a 10x10 grid of evenly-sampled frames (see spriteHandler),
	// giving 100 candidate frames with no extra work. Selecting a tile maps back
	// to a timestamp; the worker then extracts a full-resolution frame there.
	const COLS = 10;
	const ROWS = 10;
	const FRAMES = COLS * ROWS;
	const TILE_W = 128;
	const TILE_H = 72;

	let {
		open,
		spriteUrl,
		duration,
		currentPosterTime = null,
		saving = false,
		onClose,
		onChoose
	}: {
		open: boolean;
		spriteUrl: string;
		duration: number | null;
		currentPosterTime?: number | null;
		saving?: boolean;
		onClose: () => void;
		onChoose: (time: number) => void;
	} = $props();

	// Mid-frame time for tile i, so the extracted frame lands inside the sampled window.
	const timeForIndex = (i: number): number => {
		const total = duration && duration > 0 ? duration : FRAMES;
		return ((i + 0.5) / FRAMES) * total;
	};

	const nearestIndex = (time: number | null): number | null => {
		if (time == null || !duration || duration <= 0) return null;
		return Math.min(FRAMES - 1, Math.max(0, Math.round((time / duration) * FRAMES - 0.5)));
	};

	let selected = $state<number | null>(null);

	$effect(() => {
		if (open) selected = nearestIndex(currentPosterTime);
	});

	const frames = Array.from({ length: FRAMES }, (_, i) => i);
	const tileStyle = (i: number): string => {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		return [
			`background-image:url(${spriteUrl})`,
			`background-size:${TILE_W * COLS}px ${TILE_H * ROWS}px`,
			`background-position:-${col * TILE_W}px -${row * TILE_H}px`
		].join(';');
	};

	function confirm() {
		if (selected == null) return;
		onChoose(timeForIndex(selected));
	}
</script>

{#if open}
	<!-- Backdrop and pane are siblings: nesting a backdrop-filter inside
	     another element that also has one cancels the child's blur. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onClose}></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="Choose thumbnail" tabindex="-1">
		<header>
			<h2>Choose a thumbnail</h2>
			<button class="close" type="button" aria-label="Close" onclick={onClose}>×</button>
		</header>

		<div class="grid" data-testid="thumb-grid">
			{#each frames as i (i)}
				<button
					type="button"
					class="tile"
					class:selected={selected === i}
					aria-label={`Frame at ${timeForIndex(i).toFixed(1)} seconds`}
					aria-pressed={selected === i}
					style={tileStyle(i)}
					onclick={() => (selected = i)}
				></button>
			{/each}
		</div>

		<footer>
			<span class="hint">
				{#if selected != null}
					Frame at {timeForIndex(selected).toFixed(1)}s
				{:else}
					Tap a frame to pick it
				{/if}
			</span>
			<div class="actions">
				<button type="button" class="ghost" onclick={onClose}>Cancel</button>
				<button
					type="button"
					class="primary"
					data-testid="thumb-confirm"
					disabled={selected == null || saving}
					onclick={confirm}
				>
					{saving ? 'Saving…' : 'Set as thumbnail'}
				</button>
			</div>
		</footer>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgb(23 20 18 / 0.62);
	}

	.sheet {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 61;
		display: flex;
		flex-direction: column;
		width: min(880px, calc(100vw - 40px));
		max-height: min(84vh, 720px);
		overflow: hidden;
		background: var(--ink, #1a1714);
		color: var(--cream, #f3ece1);
		box-shadow: 0 18px 60px rgb(0 0 0 / 0.5);
		transform: translate(-50%, -50%);
	}

	/* Ethereal dialog material: gently dim and soften the page behind, and let
	   the pane itself go faintly translucent over a blur. The opaque styles
	   above are the fallback where backdrop-filter is absent or misbehaves. */
	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.scrim {
			background: rgb(23 20 18 / 0.45);
			backdrop-filter: blur(3px);
			-webkit-backdrop-filter: blur(3px);
		}

		.sheet {
			background: color-mix(in srgb, var(--ink, #1a1714) 87%, transparent);
			backdrop-filter: blur(10px) saturate(1.25);
			-webkit-backdrop-filter: blur(10px) saturate(1.25);
		}
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid color-mix(in srgb, var(--cream) 12%, transparent);
	}

	h2 {
		margin: 0;
		font-family: var(--font-serif, serif);
		font-size: 20px;
		font-weight: 500;
	}

	.close {
		border: 0;
		background: none;
		color: inherit;
		font-size: 26px;
		line-height: 1;
		cursor: pointer;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 6px;
		padding: 16px 20px;
		overflow-y: auto;
	}

	.tile {
		aspect-ratio: 16 / 9;
		width: 100%;
		padding: 0;
		border: 2px solid transparent;
		background-color: color-mix(in srgb, var(--cream) 8%, transparent);
		background-repeat: no-repeat;
		cursor: pointer;
		transition: border-color 0.1s ease;
	}

	.tile:hover {
		border-color: color-mix(in srgb, var(--cream) 45%, transparent);
	}

	.tile.selected {
		border-color: var(--dawn, #e0a479);
		outline: 2px solid var(--dawn, #e0a479);
		outline-offset: -2px;
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 14px 20px;
		border-top: 1px solid color-mix(in srgb, var(--cream) 12%, transparent);
	}

	.hint {
		font-family: var(--font-sans, sans-serif);
		font-size: 12px;
		letter-spacing: 0.06em;
		opacity: 0.75;
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	.ghost,
	.primary {
		min-height: 42px;
		padding: 0 18px;
		border: 0;
		font-family: var(--font-sans, sans-serif);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.ghost {
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: inherit;
	}

	.primary {
		background: var(--dawn, #e0a479);
		color: var(--ink, #1a1714);
	}

	.primary:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
