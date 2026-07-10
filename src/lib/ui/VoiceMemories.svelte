<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fade, fly } from 'svelte/transition';
	import VoiceNoteItem from './VoiceNoteItem.svelte';

	interface VoiceNote {
		id: string;
		url: string;
		mime: string;
		duration: number | null;
		author: string;
		authorAvatarUrl: string | null;
		authorAccentColor: string;
		mine: boolean;
		createdAt: number;
	}

	let { itemId, notes }: { itemId: string; notes: VoiceNote[] } = $props();

	let list = $derived<VoiceNote[]>(notes);
	let recording = $state(false);
	let elapsed = $state(0);
	let busy = $state(false);
	let error = $state('');
	let pendingDelete = $state<string | null>(null);

	let recorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let startedAt = 0;

	const supported =
		typeof navigator !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia &&
		typeof MediaRecorder !== 'undefined';

	function fmt(seconds: number): string {
		const s = Math.round(seconds);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	async function start(): Promise<void> {
		error = '';
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			error = 'Microphone permission denied.';
			return;
		}
		chunks = [];
		recorder = new MediaRecorder(stream);
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.onstop = () => void upload();
		recorder.start();
		recording = true;
		startedAt = Date.now();
		elapsed = 0;
		timer = setInterval(() => (elapsed = (Date.now() - startedAt) / 1000), 250);
	}

	function stop(): void {
		if (timer) clearInterval(timer);
		timer = null;
		recording = false;
		recorder?.stop();
		stream?.getTracks().forEach((track) => track.stop());
	}

	async function upload(): Promise<void> {
		const duration = (Date.now() - startedAt) / 1000;
		const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
		chunks = [];
		if (blob.size === 0) return;
		busy = true;
		const form = new FormData();
		form.set('audio', blob, 'memory.webm');
		form.set('duration', String(duration));
		const res = await fetch(`/api/items/${itemId}/voice`, { method: 'POST', body: form });
		busy = false;
		if (!res.ok) {
			error = 'Could not save the recording.';
			return;
		}
		const { note } = (await res.json()) as { note: VoiceNote };
		list = [...list, note];
	}

	async function confirmDelete(): Promise<void> {
		const id = pendingDelete;
		if (!id) return;
		pendingDelete = null;
		const res = await fetch(`/api/items/${itemId}/voice/${id}`, { method: 'DELETE' });
		if (res.ok) list = list.filter((note) => note.id !== id);
		else error = 'Could not delete the recording.';
	}
</script>

<section class="voice" aria-label="Voice memories">
	<div class="head">
		<span class="label">Voice memories</span>
		{#if supported}
			{#if recording}
				<button type="button" class="rec on" onclick={stop}>
					<span class="dot"></span> Stop · {fmt(elapsed)}
				</button>
			{:else}
				<button type="button" class="rec" disabled={busy} onclick={() => void start()}>
					{busy ? 'Saving…' : '● Record'}
				</button>
			{/if}
		{/if}
	</div>

	{#if !supported}
		<p class="hint">Recording isn’t supported in this browser.</p>
	{/if}
	{#if error}<p class="err">{error}</p>{/if}

	{#if list.length > 0}
		<ul class="notes">
			{#each list as note (note.id)}
				<li
					animate:flip={{ duration: 260 }}
					in:fly={{ y: 12, duration: 300 }}
					out:fade={{ duration: 170 }}
				>
					<VoiceNoteItem {note} onDelete={(id) => (pendingDelete = id)} />
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if pendingDelete}
	<!-- Backdrop and pane are siblings: nesting a backdrop-filter inside
	     another element that also has one cancels the child's blur. -->
	<div class="modal-backdrop"></div>
	<div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-voice-title">
		<div class="label">Confirm</div>
		<h2 id="delete-voice-title">Delete this voice memory?</h2>
		<p>This recording will be permanently removed from this moment.</p>
		<div class="modal-actions">
			<button class="secondary" type="button" onclick={() => (pendingDelete = null)}>Cancel</button>
			<button class="danger" type="button" onclick={() => void confirmDelete()}>Delete</button>
		</div>
	</div>
{/if}

<style>
	.voice {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.label {
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.rec {
		min-height: 34px;
		padding: 0 12px;
		border: 1px solid color-mix(in srgb, var(--cream) 26%, transparent);
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.rec.on {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border-color: var(--dawn);
		color: var(--dawn);
	}

	.rec .dot {
		width: 9px;
		height: 9px;
		background: var(--dawn);
		border-radius: 50%;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	.notes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.hint,
	.err {
		font-family: var(--font-sans);
		font-size: 0.72rem;
	}

	.err {
		color: var(--dawn);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgb(23 20 18 / 0.72);
	}

	.confirm-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 41;
		width: min(420px, calc(100vw - 40px));
		margin: 0;
		padding: 24px;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--dawn) 16%, transparent), transparent),
			color-mix(in srgb, var(--ink) 92%, var(--cream));
		box-shadow: 0 22px 70px rgb(0 0 0 / 0.38);
		transform: translate(-50%, -50%);
	}

	/* Ethereal dialog material: gently dim and soften the page behind, and let
	   the pane itself go faintly translucent over a blur. The opaque styles
	   above are the fallback where backdrop-filter is absent or misbehaves. */
	@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.modal-backdrop {
			background: rgb(23 20 18 / 0.45);
			backdrop-filter: blur(3px);
			-webkit-backdrop-filter: blur(3px);
		}

		.confirm-modal {
			background:
				linear-gradient(135deg, color-mix(in srgb, var(--dawn) 16%, transparent), transparent),
				color-mix(in srgb, color-mix(in srgb, var(--ink) 92%, var(--cream)) 87%, transparent);
			backdrop-filter: blur(10px) saturate(1.25);
			-webkit-backdrop-filter: blur(10px) saturate(1.25);
		}
	}

	.confirm-modal .label {
		opacity: 0.62;
	}

	.confirm-modal h2 {
		margin: 8px 0 10px;
		font-family: var(--font-serif);
		font-size: 28px;
		font-weight: 500;
		line-height: 1.08;
		color: var(--cream);
	}

	.confirm-modal p {
		margin: 0;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.45;
	}

	.modal-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 22px;
	}

	.modal-actions button {
		min-height: 42px;
		padding: 0 18px;
		border: 1px solid color-mix(in srgb, var(--cream) 26%, transparent);
		background: none;
		color: var(--cream);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.modal-actions .danger {
		border-color: transparent;
		background: color-mix(in srgb, var(--dawn) 86%, var(--ink));
	}
</style>
