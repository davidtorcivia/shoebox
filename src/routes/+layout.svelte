<script lang="ts">
	import '../app.css';
	import Nav from '$lib/ui/Nav.svelte';
	import { comfortMode, initTheme, themePref } from '$lib/ui/theme';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	onMount(() => initTheme(data.user));

	$effect(() => {
		if (!data.user) return;
		themePref.set(data.user.theme);
		comfortMode.set(data.user.comfortMode);
	});
</script>

{#if data.user && !data.pathname.startsWith('/share')}
	<Nav user={data.user} />
{/if}
<main>
	{@render children()}
</main>
