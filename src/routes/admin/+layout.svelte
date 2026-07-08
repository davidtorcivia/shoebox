<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { FONT } from '$lib/ui/tokens';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	type AdminHref =
		| '/admin/users'
		| '/admin/invites'
		| '/admin/shares'
		| '/admin/trash'
		| '/admin/settings'
		| '/admin/jobs'
		| '/admin/health'
		| '/admin/faces';
	const sections = $derived<{ href: AdminHref; label: string }[]>([
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/invites', label: 'Invites' },
		{ href: '/admin/shares', label: 'Shares' },
		{ href: '/admin/trash', label: 'Trash' },
		{ href: '/admin/settings', label: 'Settings' },
		{ href: '/admin/jobs', label: 'Jobs' },
		{ href: '/admin/health', label: 'Health' },
		...(data.features.faces ? [{ href: '/admin/faces' as const, label: 'Faces' }] : [])
	]);
</script>

<div class="admin" style={`--serif:${FONT.serif}; --sans:${FONT.sans};`}>
	<header>
		<h1>Admin</h1>
		<nav aria-label="Admin sections">
			{#each sections as section (section.href)}
				<a
					href={resolve(section.href)}
					aria-current={page.url.pathname.startsWith(section.href) ? 'page' : undefined}
				>
					{section.label}
				</a>
			{/each}
		</nav>
	</header>
	<main>{@render children()}</main>
</div>

<style>
	.admin {
		width: 100%;
		padding: 38px 30px 64px;
	}

	h1 {
		margin: 0 0 18px;
		font-family: var(--serif);
		font-size: 40px;
		font-weight: 500;
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 28px;
		gap: 4px;
	}

	nav a {
		display: inline-flex;
		min-height: 48px;
		align-items: center;
		padding: 0 16px;
		color: inherit;
		font-family: var(--sans);
		font-size: 12px;
		letter-spacing: 0.14em;
		opacity: var(--chrome-opacity, 0.5);
		text-decoration: none;
		text-transform: uppercase;
	}

	nav a[aria-current='page'] {
		font-weight: 700;
		opacity: 1;
	}

	nav a:focus-visible {
		outline: 3px solid currentColor;
		outline-offset: 2px;
	}
</style>
