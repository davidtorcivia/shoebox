import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
	albumItems,
	albums,
	comments,
	faces,
	itemFiles,
	itemPeople,
	itemTags,
	items,
	shares
} from './db/schema';
import type { Db } from './db';
import type { StorageAdapter } from './platform/types';
import { reindexItem } from './search';

export const TRASH_RETENTION_DAYS = 30;

export interface TrashLists {
	items: { id: string; title: string | null; type: 'video' | 'photo'; deletedAt: Date }[];
	albums: { id: string; title: string; deletedAt: Date }[];
	comments: { id: string; body: string; itemId: string; deletedAt: Date }[];
}

export interface PurgeResult {
	items: number;
	albums: number;
	comments: number;
}

export async function listTrash(db: Db): Promise<TrashLists> {
	const deadItems = await db
		.select({ id: items.id, title: items.title, type: items.type, deletedAt: items.deletedAt })
		.from(items)
		.where(isNotNull(items.deletedAt));
	const deadAlbums = await db
		.select({ id: albums.id, title: albums.title, deletedAt: albums.deletedAt })
		.from(albums)
		.where(isNotNull(albums.deletedAt));
	const deadComments = await db
		.select({
			id: comments.id,
			body: comments.body,
			itemId: comments.itemId,
			deletedAt: comments.deletedAt
		})
		.from(comments)
		.where(isNotNull(comments.deletedAt));

	return {
		items: deadItems.map((row) => ({ ...row, deletedAt: row.deletedAt as Date })),
		albums: deadAlbums.map((row) => ({ ...row, deletedAt: row.deletedAt as Date })),
		comments: deadComments.map((row) => ({ ...row, deletedAt: row.deletedAt as Date }))
	};
}

export async function restoreTrash(
	db: Db,
	kind: 'item' | 'album' | 'comment',
	id: string
): Promise<void> {
	if (kind === 'item') {
		await db.update(items).set({ deletedAt: null }).where(eq(items.id, id));
		await reindexItem(db, id);
	} else if (kind === 'album') {
		await db.update(albums).set({ deletedAt: null }).where(eq(albums.id, id));
	} else {
		await db.update(comments).set({ deletedAt: null }).where(eq(comments.id, id));
	}
}

export async function hardDeleteItems(
	db: Db,
	storage: StorageAdapter,
	ids: string[]
): Promise<number> {
	if (ids.length === 0) return 0;
	const files = await db.select().from(itemFiles).where(inArray(itemFiles.itemId, ids));
	for (const file of files) await storage.delete(file.storageKey);

	await db.delete(faces).where(inArray(faces.itemId, ids));
	await db.delete(comments).where(inArray(comments.itemId, ids));
	await db.delete(itemPeople).where(inArray(itemPeople.itemId, ids));
	await db.delete(itemTags).where(inArray(itemTags.itemId, ids));
	await db.delete(albumItems).where(inArray(albumItems.itemId, ids));
	await db.delete(itemFiles).where(inArray(itemFiles.itemId, ids));
	await db.delete(shares).where(and(eq(shares.targetType, 'item'), inArray(shares.targetId, ids)));
	await db.delete(items).where(inArray(items.id, ids));
	for (const id of ids) await reindexItem(db, id);
	return ids.length;
}

async function hardDeleteAlbums(db: Db, ids: string[]): Promise<number> {
	if (ids.length === 0) return 0;
	await db.delete(albumItems).where(inArray(albumItems.albumId, ids));
	await db.delete(shares).where(and(eq(shares.targetType, 'album'), inArray(shares.targetId, ids)));
	await db.delete(albums).where(inArray(albums.id, ids));
	return ids.length;
}

async function hardDeleteComments(db: Db, ids: string[]): Promise<number> {
	if (ids.length === 0) return 0;
	await db.delete(comments).where(inArray(comments.id, ids));
	return ids.length;
}

async function purgeWhere(
	db: Db,
	storage: StorageAdapter,
	cutoff: Date | null
): Promise<PurgeResult> {
	const itemCond = cutoff
		? and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff))
		: isNotNull(items.deletedAt);
	const albumCond = cutoff
		? and(isNotNull(albums.deletedAt), lt(albums.deletedAt, cutoff))
		: isNotNull(albums.deletedAt);
	const commentCond = cutoff
		? and(isNotNull(comments.deletedAt), lt(comments.deletedAt, cutoff))
		: isNotNull(comments.deletedAt);

	const itemIds = (await db.select({ id: items.id }).from(items).where(itemCond)).map(
		(row) => row.id
	);
	const albumIds = (await db.select({ id: albums.id }).from(albums).where(albumCond)).map(
		(row) => row.id
	);
	const commentIds = (await db.select({ id: comments.id }).from(comments).where(commentCond)).map(
		(row) => row.id
	);

	const purgedComments = await hardDeleteComments(db, commentIds);
	const purgedItems = await hardDeleteItems(db, storage, itemIds);
	const purgedAlbums = await hardDeleteAlbums(db, albumIds);
	return { items: purgedItems, albums: purgedAlbums, comments: purgedComments };
}

export async function purgeExpired(
	db: Db,
	storage: StorageAdapter,
	now: Date = new Date()
): Promise<PurgeResult> {
	const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
	return purgeWhere(db, storage, cutoff);
}

export async function emptyTrash(db: Db, storage: StorageAdapter): Promise<PurgeResult> {
	return purgeWhere(db, storage, null);
}
