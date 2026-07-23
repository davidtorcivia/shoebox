<script lang="ts">
	import Gradient from '$lib/ui/Gradient.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import { personRoomFor } from '$lib/ui/tokens';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const room = personRoomFor('#6A90A5');
	const total = $derived(data.groups.reduce((sum, group) => sum + group.items.length, 0));

	function agoLabel(yearsAgo: number): string {
		if (yearsAgo === 1) return 'One year ago';
		return `${yearsAgo} years ago`;
	}
</script>

<svelte:head>
	<title>On this day · Shoebox</title>
</svelte:head>

<div class="room">
	<Gradient stops={room.stops} pools={room.pools} />
	<section class="page">
		<header class="hero">
			<p class="eyebrow">On this day</p>
			<h1>{data.monthDay}</h1>
			{#if total > 0}
				<p class="sub">
					{total}
					{total === 1 ? 'moment' : 'moments'} across {data.groups.length}
					{data.groups.length === 1 ? 'year' : 'years'}
				</p>
			{/if}
		</header>

		{#if data.groups.length === 0}
			<div class="empty">
				<p>Nothing from this day — yet.</p>
				<span>As your archive grows, memories from past {data.monthDay}s will gather here.</span>
			</div>
		{:else}
			{#each data.groups as group (group.year)}
				<section class="year" data-testid={`otd-year-${group.year}`}>
					<div class="year-head">
						<span class="ago">{agoLabel(group.yearsAgo)}</span>
						<span class="year-num">{group.year}</span>
					</div>
					<MasonryGrid items={group.items} activeYear={group.year} />
				</section>
			{/each}
		{/if}
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
		background: linear-gradient(180deg, rgb(23 20 18 / 0.06) 0%, rgb(23 20 18 / 0.6) 100%);
		padding-bottom: 80px;
	}

	.hero {
		padding: clamp(2.5rem, 8vw, 6rem) 30px 1.5rem;
		text-align: center;
	}

	.eyebrow {
		font-family: var(--font-sans);
		font-size: 12px;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
	}

	h1 {
		margin: 0.4rem 0 0;
		font-family: var(--font-serif);
		font-size: clamp(2.6rem, 9vw, 5.5rem);
		font-weight: 500;
		line-height: 1.05;
		padding-bottom: 0.08em;
	}

	.sub {
		margin-top: 0.6rem;
		font-family: var(--font-sans);
		font-size: 0.8rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 66%, transparent);
	}

	.year {
		margin-top: 1rem;
	}

	.year-head {
		display: flex;
		align-items: baseline;
		gap: 14px;
		padding: 1.5rem 30px 0;
	}

	.ago {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
	}

	.year-num {
		font-family: var(--font-serif);
		font-size: 2rem;
		font-weight: 400;
		line-height: 1;
	}

	.year :global(.masonry) {
		padding: 0.75rem 30px 1rem;
	}

	.year :global(.card),
	.year :global(.month) {
		--timeline-chrome: var(--cream);
		--timeline-strong: color-mix(in srgb, var(--cream) 76%, transparent);
		--timeline-muted: color-mix(in srgb, var(--cream) 58%, transparent);
		--timeline-soft: color-mix(in srgb, var(--cream) 12%, transparent);
	}

	.empty {
		padding: 2rem 30px;
		text-align: center;
	}

	.empty p {
		font-family: var(--font-serif);
		font-size: 1.4rem;
	}

	.empty span {
		display: block;
		margin-top: 0.5rem;
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--cream) 62%, transparent);
	}

	@media (max-width: 640px) {
		.hero {
			padding-inline: 18px;
		}

		.year-head {
			padding-inline: 18px;
		}

		.year :global(.masonry) {
			padding-inline: 18px;
		}
	}
</style>
