import { and, eq, isNull } from 'drizzle-orm';
import { albumItems, albums, itemFiles, items, shares } from './db/schema';

const KEY_RE = /^media\/([A-Za-z0-9_-]+)\//;

export async function canAccessMedia(locals: App.Locals, key: string): Promise<boolean> {
	if (locals.user) return true;

	const tokens = locals.shareTokens ?? [];
	if (tokens.length === 0) return false;

	const match = KEY_RE.exec(key);
	if (!match) return false;
	const itemId = match[1];

	const owned = await locals.db
		.select({ id: itemFiles.id })
		.from(itemFiles)
		.innerJoin(items, eq(items.id, itemFiles.itemId))
		.where(
			and(eq(itemFiles.itemId, itemId), eq(itemFiles.storageKey, key), isNull(items.deletedAt))
		)
		.limit(1);
	if (owned.length === 0) return false;

	const now = Date.now();
	for (const token of tokens) {
		const share = (
			await locals.db.select().from(shares).where(eq(shares.token, token)).limit(1)
		)[0];
		if (!share) continue;
		if (share.expiresAt && share.expiresAt.getTime() <= now) continue;
		if (share.targetType === 'item') {
			if (share.targetId === itemId) return true;
			continue;
		}

		const member = await locals.db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.innerJoin(albums, eq(albums.id, albumItems.albumId))
			.where(
				and(
					eq(albumItems.albumId, share.targetId),
					eq(albumItems.itemId, itemId),
					isNull(albums.deletedAt)
				)
			)
			.limit(1);
		if (member.length > 0) return true;
	}

	return false;
}
