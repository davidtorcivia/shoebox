<script lang="ts">
	import '../app.css';
	import Nav from '$lib/ui/Nav.svelte';
	import { initTheme } from '$lib/ui/theme';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	onMount(() => initTheme(data.user));
</script>

{#if data.user && !data.pathname.startsWith('/share')}
	<Nav user={data.user} />
{/if}
<main>
	{@render children()}
</main>
