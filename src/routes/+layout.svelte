<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import Meta from '$lib/ui/Meta.svelte';
	import Nav from '$lib/ui/Nav.svelte';
	import { comfortMode, initTheme, themePref } from '$lib/ui/theme';
	import { buildSteps, TOUR_VERSION } from '$lib/ui/tour/steps';
	import { tour } from '$lib/ui/tour/tour.svelte';
	import TourCard from '$lib/ui/tour/TourCard.svelte';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	onMount(() => {
		// The guided walk greets anyone who has not finished (or skipped) the
		// current tour. onMount runs once per full page load, so the tour's own
		// client-side navigations never re-trigger it.
		if (data.user && data.user.tourVersion < TOUR_VERSION && !data.pathname.startsWith('/share')) {
			tour.start(buildSteps(data.user.role, data.arrivalsCount));
		}
		return initTheme(data.user);
	});

	$effect(() => {
		if (!data.user) return;
		themePref.set(data.user.theme);
		comfortMode.set(data.user.comfortMode);
	});

	// One source of truth for link-preview tags: a page can supply `meta` from its
	// load; otherwise the site defaults apply. Relative images resolve against the
	// request origin so crawlers get an absolute URL.
	const SITE_DESCRIPTION =
		'A private home for your family’s photos, films, and the stories behind them.';
	const pageMeta = $derived((page.data as { meta?: PageMeta }).meta ?? null);
	const absolute = (path: string) =>
		path.startsWith('http') ? path : new URL(path, page.url.origin).href;
	const meta = $derived({
		title: pageMeta?.title ?? 'Shoebox',
		description: pageMeta?.description ?? SITE_DESCRIPTION,
		image: absolute(pageMeta?.image ?? '/og.png'),
		imageAlt: pageMeta?.imageAlt ?? 'Shoebox',
		type: pageMeta?.type ?? ('website' as const),
		url: page.url.href
	});

	interface PageMeta {
		title?: string;
		description?: string;
		image?: string;
		imageAlt?: string;
		type?: 'website' | 'article';
	}
</script>

<Meta
	title={meta.title}
	description={meta.description}
	image={meta.image}
	imageAlt={meta.imageAlt}
	type={meta.type}
	url={meta.url}
/>

{#if data.user && !data.pathname.startsWith('/share')}
	<Nav
		user={data.user}
		arrivalsCount={data.arrivalsCount}
		linkedPersonSlug={data.linkedPersonSlug}
	/>
	<TourCard />
{/if}
<main>
	{@render children()}
</main>
