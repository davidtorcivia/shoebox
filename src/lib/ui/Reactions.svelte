<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';

	// Mirrors REACTION_EMOJI in src/lib/server/reactions.ts (kept small on purpose).
	const PALETTE = ['❤️', '😂', '😮', '😢', '👍', '🎉'];

	interface Reaction {
		emoji: string;
		count: number;
		mine: boolean;
	}

	let { itemId, reactions }: { itemId: string; reactions: Reaction[] } = $props();

	// Writable derived: resets to the server value when navigating between items,
	// but we overwrite it optimistically with each toggle's response.
	let list = $derived<Reaction[]>(reactions);
	let paletteOpen = $state(false);
	let busy = $state(false);

	async function react(emoji: string): Promise<void> {
		paletteOpen = false;
		if (busy) return;
		busy = true;
		const res = await fetch(`/api/items/${itemId}/reactions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji })
		});
		busy = false;
		if (res.ok) list = ((await res.json()) as { reactions: Reaction[] }).reactions;
	}
</script>

<div class="reactions" aria-label="Reactions">
	{#each list as reaction (reaction.emoji)}
		<!-- New chips bloom in, cleared ones shrink away, and the rest glide
		     aside; the count pops whenever it changes. -->
		<button
			type="button"
			class="chip"
			class:mine={reaction.mine}
			disabled={busy}
			aria-pressed={reaction.mine}
			onclick={() => react(reaction.emoji)}
			animate:flip={{ duration: 260 }}
			in:scale={{ duration: 240, start: 0.5 }}
			out:scale={{ duration: 180, start: 0.5 }}
		>
			<span class="emoji">{reaction.emoji}</span>
			{#key reaction.count}
				<span class="n" in:scale={{ duration: 220, start: 0.4 }}>{reaction.count}</span>
			{/key}
		</button>
	{/each}

	<div class="adder">
		<button
			type="button"
			class="add"
			aria-label="Add a reaction"
			aria-expanded={paletteOpen}
			onclick={() => (paletteOpen = !paletteOpen)}>＋</button
		>
		{#if paletteOpen}
			<div class="palette" role="menu" transition:scale={{ duration: 170, start: 0.86 }}>
				{#each PALETTE as emoji (emoji)}
					<button type="button" role="menuitem" onclick={() => react(emoji)}>{emoji}</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.reactions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 34px;
		padding: 0 10px;
		border: 1px solid color-mix(in srgb, var(--cream) 22%, transparent);
		background: color-mix(in srgb, var(--cream) 6%, transparent);
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 13px;
		transition:
			border-color 200ms ease,
			background 200ms ease;
	}

	.palette {
		transform-origin: 0 100%;
	}

	.chip.mine {
		border-color: var(--dawn);
		background: color-mix(in srgb, var(--dawn) 22%, transparent);
	}

	.emoji {
		font-size: 15px;
		line-height: 1;
	}

	.n {
		font-variant-numeric: tabular-nums;
	}

	.adder {
		position: relative;
	}

	.add {
		min-width: 34px;
		min-height: 34px;
		border: 1px dashed color-mix(in srgb, var(--cream) 30%, transparent);
		background: none;
		color: color-mix(in srgb, var(--cream) 72%, transparent);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}

	.palette {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: 5;
		display: flex;
		gap: 2px;
		padding: 4px;
		background: color-mix(in srgb, var(--ink, #171412) 94%, transparent);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--cream, #fff5e8) 12%, transparent),
			0 10px 28px rgb(0 0 0 / 0.45);
	}

	/* Ethereal chrome: faintly translucent ink over a soft blur, matching the
	   dialogs. The near-opaque background above is the no-backdrop fallback. */
	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.palette {
			background: color-mix(in srgb, var(--ink, #171412) 76%, transparent);
			backdrop-filter: blur(10px) saturate(1.25);
			-webkit-backdrop-filter: blur(10px) saturate(1.25);
		}
	}

	.palette button {
		min-width: 40px;
		min-height: 40px;
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 20px;
		line-height: 1;
	}

	.palette button:hover {
		background: color-mix(in srgb, var(--cream) 12%, transparent);
	}
</style>
