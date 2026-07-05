<script lang="ts">
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';
	import Gradient from '$lib/ui/Gradient.svelte';
	import { comfortMode, themePref } from '$lib/ui/theme';
	import { personRoomFor } from '$lib/ui/tokens';

	let { data, form } = $props();
	// svelte-ignore state_referenced_locally
	let accentColor = $state(data.profile.accentColor);
	const room = $derived(personRoomFor(accentColor));

	$effect(() => {
		themePref.set(data.profile.theme);
		comfortMode.set(data.profile.comfortMode);
	});
</script>

<svelte:head>
	<title>Profile - Shoebox</title>
</svelte:head>

<div class="room" style={`--profile-accent: ${accentColor}`}>
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
				<div class="label">Appearance</div>
				<form method="POST" action="?/appearance">
					<AccentSwatches bind:value={accentColor} />
					<input type="hidden" name="accentColor" value={accentColor} />
					<label class="field">
						<span>Theme</span>
						<select name="theme" value={data.profile.theme}>
							<option value="system">System</option>
							<option value="dark">Dark</option>
							<option value="light">Light</option>
						</select>
					</label>
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
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}

	form {
		margin-bottom: 20px;
	}

	.field {
		display: block;
		margin-bottom: 12px;
	}

	.field span {
		display: block;
		margin-bottom: 6px;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	input,
	select {
		color-scheme: dark;
	}

	.field input,
	.field select {
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
		color: var(--ink);
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		padding: 0 20px;
		text-transform: uppercase;
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
	}
</style>
