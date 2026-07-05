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
		const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, personIds));
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
				.map(({ itemId: _itemId, ...person }) => person),
			tags: itemTagRows
				.filter((tag) => tag.itemId === row.id)
				.map(({ itemId: _itemId, ...tag }) => tag),
			albums: albumRows
				.filter((album) => album.itemId === row.id)
				.map(({ itemId: _itemId, ...album }) => album),
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

