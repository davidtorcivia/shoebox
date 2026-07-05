import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
	albumItems,
	albums,
	itemFiles,
	itemPeople,
	items,
	itemTags,
	people,
	tags
} from '$lib/server/db/schema';
import {
	displayDate,
	isValidItemDate,
	shortDate,
	sortDate as computeSortDate,
	yearOf,
	type ItemDate
} from '$lib/domain/dates';
import { bumpYearCount } from '$lib/server/aggregates';
import { ROLE_RANK } from '$lib/server/roles';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO } from '$lib/types';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;
type ItemRow = typeof items.$inferSelect;

export type { ItemDTO } from '$lib/types';

export type FileKind = 'original' | 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite';

export interface ItemFileInput {
	kind: FileKind;
	storageKey: string;
	mime: string;
	width: number | null;
	height: number | null;
}

export interface CreateItemInput {
	id?: string;
	type: 'video' | 'photo';
	title: string | null;
	description: string | null;
	tapeLabel: string | null;
	date: ItemDate;
	duration: number | null;
	width: number;
	height: number;
	sizeBytes: number;
	sha256: string;
	source: 'upload' | 'ingest';
	blurhash: string | null;
	files: ItemFileInput[];
	people: string[];
	tags: string[];
	uploadedBy: string;
}

export function normalizeTagName(name: string): string {
	return name.trim().toLowerCase();
}

export function canModifyItem(user: SessionUser, row: { uploadedBy: string }): boolean {
	return ROLE_RANK[user.role] >= ROLE_RANK.editor || row.uploadedBy === user.id;
}

export async function setItemPeople(db: Db, itemId: string, personIds: string[]): Promise<void> {
	const ids = [...new Set(personIds)];
	if (ids.length > 0) {
		const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, ids));
		if (found.length !== ids.length) throw error(400, 'unknown person id');
	}

	await db.delete(itemPeople).where(eq(itemPeople.itemId, itemId));
	if (ids.length > 0) {
		await db
			.insert(itemPeople)
			.values(ids.map((personId) => ({ itemId, personId, source: 'manual' as const })));
	}
}

export async function setItemTags(db: Db, itemId: string, names: string[]): Promise<void> {
	const normalized = [...new Set(names.map(normalizeTagName).filter((name) => name.length > 0))];
	await db.delete(itemTags).where(eq(itemTags.itemId, itemId));
	if (normalized.length === 0) return;

	await db
		.insert(tags)
		.values(normalized.map((name) => ({ id: nanoid(12), name, kind: 'topic' as const })))
		.onConflictDoNothing();

	const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, normalized));
	await db.insert(itemTags).values(rows.map((row) => ({ itemId, tagId: row.id })));
}

export async function createItem(
	db: Db,
	storage: StorageAdapter,
	queue: JobQueueAdapter,
	input: CreateItemInput
): Promise<ItemDTO> {
	if (!isValidItemDate(input.date)) throw error(400, 'invalid date');

	const id = input.id ?? nanoid(12);
	const sortDate = computeSortDate(input.date);
	const status = input.date.precision === 'unknown' ? 'needs_review' : 'ready';
	const personIds = [...new Set(input.people)];

	if (personIds.length > 0) {
		const found = await db
			.select({ id: people.id })
			.from(people)
			.where(inArray(people.id, personIds));
		if (found.length !== personIds.length) throw error(400, 'unknown person id');
	}

	await db.insert(items).values({
		id,
		type: input.type,
		title: input.title,
		description: input.description,
		dateStart: input.date.dateStart,
		dateEnd: input.date.dateEnd,
		datePrecision: input.date.precision,
		sortDate,
		duration: input.duration,
		width: input.width,
		height: input.height,
		sizeBytes: input.sizeBytes,
		sha256: input.sha256,
		blurhash: input.blurhash,
		source: input.source,
		tapeLabel: input.tapeLabel,
		status,
		uploadedBy: input.uploadedBy,
		createdAt: new Date()
	});

	if (input.files.length > 0) {
		await db.insert(itemFiles).values(
			input.files.map((file) => ({
				id: nanoid(12),
				itemId: id,
				kind: file.kind,
				storageKey: file.storageKey,
				mime: file.mime,
				width: file.width,
				height: file.height
			}))
		);
	}

	await setItemPeople(db, id, personIds);
	await setItemTags(db, id, input.tags);
	await bumpYearCount(db, yearOf(input.date), input.type, 1);

	await queue.enqueue('derivatives', { itemId: id });
	if (input.type === 'video') {
		await queue.enqueue('sprite', { itemId: id });
	}

	const dto = await getItemDTO(db, storage, id);
	if (!dto) throw error(500, 'item creation failed');
	return dto;
}

export async function buildItemDTOs(
	db: Db,
	storage: StorageAdapter,
	rows: ItemRow[]
): Promise<ItemDTO[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((row) => row.id);

	const files = await db.select().from(itemFiles).where(inArray(itemFiles.itemId, ids));
	const itemPeopleRows = await db
		.select({
			itemId: itemPeople.itemId,
			id: people.id,
			name: people.name,
			accentColor: people.accentColor
		})
		.from(itemPeople)
		.innerJoin(people, eq(itemPeople.personId, people.id))
		.where(inArray(itemPeople.itemId, ids));
	const itemTagRows = await db
		.select({ itemId: itemTags.itemId, id: tags.id, name: tags.name, kind: tags.kind })
		.from(itemTags)
		.innerJoin(tags, eq(itemTags.tagId, tags.id))
		.where(inArray(itemTags.itemId, ids));
	const albumRows = await db
		.select({ itemId: albumItems.itemId, id: albums.id, title: albums.title })
		.from(albumItems)
		.innerJoin(albums, eq(albumItems.albumId, albums.id))
		.where(and(inArray(albumItems.itemId, ids), isNull(albums.deletedAt)));

	const out: ItemDTO[] = [];
	for (const row of rows) {
		const date: ItemDate = {
			dateStart: row.dateStart,
			dateEnd: row.dateEnd,
			precision: row.datePrecision
		};
		const urls: ItemDTO['urls'] = { poster: '', thumb400: '', thumb800: '', thumb1600: '' };

		for (const file of files.filter((file) => file.itemId === row.id)) {
			const url = await storage.mediaUrl(file.storageKey);
			if (file.kind === 'poster') urls.poster = url;
			else if (file.kind === 'thumb_400') urls.thumb400 = url;
			else if (file.kind === 'thumb_800') urls.thumb800 = url;
			else if (file.kind === 'thumb_1600') urls.thumb1600 = url;
			else if (file.kind === 'original') urls.original = url;
			else if (file.kind === 'sprite') urls.sprite = url;
		}

		out.push({
			id: row.id,
			type: row.type,
			title: row.title,
			description: row.description,
			date,
			displayDate: displayDate(date),
			shortDate: shortDate(date),
			duration: row.duration,
			width: row.width,
			height: row.height,
			status: row.status,
			urls,
			blurhash: row.blurhash ?? null,
			people: itemPeopleRows
				.filter((person) => person.itemId === row.id)
				.map((person) => ({
					id: person.id,
					name: person.name,
					accentColor: person.accentColor
				})),
			tags: itemTagRows
				.filter((tag) => tag.itemId === row.id)
				.map((tag) => ({ id: tag.id, name: tag.name, kind: tag.kind })),
			albums: albumRows
				.filter((album) => album.itemId === row.id)
				.map((album) => ({ id: album.id, title: album.title })),
			uploadedBy: row.uploadedBy,
			tapeLabel: row.tapeLabel
		});
	}

	return out;
}

export async function getItemDTO(
	db: Db,
	storage: StorageAdapter,
	id: string,
	opts?: { includeDeleted?: boolean }
): Promise<ItemDTO | null> {
	const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
	if (rows.length === 0) return null;
	if (rows[0].deletedAt && !opts?.includeDeleted) return null;
	return (await buildItemDTOs(db, storage, rows))[0];
}

export interface ListItemsQuery {
	year?: number;
	month?: number;
	people?: string[];
	tags?: string[];
	type?: 'video' | 'photo';
	album?: string;
	status?: 'processing' | 'needs_review' | 'ready';
	q?: string;
	cursor?: string;
	limit?: number;
}

export interface Cursor {
	s: string | null;
	id: string;
}

export interface UpdateItemInput {
	title?: string | null;
	description?: string | null;
	tapeLabel?: string | null;
	date?: ItemDate;
	people?: string[];
	tags?: string[];
}

export function encodeCursor(cursor: Cursor): string {
	return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): Cursor {
	const padded = cursor
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(cursor.length / 4) * 4, '=');
	const parsed = JSON.parse(atob(padded)) as Cursor;
	if (typeof parsed.id !== 'string' || !('s' in parsed)) throw new Error('invalid cursor');
	return parsed;
}

export async function listItems(
	db: Db,
	storage: StorageAdapter,
	query: ListItemsQuery
): Promise<{ items: ItemDTO[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
	let rows = await db.select().from(items).where(isNull(items.deletedAt));

	if (query.type) rows = rows.filter((row) => row.type === query.type);
	if (query.status) rows = rows.filter((row) => row.status === query.status);
	if (query.year) {
		const prefix = String(query.year).padStart(4, '0');
		rows = rows.filter((row) => row.sortDate?.startsWith(prefix));
	}
	if (query.month && query.year) {
		const prefix = `${String(query.year).padStart(4, '0')}-${String(query.month).padStart(2, '0')}`;
		rows = rows.filter((row) => row.sortDate?.startsWith(prefix));
	}
	if (query.q?.trim()) {
		const q = query.q.trim().toLowerCase();
		rows = rows.filter((row) =>
			[row.title, row.description].some((value) => value?.toLowerCase().includes(q))
		);
	}
	if (query.album) {
		const albumRows = await db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.where(eq(albumItems.albumId, query.album));
		const allowed = new Set(albumRows.map((row) => row.itemId));
		rows = rows.filter((row) => allowed.has(row.id));
	}
	if (query.people?.length) {
		const linked = await db
			.select({ itemId: itemPeople.itemId, personId: itemPeople.personId })
			.from(itemPeople)
			.where(inArray(itemPeople.personId, query.people));
		rows = rows.filter((row) => {
			const linkedPeople = new Set(
				linked.filter((link) => link.itemId === row.id).map((link) => link.personId)
			);
			return query.people!.every((personId) => linkedPeople.has(personId));
		});
	}
	if (query.tags?.length) {
		const tagNames = query.tags.map(normalizeTagName).filter(Boolean);
		const linked = await db
			.select({ itemId: itemTags.itemId, name: tags.name })
			.from(itemTags)
			.innerJoin(tags, eq(itemTags.tagId, tags.id))
			.where(inArray(tags.name, tagNames));
		rows = rows.filter((row) => {
			const linkedTags = new Set(
				linked.filter((link) => link.itemId === row.id).map((link) => link.name)
			);
			return tagNames.every((name) => linkedTags.has(name));
		});
	}

	rows.sort(compareItemRows);
	if (query.cursor) {
		const cursor = decodeCursor(query.cursor);
		const index = rows.findIndex((row) => row.id === cursor.id && row.sortDate === cursor.s);
		if (index >= 0) rows = rows.slice(index + 1);
	}

	const page = rows.slice(0, limit);
	const hasMore = rows.length > limit;
	const last = page.at(-1);
	const nextCursor = hasMore && last ? encodeCursor({ s: last.sortDate, id: last.id }) : null;

	return { items: await buildItemDTOs(db, storage, page), nextCursor };
}

export async function updateItem(
	db: Db,
	storage: StorageAdapter,
	user: SessionUser,
	id: string,
	patch: UpdateItemInput
): Promise<ItemDTO> {
	const row = await getItemRow(db, id, { includeDeleted: true });
	if (!row) throw error(404, 'item not found');
	if (!canModifyItem(user, row)) throw error(403, 'cannot modify item');

	const beforeYear = yearOf({
		dateStart: row.dateStart,
		dateEnd: row.dateEnd,
		precision: row.datePrecision
	});
	const nextDate = patch.date ?? {
		dateStart: row.dateStart,
		dateEnd: row.dateEnd,
		precision: row.datePrecision
	};
	if (!isValidItemDate(nextDate)) throw error(400, 'invalid date');
	const afterYear = yearOf(nextDate);
	const nextStatus =
		nextDate.precision === 'unknown'
			? 'needs_review'
			: row.status === 'processing'
				? 'processing'
				: 'ready';

	await db
		.update(items)
		.set({
			title: patch.title === undefined ? row.title : patch.title,
			description: patch.description === undefined ? row.description : patch.description,
			tapeLabel: patch.tapeLabel === undefined ? row.tapeLabel : patch.tapeLabel,
			dateStart: nextDate.dateStart,
			dateEnd: nextDate.dateEnd,
			datePrecision: nextDate.precision,
			sortDate: computeSortDate(nextDate),
			status: nextStatus
		})
		.where(eq(items.id, id));

	if (!row.deletedAt && beforeYear !== afterYear) {
		await bumpYearCount(db, beforeYear, row.type, -1);
		await bumpYearCount(db, afterYear, row.type, 1);
	}
	if (patch.people) await setItemPeople(db, id, patch.people);
	if (patch.tags) await setItemTags(db, id, patch.tags);

	const dto = await getItemDTO(db, storage, id, { includeDeleted: Boolean(row.deletedAt) });
	if (!dto) throw error(500, 'item update failed');
	return dto;
}

export async function deleteItem(db: Db, id: string): Promise<void> {
	const row = await getItemRow(db, id);
	if (!row) throw error(404, 'item not found');
	await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, id));
	await bumpYearCount(
		db,
		yearOf({ dateStart: row.dateStart, dateEnd: row.dateEnd, precision: row.datePrecision }),
		row.type,
		-1
	);
}

export async function restoreItem(db: Db, storage: StorageAdapter, id: string): Promise<ItemDTO> {
	const row = await getItemRow(db, id, { includeDeleted: true });
	if (!row) throw error(404, 'item not found');
	await db.update(items).set({ deletedAt: null }).where(eq(items.id, id));
	await bumpYearCount(
		db,
		yearOf({ dateStart: row.dateStart, dateEnd: row.dateEnd, precision: row.datePrecision }),
		row.type,
		1
	);
	const dto = await getItemDTO(db, storage, id);
	if (!dto) throw error(500, 'item restore failed');
	return dto;
}

function compareItemRows(a: ItemRow, b: ItemRow): number {
	if (a.sortDate && b.sortDate && a.sortDate !== b.sortDate)
		return a.sortDate.localeCompare(b.sortDate);
	if (a.sortDate && !b.sortDate) return -1;
	if (!a.sortDate && b.sortDate) return 1;
	return a.id.localeCompare(b.id);
}

async function getItemRow(
	db: Db,
	id: string,
	opts?: { includeDeleted?: boolean }
): Promise<ItemRow | null> {
	const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
	if (rows.length === 0) return null;
	if (rows[0].deletedAt && !opts?.includeDeleted) return null;
	return rows[0];
}
