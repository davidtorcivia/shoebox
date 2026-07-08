<script lang="ts">
	import { formatTimecode } from '$lib/domain/timecode';
	import ScrubTrack from './ScrubTrack.svelte';

	interface VoiceNote {
		id: string;
		url: string;
		duration: number | null;
		author: string;
		mine: boolean;
		createdAt: number;
	}

	let { note, onDelete }: { note: VoiceNote; onDelete: (id: string) => void } = $props();

	let audio = $state<HTMLAudioElement | null>(null);
	let paused = $state(true);
	let currentTime = $state(0);
	// Seed from the recorded duration hint; the element's metadata refines it.
	// svelte-ignore state_referenced_locally
	let duration = $state(note.duration ?? 0);

	const recordedOn = $derived(
		new Date(note.createdAt).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);

	function toggle(): void {
		if (!audio) return;
		if (audio.paused) void audio.play();
		else audio.pause();
	}

	function seek(time: number): void {
		if (!audio) return;
		const limit = duration || audio.duration || 0;
		const clamped = Math.min(limit, Math.max(0, time));
		audio.currentTime = clamped;
		currentTime = clamped;
	}
</script>

<div class="note" class:playing={!paused}>
	<audio
		bind:this={audio}
		src={note.url}
		preload="metadata"
		onplay={() => (paused = false)}
		onpause={() => (paused = true)}
		ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
		ondurationchange={() => {
			if (audio && Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration;
		}}
		onended={() => (paused = true)}
	></audio>

	<button
		class="play"
		type="button"
		onclick={toggle}
		aria-label={paused ? 'Play voice memory' : 'Pause voice memory'}
	>
		{paused ? '▶' : '❚❚'}
	</button>

	<div class="body">
		<div class="scrub">
			<ScrubTrack {duration} {currentTime} onseek={seek} />
			<span class="time">{formatTimecode(currentTime)} / {formatTimecode(duration)}</span>
		</div>
		<div class="meta">
			<span class="who">{note.author}</span>
			<span class="dot" aria-hidden="true">·</span>
			<span class="when">{recordedOn}</span>
		</div>
	</div>

	{#if note.mine}
		<button
			class="del"
			type="button"
			aria-label="Delete voice memory"
			onclick={() => onDelete(note.id)}>×</button
		>
	{/if}
</div>

<style>
	.note {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 14px;
		align-items: center;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--cream) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--cream) 12%, transparent);
		border-radius: 2px;
		transition: border-color 200ms ease;
	}

	.note.playing {
		border-color: color-mix(in srgb, var(--dawn) 55%, transparent);
	}

	.play {
		display: grid;
		place-items: center;
		width: 42px;
		height: 42px;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--cream) 30%, transparent);
		border-radius: 50%;
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-serif);
		font-size: 15px;
		line-height: 1;
		transition:
			border-color 200ms ease,
			color 200ms ease;
	}

	.note.playing .play {
		border-color: var(--dawn);
		color: var(--dawn);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.scrub {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.scrub :global(.track) {
		flex: 1;
		min-width: 0;
	}

	.time {
		font-family: var(--font-sans);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
	}

	.meta {
		display: flex;
		gap: 7px;
		align-items: baseline;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.08em;
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}

	.who {
		color: color-mix(in srgb, var(--cream) 80%, transparent);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.del {
		align-self: start;
		width: 30px;
		height: 30px;
		padding: 0;
		border: 0;
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		cursor: pointer;
		font-size: 20px;
		line-height: 1;
		transition: color 200ms ease;
	}

	.del:hover {
		color: var(--dawn);
	}

	@media (max-width: 640px) {
		.time {
			display: none;
		}
	}
</style>
