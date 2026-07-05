<script lang="ts">
	import { enhance } from '$app/forms';
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { comfortMode, themePref } from '$lib/ui/theme';
	import { accentOn, personRoomFor } from '$lib/ui/tokens';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();
	// svelte-ignore state_referenced_locally
	let accentColor = $state(data.profile.accentColor);
	let selectedAvatarName = $state('');
	let selectedAvatarSize = $state('');
	let avatarTooLarge = $state(false);
	let avatarUploadState = $state<'idle' | 'selected' | 'uploading' | 'saved' | 'error'>('idle');
	let avatarMessage = $state('PNG, JPG, WebP, GIF or AVIF up to 5 MB.');
	let confirmDeleteAvatar = $state(false);
	const room = $derived(personRoomFor(accentColor));
	const profileOn = $derived(accentOn(accentColor));

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function chooseAvatar(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			selectedAvatarName = '';
			selectedAvatarSize = '';
			avatarTooLarge = false;
			avatarUploadState = 'idle';
			avatarMessage = 'PNG, JPG, WebP, GIF or AVIF up to 5 MB.';
			return;
		}
		selectedAvatarName = file.name;
		selectedAvatarSize = formatBytes(file.size);
		avatarTooLarge = file.size > 5 * 1024 * 1024;
		if (avatarTooLarge) {
			avatarUploadState = 'error';
			avatarMessage = 'Choose an image 5 MB or smaller.';
			return;
		}
		avatarUploadState = 'selected';
		avatarMessage = 'Ready to upload.';
	}

	function actionMessage(data: unknown): string | null {
		if (data && typeof data === 'object' && 'message' in data) {
			const message = (data as { message?: unknown }).message;
			if (typeof message === 'string') return message;
		}
		return null;
	}

	const avatarSubmit: SubmitFunction = () => {
		avatarUploadState = 'uploading';
		avatarMessage = selectedAvatarName
			? `Uploading ${selectedAvatarName}...`
			: 'Uploading avatar...';
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				selectedAvatarName = '';
				selectedAvatarSize = '';
				avatarTooLarge = false;
				avatarUploadState = 'saved';
				avatarMessage = 'Avatar updated.';
				return;
			}
			if (result.type === 'failure') {
				avatarUploadState = 'error';
				avatarMessage = actionMessage(result.data) ?? 'Avatar upload failed.';
				return;
			}
			avatarUploadState = 'idle';
			avatarMessage = 'PNG, JPG, WebP, GIF or AVIF up to 5 MB.';
		};
	};

	$effect(() => {
		themePref.set(data.profile.theme);
		comfortMode.set(data.profile.comfortMode);
	});
</script>

<svelte:head>
	<title>Profile - Shoebox</title>
</svelte:head>

<div class="room" style={`--profile-accent: ${accentColor}; --profile-on: ${profileOn}`}>
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<div class="wrap">
			<h1>Profile</h1>
			{#if form?.message}<p class="err" data-testid="profile-error">{form.message}</p>{/if}
			{#if form?.saved}<p class="ok" data-testid="profile-saved">Saved.</p>{/if}

			<section>
				<div class="label">Account</div>
				<form method="POST" action="?/account">
					<label class="field">
						<span>Username</span>
						<input name="username" value={data.profile.username} minlength="3" maxlength="32" />
					</label>
					<label class="field">
						<span>Current password</span>
						<input name="current" type="password" autocomplete="current-password" required />
					</label>
					<button type="submit" data-testid="save-account">Save username</button>
				</form>
				<form method="POST" action="?/password">
					<label class="field">
						<span>Current password</span>
						<input name="current" type="password" />
					</label>
					<label class="field">
						<span>New password</span>
						<input name="next" type="password" minlength="8" />
					</label>
					<button type="submit" data-testid="save-password">Change password</button>
				</form>
			</section>

			<section>
				<div class="label">Avatar</div>
				<div class="avatar-row">
					{#if data.profile.avatarUrl}
						<img class="avatar-preview" src={data.profile.avatarUrl} alt="" />
					{:else}
						<div class="avatar-preview fallback" aria-hidden="true">
							{data.profile.username.slice(0, 1)}
						</div>
					{/if}
					<div class="avatar-actions">
						<form
							class="avatar-form"
							method="POST"
							action="?/avatar"
							enctype="multipart/form-data"
							use:enhance={avatarSubmit}
						>
							<div class="file-label">Image</div>
							<label class="file-picker">
								<input
									class="native-file"
									name="avatar"
									type="file"
									accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
									required
									onchange={chooseAvatar}
								/>
								<span class="file-button">Choose image</span>
								<span class="file-meta">
									{#if selectedAvatarName}
										<strong>{selectedAvatarName}</strong>
										<small>{selectedAvatarSize}</small>
									{:else}
										No image selected
									{/if}
								</span>
							</label>
							<div class="upload-status" data-state={avatarUploadState} aria-live="polite">
								<span class="upload-track"><span></span></span>
								<span class="upload-copy">{avatarMessage}</span>
							</div>
							<button
								type="submit"
								data-testid="save-avatar"
								disabled={avatarUploadState === 'uploading' || avatarTooLarge}
							>
								{data.profile.avatarUrl ? 'Replace avatar' : 'Upload avatar'}
							</button>
						</form>
						{#if data.profile.avatarUrl}
							<button
								class="secondary delete-avatar-trigger"
								type="button"
								data-testid="delete-avatar"
								onclick={() => (confirmDeleteAvatar = true)}
							>
								Delete avatar
							</button>
						{/if}
					</div>
				</div>
			</section>

			<section>
				<div class="label">Appearance</div>
				<form method="POST" action="?/appearance">
					<AccentSwatches bind:value={accentColor} />
					<input type="hidden" name="accentColor" value={accentColor} />
					<input type="hidden" name="theme" value="system" />
					<label class="check">
						<input
							type="checkbox"
							name="comfortMode"
							checked={data.profile.comfortMode}
							data-testid="comfort-toggle"
						/>
						<span>Comfort mode</span>
					</label>
					<button type="submit" data-testid="save-appearance">Save appearance</button>
				</form>
			</section>

			<section>
				<div class="label">Linked person</div>
				{#if data.linkedPerson}
					<p class="linked" data-testid="linked-person">
						Linked to <a href={`/people/${data.linkedPerson.slug}`}>{data.linkedPerson.name}</a>.
					</p>
				{:else}
					<p class="linked">Not linked to a person.</p>
				{/if}
			</section>

			<section class="danger-zone">
				<div class="label">Delete account</div>
				{#if data.profile.role === 'owner'}
					<p class="linked">The owner account cannot be deleted.</p>
				{:else}
					<form method="POST" action="?/deleteAccount">
						<label class="field">
							<span>Current password</span>
							<input name="current" type="password" autocomplete="current-password" required />
						</label>
						<button class="danger" type="submit" data-testid="delete-account">Delete account</button
						>
					</form>
				{/if}
			</section>
		</div>
	</section>
	{#if confirmDeleteAvatar}
		<div class="modal-backdrop">
			<div
				class="confirm-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="delete-avatar-title"
			>
				<div class="label">Confirm</div>
				<h2 id="delete-avatar-title">Delete avatar?</h2>
				<p>The uploaded image will be removed from your account.</p>
				<div class="modal-actions">
					<button class="secondary" type="button" onclick={() => (confirmDeleteAvatar = false)}>
						Cancel
					</button>
					<form method="POST" action="?/deleteAvatar">
						<button class="danger" type="submit">Delete avatar</button>
					</form>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}

	.page {
		position: relative;
		min-height: 100vh;
		background: linear-gradient(180deg, rgb(23 20 18 / 0.08) 0%, rgb(23 20 18 / 0.68) 100%);
	}

	.wrap {
		max-width: 680px;
		padding: 30px;
	}

	h1 {
		margin: 0 0 24px;
		font-family: var(--font-serif);
		font-size: 40px;
		font-weight: 400;
		line-height: 1;
	}

	section {
		margin-bottom: 36px;
	}

	.label {
		margin-bottom: 14px;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	form {
		margin-bottom: 20px;
	}

	.avatar-row {
		display: grid;
		grid-template-columns: 128px minmax(280px, 420px);
		gap: 22px;
		align-items: start;
	}

	.avatar-preview {
		width: 128px;
		height: 128px;
		object-fit: cover;
		background: var(--profile-accent);
		color: var(--profile-on);
	}

	.avatar-preview.fallback {
		display: grid;
		place-items: center;
		font-family: var(--font-sans);
		font-size: 54px;
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
	}

	.avatar-actions form {
		margin-bottom: 12px;
	}

	.avatar-actions {
		min-width: 0;
	}

	.avatar-form {
		display: grid;
		gap: 12px;
		min-width: 0;
		max-width: 420px;
	}

	.file-label {
		color: color-mix(in srgb, var(--cream) 82%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.file-picker {
		position: relative;
		display: grid;
		grid-template-columns: minmax(132px, max-content) minmax(0, 1fr);
		align-items: stretch;
		min-height: 54px;
		width: 100%;
		max-width: 420px;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--profile-accent) 38%, transparent),
				transparent
			),
			color-mix(in srgb, var(--cream) 10%, transparent);
		cursor: pointer;
		overflow: hidden;
	}

	.file-picker:focus-within {
		outline: 2px solid var(--profile-accent);
		outline-offset: 2px;
	}

	.native-file {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.file-button,
	.file-meta {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.file-button {
		justify-content: center;
		padding: 0 18px;
		background: var(--profile-accent);
		color: var(--profile-on);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.file-meta {
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 9px 14px;
		color: color-mix(in srgb, var(--cream) 88%, transparent);
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.2;
	}

	.file-meta strong,
	.file-meta small {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-meta strong {
		font-weight: 500;
	}

	.file-meta small {
		color: color-mix(in srgb, var(--cream) 62%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.upload-status {
		display: grid;
		gap: 7px;
		max-width: 420px;
		color: color-mix(in srgb, var(--cream) 72%, transparent);
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.08em;
		line-height: 1.35;
		text-transform: uppercase;
	}

	.upload-track {
		position: relative;
		display: block;
		height: 3px;
		overflow: hidden;
		background: color-mix(in srgb, var(--cream) 18%, transparent);
	}

	.upload-track span {
		position: absolute;
		inset: 0;
		width: 0;
		background: var(--profile-accent);
	}

	.upload-status[data-state='selected'] .upload-track span,
	.upload-status[data-state='saved'] .upload-track span {
		width: 100%;
	}

	.upload-status[data-state='uploading'] .upload-track span {
		width: 45%;
		animation: upload-sweep 1.1s ease-in-out infinite;
	}

	.upload-status[data-state='error'] {
		color: var(--dawn);
	}

	.field {
		display: block;
		margin-bottom: 12px;
	}

	.field span {
		display: block;
		margin-bottom: 6px;
		color: color-mix(in srgb, var(--cream) 82%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	input {
		color-scheme: dark;
	}

	.field input {
		width: 100%;
		min-height: 44px;
		border: 0;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		font-family: var(--font-serif);
		font-size: 17px;
		padding: 12px 14px;
	}

	.check {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: 10px;
		margin: 10px 0;
		font-family: var(--font-serif);
		font-size: 16px;
	}

	.check input {
		width: 18px;
		height: 18px;
		accent-color: var(--profile-accent);
	}

	button {
		min-height: 44px;
		margin-top: 8px;
		border: 0;
		background: var(--profile-accent);
		color: var(--profile-on);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		padding: 0 20px;
		text-transform: uppercase;
	}

	.avatar-form > button,
	.delete-avatar-trigger {
		justify-self: start;
		width: auto;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.72;
	}

	.secondary {
		background: color-mix(in srgb, var(--cream) 15%, transparent);
		color: var(--cream);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(23 20 18 / 0.72);
	}

	.confirm-modal {
		width: min(420px, 100%);
		margin: 0;
		padding: 24px;
		background:
			linear-gradient(
				135deg,
				color-mix(in srgb, var(--profile-accent) 18%, transparent),
				transparent
			),
			color-mix(in srgb, var(--ink) 92%, var(--cream));
		box-shadow: 0 22px 70px rgb(0 0 0 / 0.38);
	}

	.confirm-modal h2 {
		margin: 0 0 10px;
		font-family: var(--font-serif);
		font-size: 30px;
		font-weight: 500;
		line-height: 1.05;
	}

	.confirm-modal p {
		margin: 0;
		color: color-mix(in srgb, var(--cream) 78%, transparent);
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.45;
	}

	.modal-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 20px;
	}

	.modal-actions form {
		margin: 0;
	}

	.danger-zone {
		padding-top: 22px;
	}

	.danger {
		background: color-mix(in srgb, var(--dawn) 86%, var(--ink));
		color: var(--cream);
	}

	.linked {
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.6;
	}

	.linked a {
		color: var(--profile-accent);
		text-decoration: none;
	}

	.linked a:hover {
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.err {
		color: var(--profile-accent);
		font-family: var(--font-sans);
		font-size: 12px;
	}

	.ok {
		font-family: var(--font-sans);
		font-size: 12px;
		opacity: 0.8;
	}

	@media (max-width: 640px) {
		.wrap {
			padding-inline: 18px;
		}

		.avatar-row {
			grid-template-columns: 88px minmax(0, 1fr);
			gap: 16px;
		}

		.avatar-preview {
			width: 88px;
			height: 88px;
		}

		.avatar-preview.fallback {
			font-size: 40px;
		}

		.file-picker {
			grid-template-columns: 1fr;
			max-width: none;
		}

		.file-button {
			min-height: 44px;
		}
	}

	@keyframes upload-sweep {
		from {
			transform: translateX(-110%);
		}

		to {
			transform: translateX(245%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.upload-status[data-state='uploading'] .upload-track span {
			animation: none;
			width: 100%;
		}
	}
</style>
