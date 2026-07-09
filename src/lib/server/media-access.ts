import { and, eq, isNull } from 'drizzle-orm';
import { albumItems, albums, itemFiles, items, shares } from './db/schema';

const KEY_RE = /^media\/([A-Za-z0-9_-]+)\//;

/**
 * Whether the current request may access media for `itemId` — either a logged-in
 * user, or an unauthenticated share viewer whose share token covers this item
 * (directly or via an album). With `requireDownload`, the covering share must
 * also permit downloads. Mirrors {@link canAccessMedia} but at item granularity,
 * for endpoints (like clip export) that aren't keyed by a storage path.
 */
export async function canAccessItem(
	locals: App.Locals,
	itemId: string,
	opts: { requireDownload?: boolean } = {}
): Promise<boolean> {
	if (locals.user) return true;

	const tokens = locals.shareTokens ?? [];
	if (tokens.length === 0) return false;

	const alive = await locals.db
		.select({ id: items.id })
		.from(items)
		.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
		.limit(1);
	if (alive.length === 0) return false;

	const now = Date.now();
	for (const token of tokens) {
		const share = (
			await locals.db.select().from(shares).where(eq(shares.token, token)).limit(1)
		)[0];
		if (!share) continue;
		if (share.expiresAt && share.expiresAt.getTime() <= now) continue;
		if (opts.requireDownload && !share.allowDownload) continue;

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
