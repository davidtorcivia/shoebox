<script lang="ts">
	export type FaceOverlay = {
		id: string;
		box: { x: number; y: number; w: number; h: number };
		person: { id: string; slug: string; name: string; accentColor: string };
	};

	let { faces }: { faces: FaceOverlay[] } = $props();
</script>

<div class="face-boxes" aria-label="Faces">
	{#each faces as face (face.id)}
		<a
			class="face"
			data-testid="face-box"
			href={`/people/${face.person.slug}`}
			style={`--x:${face.box.x * 100}%;--y:${face.box.y * 100}%;--w:${face.box.w * 100}%;--h:${face.box.h * 100}%;--accent:${face.person.accentColor};`}
		>
			<span>{face.person.name}</span>
		</a>
	{/each}
</div>

<style>
	.face-boxes {
		position: absolute;
		inset: 0;
		z-index: 4;
		pointer-events: none;
	}

	.face {
		position: absolute;
		left: var(--x);
		top: var(--y);
		width: var(--w);
		height: var(--h);
		border: 1px solid var(--cream);
		color: var(--cream);
		pointer-events: auto;
		text-decoration: none;
		box-shadow:
			0 0 0 1px rgb(0 0 0 / 0.24),
			inset 0 0 0 1px color-mix(in srgb, var(--accent) 65%, transparent);
	}

	.face span {
		position: absolute;
		left: -1px;
		bottom: calc(100% + 4px);
		max-width: min(220px, 70vw);
		overflow: hidden;
		padding: 4px 6px;
		background: color-mix(in srgb, var(--ink) 82%, var(--accent));
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}
</style>
