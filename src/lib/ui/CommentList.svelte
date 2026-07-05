<script module lang="ts">
	export interface CommentView {
		id: string;
		body: string;
		createdAt: string;
		user: { id: string; username: string; accentColor: string };
		canDelete?: boolean;
	}
</script>

<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import { relativeTime } from './relative-time';

	let {
		comments,
		canDelete,
		ondelete
	}: {
		comments: CommentView[];
		canDelete: (comment: CommentView) => boolean;
		ondelete: (id: string) => void | Promise<void>;
	} = $props();
</script>

<ul class="comments" data-testid="comment-list">
	{#each comments as comment (comment.id)}
		<li>
			<div class="head">
				<Avatar name={comment.user.username} accentColor={comment.user.accentColor} size={19} />
				<span class="who" style:color={comment.user.accentColor} data-testid="comment-username">
					{comment.user.username}
				</span>
				<span class="when">{relativeTime(comment.createdAt)}</span>
				{#if canDelete(comment)}
					<button
						class="x"
						type="button"
						aria-label="Delete comment"
						onclick={() => ondelete(comment.id)}
					>
						x
					</button>
				{/if}
			</div>
			<p class="body">{comment.body}</p>
		</li>
	{/each}
</ul>

<style>
	.comments {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		margin-bottom: 18px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 9px;
	}

	.who {
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.when {
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.1em;
	}

	.x {
		min-width: 32px;
		min-height: 32px;
		margin-left: auto;
		border: 0;
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		cursor: pointer;
		font-size: 15px;
	}

	.body {
		margin: 6px 0 0;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.6;
	}
</style>
