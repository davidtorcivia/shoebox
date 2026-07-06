<script lang="ts">
	import { ACCENTS } from '$lib/ui/tokens';
	import { resolve } from '$app/paths';

	interface NavUser {
		username: string;
		role: 'owner' | 'admin' | 'editor' | 'uploader' | 'user';
		accentColor: string;
		avatarStorageKey: string | null;
	}
	let { user }: { user: NavUser } = $props();

	const showArrivals = $derived(['editor', 'admin', 'owner'].includes(user.role));
	const showUpload = $derived(['uploader', 'editor', 'admin', 'owner'].includes(user.role));
	const accentOn = $derived(ACCENTS.find((accent) => accent.hex === user.accentColor)?.on ?? 'ink');
</script>

<header class="nav">
	<a class="wordmark" href={resolve('/')}>Shoebox</a>
	<nav aria-label="Primary">
		<a href={resolve('/')}>Timeline</a>
		<a href={resolve('/people')}>People</a>
		<a href={resolve('/albums')}>Albums</a>
		<a href={resolve('/search')}>Search</a>
		{#if showUpload}<a href={resolve('/upload')}>Upload</a>{/if}
		{#if showArrivals}<a href={resolve('/arrivals')}>Arrivals</a>{/if}
	</nav>
	<div class="account">
		<a
			class="profile-link"
			href={resolve('/profile')}
			style:--user-accent={user.accentColor}
			aria-label={`Edit account for ${user.username}`}
		>
			<span class="name">{user.username}</span>
			{#if user.avatarStorageKey}
				<img
					class="monogram photo"
					src={resolve(`/media/${user.avatarStorageKey}`)}
					alt=""
					aria-hidden="true"
				/>
			{:else}
				<span
					class="monogram"
					style:background={user.accentColor}
					style:color={accentOn === 'ink' ? 'var(--ink)' : 'var(--cream)'}
					aria-hidden="true">{user.username.slice(0, 1)}</span
				>
			{/if}
		</a>
		<form method="POST" action="/logout">
			<button type="submit">Sign out</button>
		</form>
	</div>
</header>

<style>
	.nav {
		position: relative;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 0 1.5rem;
		min-height: 56px;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
	}

	.wordmark {
		font-weight: 700;
		letter-spacing: 0.22em;
		font-size: 0.85rem;
	}

	nav {
		display: flex;
		gap: 0.25rem;
		flex: 1;
	}

	nav a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.75rem;
		opacity: 0.85;
	}

	nav a:hover,
	nav a:focus-visible {
		opacity: 1;
	}

	.account {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.profile-link {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 44px;
	}

	.name {
		color: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: var(--user-accent);
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
	}

	.monogram {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		object-fit: cover;
		font-weight: 700;
	}

	.account button {
		min-height: 44px;
		padding: 0 0.6rem;
		border: 0;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-sans);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.account button:hover,
	.account button:focus-visible,
	.profile-link:hover,
	.profile-link:focus-visible {
		opacity: 1;
	}
</style>
