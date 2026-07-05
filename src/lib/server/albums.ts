import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AlbumDTO } from '$lib/domain/album-dto';
import { ACCENTS } from '$lib/ui/tokens';
import type { SessionUser } from '$lib/server/auth';
import type { Db } from '$lib/server/db';
import { albumItems, albums, itemFiles, items, users } from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';
import { ROLE_RANK } from '$lib/server/roles';
import { reindexItem, reindexItemsForAlbum } from '$lib/server/search';

type AlbumRow = typeof albums.$inferSelect;
type AlbumPatch = Partial<Pick<typeof albums.$inferInsert, 'title' | 'description' | 'coverItemId'>>;

export async function listAlbums(db: Db, storage: StorageAdapter): Promise<AlbumDTO[]> {
	const rows = await db
		.select()
		.from(albums)
		.where(isNull(albums.deletedAt))
		.orderBy(desc(albums.createdAt));
	return toDTOs(db, storage, rows);
}

export async function createAlbum(
	db: Db,
	user: SessionUser,
	input: { title: string; description?: string | null }
): Promise<AlbumDTO> {
	const title = input.title.trim();
	if (!title) error(400, 'title is required');

	const id = nanoid(12);
	const createdAt = new Date();
	const description = input.description ?? null;
	await db.insert(albums).values({
		id,
		title,
		description,
		coverItemId: null,
		createdBy: user.id,
		createdAt
	});

	return {
		id,
		title,
		description,
		coverItemId: null,
		coverUrl: null,
		itemCount: 0,
		createdBy: { id: user.id, username: user.username, accentColor: user.accentColor },
		createdAt: createdAt.toISOString()
	};
}

export async function getAlbumDetail(
	db: Db,
	storage: StorageAdapter,
	id: string
): Promise<{ album: AlbumDTO; itemIds: string[] } | null> {
	const row = await liveAlbum(db, id);
	if (!row) return null;

	const members = await db
		.select({ itemId: albumItems.itemId })
		.from(albumItems)
		.where(eq(albumItems.albumId, id))
		.orderBy(asc(albumItems.position));
	const [album] = await toDTOs(db, storage, [row]);
	return { album, itemIds: members.map((member) => member.itemId) };
}

export function canEditAlbum(user: SessionUser, album: { createdBy: { id: string } }): boolean {
	return ROLE_RANK[user.role] >= ROLE_RANK.editor || album.createdBy.id === user.id;
}

export async function updateAlbum(
	db: Db,
	id: string,
	patch: { title?: string; description?: string | null; coverItemId?: string | null }
): Promise<void> {
	const row = await liveAlbum(db, id);
	if (!row) error(404, 'album not found');

	const set: AlbumPatch = {};
	if (patch.title !== undefined) {
		const title = patch.title.trim();
		if (!title) error(400, 'title is required');
		set.title = title;
	}
	if (patch.description !== undefined) set.description = patch.description;
	if (patch.coverItemId !== undefined) {
		if (patch.coverItemId !== null) {
			const members = await memberIds(db, id);
			if (!members.includes(patch.coverItemId)) error(400, 'cover must be an album member');
		}
		set.coverItemId = patch.coverItemId;
	}

	if (Object.keys(set).length > 0) await db.update(albums).set(set).where(eq(albums.id, id));
	if (set.title !== undefined) await reindexItemsForAlbum(db, id);
}

export async function softDeleteAlbum(db: Db, id: string): Promise<void> {
	const row = await liveAlbum(db, id);
	if (!row) error(404, 'album not found');
	await db.update(albums).set({ deletedAt: new Date() }).where(eq(albums.id, id));
	await reindexItemsForAlbum(db, id);
}

export async function addAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');

	const uniqueInput = [...new Set(itemIds)];
	if (uniqueInput.length === 0) return;
	await validateLiveItems(db, uniqueInput);

	const existing = await memberIds(db, albumId);
	const existingSet = new Set(existing);
	const toAdd = uniqueInput.filter((itemId) => !existingSet.has(itemId));
	if (toAdd.length === 0) return;

	let next = await nextPosition(db, albumId);
	await db.insert(albumItems).values(
		toAdd.map((itemId) => ({
			albumId,
			itemId,
			position: next++
		}))
	);

	if (!row.coverItemId) {
		await db.update(albums).set({ coverItemId: toAdd[0] }).where(eq(albums.id, albumId));
	}
	for (const itemId of toAdd) await reindexItem(db, itemId);
}

export async function removeAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');
	const uniqueInput = [...new Set(itemIds)];
	if (uniqueInput.length === 0) return;

	await db
		.delete(albumItems)
		.where(and(eq(albumItems.albumId, albumId), inArray(albumItems.itemId, uniqueInput)));

	if (row.coverItemId && uniqueInput.includes(row.coverItemId)) {
		const remaining = await memberIds(db, albumId);
		await db
			.update(albums)
			.set({ coverItemId: remaining[0] ?? null })
			.where(eq(albums.id, albumId));
	}
	for (const itemId of uniqueInput) await reindexItem(db, itemId);
}

export async function reorderAlbum(
	db: Db,
	albumId: string,
	positions: { itemId: string; position: number }[]
): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');

	const members = new Set(await memberIds(db, albumId));
	const seen = new Set<string>();
	for (const update of positions) {
		if (!members.has(update.itemId)) error(400, 'position update for a non-member item');
		if (seen.has(update.itemId)) error(400, 'duplicate item position');
		if (!Number.isInteger(update.position) || update.position < 0) error(400, 'invalid position');
		seen.add(update.itemId);
	}

	for (const update of positions) {
		await db
			.update(albumItems)
			.set({ position: update.position })
			.where(and(eq(albumItems.albumId, albumId), eq(albumItems.itemId, update.itemId)));
	}
}

async function toDTOs(db: Db, storage: StorageAdapter, rows: AlbumRow[]): Promise<AlbumDTO[]> {
	if (rows.length === 0) return [];

	const ids = rows.map((row) => row.id);
	const countRows = await db
		.select({ albumId: albumItems.albumId, count: sql<number>`count(*)` })
		.from(albumItems)
		.where(inArray(albumItems.albumId, ids))
		.groupBy(albumItems.albumId);
	const counts = new Map(countRows.map((row) => [row.albumId, Number(row.count)]));

	const creatorIds = [...new Set(rows.map((row) => row.createdBy))];
	const creatorRows = await db
		.select({ id: users.id, username: users.username, accentColor: users.accentColor })
		.from(users)
		.where(inArray(users.id, creatorIds));
	const creators = new Map(creatorRows.map((creator) => [creator.id, creator]));

	const coverIds = rows.map((row) => row.coverItemId).filter((id): id is string => Boolean(id));
	const coverRows =
		coverIds.length > 0
			? await db
					.select({ itemId: itemFiles.itemId, key: itemFiles.storageKey })
					.from(itemFiles)
					.where(and(inArray(itemFiles.itemId, coverIds), eq(itemFiles.kind, 'thumb_400')))
			: [];
	const coverKeys = new Map(coverRows.map((cover) => [cover.itemId, cover.key]));

	const out: AlbumDTO[] = [];
	for (const row of rows) {
		const creator = creators.get(row.createdBy);
		const coverKey = row.coverItemId ? coverKeys.get(row.coverItemId) : undefined;
		out.push({
			id: row.id,
			title: row.title,
			description: row.description,
			coverItemId: row.coverItemId,
			coverUrl: coverKey ? await storage.mediaUrl(coverKey) : null,
			itemCount: counts.get(row.id) ?? 0,
			createdBy: creator ?? { id: row.createdBy, username: 'Unknown', accentColor: ACCENTS[0].hex },
			createdAt: row.createdAt.toISOString()
		});
	}
	return out;
}

async function liveAlbum(db: Db, id: string): Promise<AlbumRow | null> {
	const row = (await db.select().from(albums).where(eq(albums.id, id)).limit(1))[0];
	return row && !row.deletedAt ? row : null;
}

async function memberIds(db: Db, albumId: string): Promise<string[]> {
	return (
		await db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.where(eq(albumItems.albumId, albumId))
			.orderBy(asc(albumItems.position))
	).map((member) => member.itemId);
}

async function nextPosition(db: Db, albumId: string): Promise<number> {
	const [{ maxPosition }] = await db
		.select({ maxPosition: sql<number | null>`max(${albumItems.position})` })
		.from(albumItems)
		.where(eq(albumItems.albumId, albumId));
	return maxPosition == null ? 0 : Number(maxPosition) + 1;
}

async function validateLiveItems(db: Db, itemIds: string[]): Promise<void> {
	const found = await db
		.select({ id: items.id })
		.from(items)
		.where(and(inArray(items.id, itemIds), isNull(items.deletedAt)));
	if (found.length !== itemIds.length) error(400, 'unknown item id');
}
