import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { items, reactions } from '$lib/server/db/schema';
import type { Db } from '$lib/server/db';

// A small, curated palette so reactions stay tidy and renderable everywhere.
export const REACTION_EMOJI = ['❤️', '😂', '😮', '😢', '👍', '🎉'] as const;

export interface ReactionSummary {
	emoji: string;
	count: number;
	mine: boolean;
}

export async function listReactions(
	db: Db,
	itemId: string,
	userId: string
): Promise<ReactionSummary[]> {
	const rows = await db.select().from(reactions).where(eq(reactions.itemId, itemId));
	const byEmoji = new Map<string, { count: number; mine: boolean }>();
	for (const row of rows) {
		const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false };
		entry.count += 1;
		if (row.userId === userId) entry.mine = true;
		byEmoji.set(row.emoji, entry);
	}
	// Keep the palette order stable.
	return REACTION_EMOJI.filter((emoji) => byEmoji.has(emoji)).map((emoji) => ({
		emoji,
		...byEmoji.get(emoji)!
	}));
}

/** Toggle the viewer's reaction of `emoji` on an item; returns the fresh summary. */
export async function toggleReaction(
	db: Db,
	itemId: string,
	userId: string,
	emoji: string
): Promise<ReactionSummary[]> {
	if (!(REACTION_EMOJI as readonly string[]).includes(emoji)) error(400, 'unsupported reaction');
	const item = (
		await db
			.select({ id: items.id })
			.from(items)
			.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
			.limit(1)
	)[0];
	if (!item) error(404, 'item not found');

	const existing = (
		await db
			.select({ emoji: reactions.emoji })
			.from(reactions)
			.where(
				and(eq(reactions.itemId, itemId), eq(reactions.userId, userId), eq(reactions.emoji, emoji))
			)
			.limit(1)
	)[0];

	if (existing) {
		await db
			.delete(reactions)
			.where(
				and(eq(reactions.itemId, itemId), eq(reactions.userId, userId), eq(reactions.emoji, emoji))
			);
	} else {
		await db.insert(reactions).values({ itemId, userId, emoji, createdAt: new Date() });
	}
	return listReactions(db, itemId, userId);
}
