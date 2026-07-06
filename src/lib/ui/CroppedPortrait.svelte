<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { cropStyle } from './crop';

	let { url, crop, name }: { url: string; crop: CropRect; name: string } = $props();
</script>

<div class="portrait">
	<img src={url} alt={name} style={cropStyle(crop)} draggable="false" loading="lazy" />
</div>

<style>
	.portrait {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
	}

	img {
		position: absolute;
		display: block;
		max-width: none;
	}
</style>
