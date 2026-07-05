<script lang="ts">
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { comfortMode, themePref } from '$lib/ui/theme';
	import { accentOn, personRoomFor } from '$lib/ui/tokens';

	let { data, form } = $props();
	// svelte-ignore state_referenced_locally
	let accentColor = $state(data.profile.accentColor);
	const room = $derived(personRoomFor(accentColor));
	const profileOn = $derived(accentOn(accentColor));

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
						<form method="POST" action="?/avatar" enctype="multipart/form-data">
							<label class="field file-field">
								<span>Image</span>
								<input
									name="avatar"
									type="file"
									accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
									required
								/>
							</label>
							<button type="submit" data-testid="save-avatar">
								{data.profile.avatarUrl ? 'Replace avatar' : 'Upload avatar'}
							</button>
						</form>
						{#if data.profile.avatarUrl}
							<form method="POST" action="?/deleteAvatar">
								<button class="secondary" type="submit" data-testid="delete-avatar">
									Delete avatar
								</button>
							</form>
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
		grid-template-columns: 116px minmax(0, 1fr);
		gap: 22px;
		align-items: start;
	}

	.avatar-preview {
		width: 116px;
		aspect-ratio: 1;
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

	.file-field input {
		display: block;
		padding: 10px 0;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 14px;
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

	.secondary {
		background: color-mix(in srgb, var(--cream) 15%, transparent);
		color: var(--cream);
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
		}

		.avatar-preview.fallback {
			font-size: 40px;
		}
	}
</style>
