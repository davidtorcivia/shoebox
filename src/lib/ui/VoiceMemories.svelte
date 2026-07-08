<script lang="ts">
	interface VoiceNote {
		id: string;
		url: string;
		mime: string;
		duration: number | null;
		author: string;
		mine: boolean;
		createdAt: number;
	}

	let { itemId, notes }: { itemId: string; notes: VoiceNote[] } = $props();

	let list = $derived<VoiceNote[]>(notes);
	let recording = $state(false);
	let elapsed = $state(0);
	let busy = $state(false);
	let error = $state('');

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

	async function remove(id: string): Promise<void> {
		if (!confirm('Delete this voice memory?')) return;
		const res = await fetch(`/api/items/${itemId}/voice/${id}`, { method: 'DELETE' });
		if (res.ok) list = list.filter((note) => note.id !== id);
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
				<li>
					<audio controls preload="none" src={note.url}></audio>
					<span class="by">{note.author}</span>
					{#if note.mine}
						<button
							type="button"
							class="del"
							aria-label="Delete memory"
							onclick={() => void remove(note.id)}>×</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

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
		gap: 8px;
	}

	.notes li {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	audio {
		height: 34px;
		max-width: min(320px, 68vw);
	}

	.by {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
	}

	.del {
		min-width: 28px;
		min-height: 28px;
		border: 0;
		background: none;
		color: color-mix(in srgb, var(--cream) 55%, transparent);
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
	}

	.hint,
	.err {
		font-family: var(--font-sans);
		font-size: 0.72rem;
	}

	.err {
		color: var(--dawn);
	}
</style>
