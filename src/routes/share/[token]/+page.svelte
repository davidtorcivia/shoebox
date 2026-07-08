<script lang="ts">
	import { enhance } from '$app/forms';
	import ShareGallery from '$lib/ui/share/ShareGallery.svelte';
	import ShareRoom from '$lib/ui/share/ShareRoom.svelte';
	import ShareViewer from '$lib/ui/share/ShareViewer.svelte';
	import { CREAM, FONT, GRAIN_URI, INK, paletteFor } from '$lib/ui/tokens';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let viewerIndex = $state<number | null>(null);

	const palette = paletteFor(1975);
	const room =
		`background:` +
		`radial-gradient(${palette.pools[0].size} at ${palette.pools[0].pos}, ${palette.pools[0].color}, transparent),` +
		`linear-gradient(160deg, ${palette.stops[0]}, ${palette.stops[1]} 55%, ${palette.stops[2]})`;
	const themeVars = `--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`;
	const albumYear = $derived(
		data.state === 'ok' && data.items[0]?.date.dateStart
			? Number(data.items[0].date.dateStart.slice(0, 4))
			: 1975
	);
</script>

{#if data.state === 'password'}
	<main class="room" style={`${room}; ${themeVars}`}>
		<div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
		<header class="share-top">
			<div class="wordmark" data-testid="share-wordmark">Shoebox</div>
		</header>
		<section class="gate">
			<p class="eyebrow">A shared memory from Shoebox</p>
			<h1>This memory is protected</h1>
			<form method="POST" action="?/unlock" use:enhance>
				<label for="share-password">Password</label>
				<input id="share-password" name="password" type="password" autocomplete="off" required />
				{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
				<button type="submit">Open</button>
			</form>
		</section>
	</main>
{:else if data.state === 'expired'}
	<main class="room" style={`${room}; ${themeVars}`}>
		<div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
		<header class="share-top">
			<div class="wordmark" data-testid="share-wordmark">Shoebox</div>
		</header>
		<section class="gate">
			<p class="eyebrow">A shared memory from Shoebox</p>
			<h1>This share link has expired</h1>
			<p class="sub">Ask whoever sent it for a fresh link.</p>
		</section>
	</main>
{:else if data.share.targetType === 'album' || data.share.targetType === 'favorites'}
	<ShareRoom stops={paletteFor(albumYear).stops}>
		<header class="album-head">
			<p class="eyebrow">
				{data.share.targetType === 'favorites' ? 'A shared collection' : 'A shared album'}
			</p>
			<h1>{data.album?.title}</h1>
			{#if data.album?.description}<p class="desc">{data.album.description}</p>{/if}
		</header>
		<ShareGallery items={data.items} onOpen={(index) => (viewerIndex = index)} />
	</ShareRoom>
	{#if viewerIndex !== null}
		<ShareViewer
			items={data.items}
			index={viewerIndex}
			allowDownload={data.share.allowDownload}
			onClose={() => (viewerIndex = null)}
			onNavigate={(index) => (viewerIndex = index)}
		/>
	{/if}
{:else}
	<div class="item-wordmark" data-testid="share-wordmark">Shoebox</div>
	<ShareViewer items={data.items} index={0} allowDownload={data.share.allowDownload} single />
{/if}

<style>
	.room {
		position: relative;
		min-height: 100vh;
		padding: 24px;
		overflow: hidden;
		color: var(--cream);
	}

	.grain {
		position: absolute;
		inset: 0;
		opacity: 0.5;
		mix-blend-mode: overlay;
		pointer-events: none;
	}

	.gate {
		position: relative;
		z-index: 1;
		width: min(440px, 100%);
		margin: min(18vh, 10rem) auto 0;
	}

	.share-top {
		position: relative;
		z-index: 1;
		display: flex;
		min-height: 56px;
		align-items: center;
	}

	.eyebrow,
	label,
	button,
	.wordmark,
	.error {
		font-family: var(--sans);
	}

	.eyebrow,
	label,
	button,
	.wordmark {
		font-size: 12px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	.wordmark {
		font-weight: 800;
		opacity: 0.92;
		color: var(--cream);
	}

	.eyebrow {
		margin: 0 0 12px;
		opacity: var(--chrome-opacity, 0.5);
	}

	.gate h1 {
		margin: 0 0 24px;
		font-family: var(--serif);
		font-size: clamp(34px, 8vw, 58px);
		font-weight: 500;
		line-height: 1.06;
	}

	.album-head {
		margin-bottom: 28px;
		color: var(--cream);
	}

	.album-head h1 {
		margin: 0;
		color: var(--cream);
		font-family: var(--serif);
		font-size: clamp(38px, 7vw, 68px);
		font-weight: 500;
		line-height: 1.02;
	}

	.album-head .eyebrow {
		color: var(--cream);
	}

	.desc {
		max-width: 620px;
		margin: 10px 0 0;
		font-family: var(--serif);
		font-size: 18px;
		line-height: 1.45;
	}

	.item-wordmark {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 50;
		display: flex;
		min-height: 56px;
		align-items: center;
		padding: 0 28px;
		color: var(--cream);
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.26em;
		opacity: 0.92;
		pointer-events: none;
		text-transform: uppercase;
	}

	.sub {
		margin: 0;
		font-family: var(--serif);
		font-size: 18px;
		line-height: 1.35;
	}

	form {
		margin: 0;
	}

	label {
		display: block;
		margin-bottom: 8px;
	}

	input {
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-height: 48px;
		padding: 12px 14px;
		border: 0;
		background: var(--cream);
		color: var(--ink);
		font-family: var(--serif);
		font-size: 18px;
	}

	input:focus-visible {
		outline: 3px solid var(--cream);
		outline-offset: 2px;
	}

	.error {
		margin: 10px 0 0;
		font-size: 14px;
		font-weight: 700;
	}

	button {
		min-height: 48px;
		margin-top: 16px;
		padding: 0 20px;
		border: 0;
		background: var(--ink);
		color: var(--cream);
		cursor: pointer;
		font-weight: 700;
	}

	.wordmark {
		position: absolute;
		right: 24px;
		bottom: 22px;
		z-index: 1;
		opacity: 0.54;
	}

	@media (max-width: 640px) {
		.room {
			align-items: flex-end;
			justify-content: flex-start;
			padding: 22px 18px 76px;
		}

		.wordmark {
			right: 18px;
			bottom: 18px;
		}
	}
</style>
