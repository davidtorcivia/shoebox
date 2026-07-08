<script lang="ts">
	import { ACCENTS } from '$lib/ui/tokens';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';

	interface NavUser {
		username: string;
		role: 'owner' | 'admin' | 'editor' | 'uploader' | 'user';
		accentColor: string;
		avatarStorageKey: string | null;
	}
	let {
		user,
		ingestion,
		linkedPersonSlug = null
	}: { user: NavUser; ingestion: boolean; linkedPersonSlug?: string | null } = $props();

	const showArrivals = $derived(ingestion && ['editor', 'admin', 'owner'].includes(user.role));
	const showUpload = $derived(['uploader', 'editor', 'admin', 'owner'].includes(user.role));
	const showAdmin = $derived(['admin', 'owner'].includes(user.role));
	const accentOn = $derived(ACCENTS.find((accent) => accent.hex === user.accentColor)?.on ?? 'ink');

	let menuOpen = $state(false);
	// Collapse the mobile menu once navigation settles (the nav lives in the layout,
	// so it isn't remounted on route change and would otherwise stay open).
	afterNavigate(() => (menuOpen = false));
</script>

<header class="nav">
	<a class="wordmark" href={resolve('/')}>Shoebox</a>
	<button
		class="hamburger"
		class:open={menuOpen}
		type="button"
		aria-label="Toggle navigation menu"
		aria-expanded={menuOpen}
		aria-controls="primary-nav"
		onclick={() => (menuOpen = !menuOpen)}
	>
		<span></span>
		<span></span>
		<span></span>
	</button>
	<div class="nav-groups" class:open={menuOpen} id="primary-nav">
		<nav aria-label="Primary">
			<a href={resolve('/')}>Timeline</a>
			<a href={resolve('/people')}>People</a>
			{#if linkedPersonSlug}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- person slug is dynamic -->
				<a href={`/people/${linkedPersonSlug}`} data-testid="nav-you">You</a>
			{/if}
			<a href={resolve('/albums')}>Albums</a>
			<a href={resolve('/search')}>Search</a>
			{#if showUpload}<a href={resolve('/upload')}>Upload</a>{/if}
			{#if showArrivals}<a href={resolve('/arrivals')}>Arrivals</a>{/if}
			{#if showAdmin}<a href={resolve('/admin')}>Admin</a>{/if}
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

	.nav-groups {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 2rem;
	}

	.hamburger {
		display: none;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		width: 44px;
		height: 44px;
		margin-left: auto;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	.hamburger span {
		display: block;
		width: 22px;
		height: 2px;
		margin: 0 auto;
		background: var(--cream);
		transition:
			transform 200ms ease,
			opacity 200ms ease;
	}

	.hamburger.open span:nth-child(1) {
		transform: translateY(7px) rotate(45deg);
	}

	.hamburger.open span:nth-child(2) {
		opacity: 0;
	}

	.hamburger.open span:nth-child(3) {
		transform: translateY(-7px) rotate(-45deg);
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

	@media (max-width: 760px) {
		.nav {
			gap: 1rem;
		}

		.hamburger {
			display: flex;
		}

		/* The Shoebox wordmark and hamburger float ABOVE the single menu panel. */
		.wordmark,
		.hamburger {
			position: relative;
			z-index: 1;
		}

		/* ONE blurred panel covering the whole nav (title row + menu) as a single
		   frosted surface. Nesting a backdrop-filter inside another element that
		   also has one cancels the blur, so only this element carries it. Its top
		   padding clears the title row so the links sit below Shoebox. */
		.nav-groups {
			position: absolute;
			top: 0;
			right: 0;
			left: 0;
			flex: none;
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			padding: calc(56px + 0.5rem) 1.5rem 1.2rem;
			/* Nearly opaque on its own so the panel reads as a clean warm-dark menu
			   even where backdrop-filter misbehaves — iOS Safari renders a translucent
			   blurred panel as a solid black box, which is what looked broken. The
			   blur is a progressive enhancement layered on top. */
			background: color-mix(in srgb, var(--ink) 92%, transparent);
			border-bottom: 1px solid color-mix(in srgb, var(--cream) 16%, transparent);
			backdrop-filter: blur(22px) saturate(1.35);
			-webkit-backdrop-filter: blur(22px) saturate(1.35);
			box-shadow: 0 18px 40px rgb(0 0 0 / 0.28);
		}

		.nav-groups:not(.open) {
			display: none;
		}

		nav {
			flex-direction: column;
			gap: 0;
		}

		nav a {
			min-height: 48px;
			padding: 0;
		}

		.account {
			justify-content: space-between;
			margin-top: 0.5rem;
			padding-top: 0.5rem;
			border-top: 1px solid color-mix(in srgb, var(--cream) 12%, transparent);
		}
	}
</style>
