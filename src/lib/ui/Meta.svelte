<script lang="ts">
	// Open Graph + Twitter card tags for rich link previews. `image` and `url`
	// must be absolute (the layout resolves them against the request origin).
	let {
		title,
		description,
		image,
		url,
		type = 'website',
		imageAlt = ''
	}: {
		title: string;
		description: string;
		image: string;
		url: string;
		type?: 'website' | 'article';
		imageAlt?: string;
	} = $props();
</script>

<svelte:head>
	<meta name="description" content={description} />
	<meta property="og:site_name" content="Shoebox" />
	<meta property="og:type" content={type} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={imageAlt || title} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={image} />
</svelte:head>
