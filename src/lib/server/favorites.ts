import { error } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { favorites, items } from '$lib/server/db/schema';
import { getItemDTOsByIds } from '$lib/server/items';
import type { Db } from '$lib/server/db';
import type { StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO } from '$lib/types';

export async function isFavorited(db: Db, userId: string, itemId: string): Promise<boolean> {
	const row = (
		await db
			.select({ itemId: favorites.itemId })
			.from(favorites)
			.where(and(eq(favorites.userId, userId), eq(favorites.itemId, itemId)))
			.limit(1)
	)[0];
	return Boolean(row);
}

/** Toggle a personal favorite; returns the new favorited state. */
export async function toggleFavorite(db: Db, userId: string, itemId: string): Promise<boolean> {
	const item = (
		await db
			.select({ id: items.id })
			.from(items)
			.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
			.limit(1)
	)[0];
	if (!item) error(404, 'item not found');

	if (await isFavorited(db, userId, itemId)) {
		await db
			.delete(favorites)
			.where(and(eq(favorites.userId, userId), eq(favorites.itemId, itemId)));
		return false;
	}
	await db.insert(favorites).values({ userId, itemId, createdAt: new Date() });
	return true;
}

/** The user's saved items, newest-saved first (deleted items drop out). */
export async function listFavorites(
	db: Db,
	storage: StorageAdapter,
	userId: string
): Promise<ItemDTO[]> {
	const rows = await db
		.select({ itemId: favorites.itemId })
		.from(favorites)
		.where(eq(favorites.userId, userId))
		.orderBy(desc(favorites.createdAt));
	if (rows.length === 0) return [];
	return getItemDTOsByIds(
		db,
		storage,
		rows.map((row) => row.itemId)
	);
}
