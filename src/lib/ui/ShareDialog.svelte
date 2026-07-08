<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { CREAM, FONT, INK } from '$lib/ui/tokens';
	import type { ShareRecord } from '$lib/server/shares';

	let {
		targetType,
		targetId,
		open,
		onClose
	}: {
		targetType: 'album' | 'item';
		targetId: string;
		open: boolean;
		onClose: () => void;
	} = $props();

	let shares = $state<ShareRecord[]>([]);
	let usePassword = $state(false);
	let password = $state('');
	let expiry = $state<'never' | '7d' | '30d' | 'custom'>('never');
	let customDate = $state('');
	let allowDownload = $state(false);
	let busy = $state(false);
	let createdUrl = $state<string | null>(null);
	let copied = $state('');

	$effect(() => {
		if (open) void refresh();
	});

	let closeBtn = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		if (open) closeBtn?.focus();
	});

	function onKey(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}

	async function refresh(): Promise<void> {
		const res = await fetch(`/api/shares?targetType=${targetType}&targetId=${targetId}`);
		if (res.ok) shares = ((await res.json()) as { shares: ShareRecord[] }).shares;
	}

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		busy = true;
		try {
			const res = await fetch('/api/shares', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					targetType,
					targetId,
					password: usePassword ? password : undefined,
					expiry: expiry === 'custom' ? customDate : expiry,
					allowDownload
				})
			});
			if (!res.ok) return;
			const body = (await res.json()) as { url: string };
			createdUrl = new URL(body.url, location.origin).href;
			password = '';
			usePassword = false;
			await refresh();
		} finally {
			busy = false;
		}
	}

	async function copy(text: string, id: string): Promise<void> {
		await navigator.clipboard.writeText(text);
		copied = id;
		setTimeout(() => (copied = ''), 1500);
	}

	async function revoke(id: string): Promise<void> {
		await fetch(`/api/shares/${id}`, { method: 'DELETE' });
		await refresh();
		await invalidateAll();
	}

	function selectValue(event: FocusEvent): void {
		(event.currentTarget as HTMLInputElement).select();
	}

	function shareUrl(token: string): string {
		return new URL(`/share/${token}`, location.origin).href;
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div
		class="scrim"
		role="presentation"
		onclick={onClose}
		style={`--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
	></div>
	<div
		class="dialog"
		role="dialog"
		aria-modal="true"
		aria-label="Share"
		style={`--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
	>
		<header>
			<h2>Share this {targetType}</h2>
			<button class="close" type="button" onclick={onClose} aria-label="Close" bind:this={closeBtn}
				>x</button
			>
		</header>

		<form onsubmit={create}>
			<label class="row">
				<input type="checkbox" bind:checked={usePassword} />
				<span>Require a password</span>
			</label>
			{#if usePassword}
				<input
					class="text"
					type="text"
					bind:value={password}
					placeholder="Password"
					autocomplete="off"
					required
				/>
			{/if}
			<label class="stack">
				<span>Expires</span>
				<select bind:value={expiry}>
					<option value="never">Never</option>
					<option value="7d">In 7 days</option>
					<option value="30d">In 30 days</option>
					<option value="custom">On a date</option>
				</select>
			</label>
			{#if expiry === 'custom'}
				<input class="text" type="date" bind:value={customDate} required />
			{/if}
			<label class="row">
				<input type="checkbox" bind:checked={allowDownload} />
				<span>Allow downloading originals</span>
			</label>
			<button class="primary" type="submit" disabled={busy}>Create share link</button>
		</form>

		{#if createdUrl}
			<div class="created">
				<input
					class="text"
					data-testid="share-link"
					readonly
					value={createdUrl}
					onfocus={selectValue}
				/>
				<button class="copy" type="button" onclick={() => copy(createdUrl ?? '', 'new')}>
					{copied === 'new' ? 'Copied' : 'Copy link'}
				</button>
			</div>
		{/if}

		{#if shares.length > 0}
			<h3>Existing links</h3>
			<ul>
				{#each shares as share (share.id)}
					<li>
						<span class="meta">
							{share.hasPassword ? 'Password' : 'Open'} /
							{share.expiresAt
								? `expires ${new Date(share.expiresAt).toLocaleDateString()}`
								: 'never expires'}
							/ {share.allowDownload ? 'downloads on' : 'view only'}
						</span>
						<span class="actions">
							<button
								class="copy"
								type="button"
								onclick={() => copy(shareUrl(share.token), share.id)}
							>
								{copied === share.id ? 'Copied' : 'Copy link'}
							</button>
							<button class="revoke" type="button" onclick={() => revoke(share.id)}>Revoke</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		z-index: 50;
		inset: 0;
		background: color-mix(in srgb, var(--ink) 60%, transparent);
	}

	.dialog {
		position: fixed;
		z-index: 51;
		top: 50%;
		left: 50%;
		width: min(520px, calc(100vw - 32px));
		max-height: 85vh;
		overflow-y: auto;
		padding: 24px;
		/* Joyous gradient in the family of the timeline rooms — a warm dawn glow and
		   a cool verdigris pool over a dark base. */
		background:
			radial-gradient(
				90% 60% at 92% -12%,
				color-mix(in srgb, var(--dawn) 42%, transparent),
				transparent 55%
			),
			radial-gradient(
				80% 72% at -12% 112%,
				color-mix(in srgb, #48929b 34%, transparent),
				transparent 60%
			),
			linear-gradient(158deg, color-mix(in srgb, var(--cream) 8%, var(--ink)) 0%, var(--ink) 100%);
		color: var(--cream);
		box-shadow: 0 30px 70px rgb(0 0 0 / 0.5);
		transform: translate(-50%, -50%);
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 18px;
		gap: 16px;
	}

	h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: 24px;
		font-weight: 500;
	}

	h3 {
		margin: 22px 0 8px;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.close,
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
		margin-top: 14px;
		padding: 0 20px;
		background: var(--cream);
		color: var(--ink);
		font-weight: 700;
	}

	/* Copy (safe, frequent) vs Revoke (destructive) must not look alike — Copy is a
	   filled chip, Revoke is a distinct outlined danger action, spaced apart. */
	.copy {
		padding: 0 14px;
		background: color-mix(in srgb, var(--cream) 16%, transparent);
		color: var(--cream);
	}

	.revoke {
		padding: 0 14px;
		background: none;
		color: var(--dawn);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dawn) 55%, transparent);
	}

	.revoke:hover,
	.revoke:focus-visible {
		background: color-mix(in srgb, var(--dawn) 16%, transparent);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.row {
		display: flex;
		min-height: 48px;
		align-items: center;
		gap: 10px;
		font-family: var(--sans);
		font-size: 14px;
	}

	.row input[type='checkbox'] {
		width: 22px;
		height: 22px;
		accent-color: var(--dawn);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	select,
	.text {
		min-height: 48px;
		padding: 0 12px;
		border: 0;
		background-color: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--serif);
		font-size: 16px;
	}

	/* Dark dialog → the global dark select styling (cream chevron, dark popup) is
	   correct; just reserve room for the chevron. */
	select {
		padding-right: 2.2em;
	}

	.created {
		display: flex;
		margin-top: 14px;
		gap: 8px;
	}

	.created .text {
		flex: 1;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		min-height: 48px;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.meta {
		font-family: var(--serif);
		font-size: 15px;
	}

	.actions {
		display: flex;
		gap: 12px;
	}

	:is(button, select, input):focus-visible {
		outline: 3px solid var(--dawn);
		outline-offset: 2px;
	}

	@media (max-width: 620px) {
		.created,
		li {
			align-items: stretch;
			flex-direction: column;
		}

		.actions {
			justify-content: flex-start;
		}
	}
</style>
