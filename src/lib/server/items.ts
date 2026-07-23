import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { periodTime } from '$lib/domain/day-period';
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
import { ageAt } from '$lib/domain/ages';
import { HOLIDAYS, holidaysFor } from '$lib/domain/holidays';
import { recomputeYearCounts } from '$lib/server/aggregates';
import { ROLE_RANK } from '$lib/server/roles';
import { reindexItem } from '$lib/server/search';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import type { CropRect } from '$lib/domain/people-dto';
import type { ItemDTO } from '$lib/types';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;
type ItemRow = typeof items.$inferSelect;
type LinkOptions = { reindex?: boolean };

export type { ItemDTO } from '$lib/types';

export type FileKind =
	'original' | 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite' | 'playback' | 'hls';

/** Image MIME types a browser renders natively. An original outside this set
 * (HEIC/HEIF, camera RAW) is shown via its webp derivative on the detail page. */
const WEB_SAFE_IMAGE_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif'
]);

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
	location?: string | null;
	lat?: number | null;
	lng?: number | null;
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

export async function setItemPeople(
	db: Db,
	itemId: string,
	personIds: string[],
	opts: LinkOptions = {}
): Promise<void> {
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
	if (opts.reindex !== false) await reindexItem(db, itemId);
}

export async function setItemTags(
	db: Db,
	itemId: string,
	names: string[],
	opts: LinkOptions = {}
): Promise<void> {
	const normalized = [...new Set(names.map(normalizeTagName).filter((name) => name.length > 0))];
	await db.delete(itemTags).where(eq(itemTags.itemId, itemId));
	if (normalized.length === 0) {
		if (opts.reindex !== false) await reindexItem(db, itemId);
		return;
	}

	await db
		.insert(tags)
		.values(normalized.map((name) => ({ id: nanoid(12), name, kind: 'topic' as const })))
		.onConflictDoNothing();

	const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, normalized));
	await db.insert(itemTags).values(rows.map((row) => ({ itemId, tagId: row.id })));
	if (opts.reindex !== false) await reindexItem(db, itemId);
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
	// Everything lands in arrivals for review first — nothing reaches the timeline
	// until it's approved, regardless of whether we could guess a date.
	const status = 'needs_review';
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
		location: input.location ?? null,
		lat: input.lat ?? null,
		lng: input.lng ?? null,
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

	await setItemPeople(db, id, personIds, { reindex: false });
	await setItemTags(db, id, input.tags, { reindex: false });
	// Not counted toward the timeline until approved in arrivals.
	await applyHolidayTags(db, id);
	await reindexItem(db, id);

	await queue.enqueue('derivatives', { itemId: id });
	if (input.type === 'video') {
		await queue.enqueue('sprite', { itemId: id });
		await queue.enqueue('transcode', { itemId: id });
		// Adaptive-streaming ladder for larger videos; the handler no-ops (and adds
		// no files) below 720p so small clips don't grow the library.
		await queue.enqueue('hls', { itemId: id });
	}

	const dto = await getItemDTO(db, storage, id);
	if (!dto) throw error(500, 'item creation failed');
	return dto;
}

function parsePersonCrop(raw: string | null): CropRect | null {
	if (!raw) return null;
	try {
		const crop = JSON.parse(raw) as CropRect;
		return [crop?.x, crop?.y, crop?.w, crop?.h].every((n) => typeof n === 'number')
			? { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
			: null;
	} catch {
		return null;
	}
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
			slug: people.slug,
			name: people.name,
			accentColor: people.accentColor,
			birthdate: people.birthdate,
			deathDate: people.deathDate,
			avatarItemId: people.avatarItemId,
			avatarCrop: people.avatarCrop
		})
		.from(itemPeople)
		.innerJoin(people, eq(itemPeople.personId, people.id))
		.where(inArray(itemPeople.itemId, ids));

	// Resolve each tagged person's own avatar thumbnail (a different item's
	// derivative) so People chips can show a face instead of a letter.
	const avatarItemIds = [
		...new Set(
			itemPeopleRows.map((person) => person.avatarItemId).filter((id): id is string => Boolean(id))
		)
	];
	const avatarUrlByItem = new Map<string, string>();
	if (avatarItemIds.length > 0) {
		const avatarFiles = await db
			.select({ itemId: itemFiles.itemId, key: itemFiles.storageKey })
			.from(itemFiles)
			.where(and(inArray(itemFiles.itemId, avatarItemIds), eq(itemFiles.kind, 'thumb_400')));
		for (const file of avatarFiles) {
			avatarUrlByItem.set(file.itemId, await storage.mediaUrl(file.key));
		}
	}
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

		// When the user has picked a poster frame we overwrite poster.webp and the
		// thumbnails in place (same keys), so bust their cache with the chosen time
		// — otherwise the browser keeps showing the previously cached image.
		const bust = row.type === 'video' && row.posterTime != null ? `?v=${row.posterTime}` : '';
		let originalWebSafe = true;
		for (const file of files.filter((file) => file.itemId === row.id)) {
			const url = await storage.mediaUrl(file.storageKey);
			if (file.kind === 'poster') urls.poster = url + bust;
			else if (file.kind === 'thumb_400') urls.thumb400 = url + bust;
			else if (file.kind === 'thumb_800') urls.thumb800 = url + bust;
			else if (file.kind === 'thumb_1600') urls.thumb1600 = url + bust;
			else if (file.kind === 'original') {
				urls.original = url;
				// HEIC/RAW originals aren't browser-renderable; the detail view must
				// fall back to the webp derivative and only link them for download.
				originalWebSafe = row.type === 'video' || WEB_SAFE_IMAGE_MIME.has(file.mime);
			} else if (file.kind === 'playback') urls.playback = url;
			else if (file.kind === 'hls') urls.hls = url;
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
			posterTime: row.posterTime,
			captureTime: row.captureTime,
			width: row.width,
			height: row.height,
			status: row.status,
			urls,
			originalWebSafe,
			blurhash: row.blurhash ?? null,
			people: itemPeopleRows
				.filter((person) => person.itemId === row.id)
				.map((person) => {
					// Age at the item's date. Only "day" precision is exact; broader
					// precisions (month/year/range) yield an approximate "circa" age.
					const age =
						date.dateStart && person.birthdate
							? ageAt(person.birthdate, date.dateStart, person.deathDate)
							: null;
					const avatarUrl = person.avatarItemId
						? (avatarUrlByItem.get(person.avatarItemId) ?? null)
						: null;
					const avatarCrop = parsePersonCrop(person.avatarCrop);
					return {
						id: person.id,
						slug: person.slug,
						name: person.name,
						accentColor: person.accentColor,
						avatarUrl: avatarUrl && avatarCrop ? avatarUrl : null,
						avatarCrop: avatarUrl && avatarCrop ? avatarCrop : null,
						...(age != null ? { age, ageApprox: date.precision !== 'day' } : {})
					};
				}),
			tags: itemTagRows
				.filter((tag) => tag.itemId === row.id)
				.map((tag) => ({ id: tag.id, name: tag.name, kind: tag.kind })),
			albums: albumRows
				.filter((album) => album.itemId === row.id)
				.map((album) => ({ id: album.id, title: album.title })),
			uploadedBy: row.uploadedBy,
			tapeLabel: row.tapeLabel,
			location: row.location
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

export async function getItemDTOsByIds(
	db: Db,
	storage: StorageAdapter,
	ids: string[]
): Promise<ItemDTO[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select()
		.from(items)
		.where(and(inArray(items.id, ids), isNull(items.deletedAt)));
	const byId = new Map(rows.map((row) => [row.id, row]));
	return buildItemDTOs(
		db,
		storage,
		ids.map((id) => byId.get(id)).filter((row): row is ItemRow => Boolean(row))
	);
}

export async function itemDTOsByIds(locals: App.Locals, ids: string[]): Promise<ItemDTO[]> {
	return getItemDTOsByIds(locals.db, locals.platform.storage, ids);
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
	location?: string | null;
	date?: ItemDate;
	/** Time of day "HH:MM" or "HH:MM:SS" for intra-day ordering (day-precision
	 * items only). Undefined = leave unchanged; null = clear. */
	captureTime?: string | null;
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

/** How many items are waiting in arrivals (needs_review, not trashed). */
export async function countNeedsReview(db: Db): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(items)
		.where(and(isNull(items.deletedAt), eq(items.status, 'needs_review')));
	return row?.n ?? 0;
}

export async function listItems(
	db: Db,
	storage: StorageAdapter,
	query: ListItemsQuery
): Promise<{ items: ItemDTO[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
	const conds: SQL[] = [isNull(items.deletedAt)];

	if (query.type) conds.push(eq(items.type, query.type));
	// Default to approved-only so the timeline (and people/album views) never show
	// items still waiting in arrivals; callers like arrivals pass status explicitly.
	conds.push(eq(items.status, query.status ?? 'ready'));
	if (query.year) {
		const prefix = `${String(query.year).padStart(4, '0')}%`;
		conds.push(sql`${items.sortDate} like ${prefix}`);
	}
	if (query.month && query.year) {
		const prefix = `${String(query.year).padStart(4, '0')}-${String(query.month).padStart(2, '0')}%`;
		conds.push(sql`${items.sortDate} like ${prefix}`);
	}
	if (query.q?.trim()) {
		const needle = query.q.trim().toLowerCase();
		conds.push(
			sql`(instr(lower(coalesce(${items.title}, '')), ${needle}) > 0
			     or instr(lower(coalesce(${items.description}, '')), ${needle}) > 0)`
		);
	}
	if (query.album) {
		conds.push(
			sql`${items.id} in (select item_id from album_items where album_id = ${query.album})`
		);
	}
	for (const personId of query.people ?? []) {
		conds.push(sql`${items.id} in (select item_id from item_people where person_id = ${personId})`);
	}
	if (query.tags?.length) {
		for (const name of query.tags.map(normalizeTagName).filter(Boolean)) {
			conds.push(
				sql`${items.id} in (select it.item_id from item_tags it inner join tags t on t.id = it.tag_id where t.name = ${name})`
			);
		}
	}

	// NULL sortDates sort last (undated items), matching the previous in-memory
	// ordering. The day-level sort_date is extended with the TIME component of the
	// capture timestamp so same-day items order chronologically (unknown capture
	// time sorts first within the day). Only the time-of-day is compared: for
	// digitized tapes the date part is the transfer date, so a manually-set
	// day-period ("afternoon") must interleave with transfer times, not sort into
	// a different era. Keyset pagination over (sortKey, id) avoids loading the
	// table; the cursor carries the composite key.
	const sortKey = sql<string>`coalesce(${items.sortDate} || '|' || coalesce(substr(${items.captureTime}, 12), ''), '9999-12-31')`;
	if (query.cursor) {
		const cursor = decodeCursor(query.cursor);
		const cursorKey = cursor.s ?? '9999-12-31';
		conds.push(
			sql`(${sortKey} > ${cursorKey} or (${sortKey} = ${cursorKey} and ${items.id} > ${cursor.id}))`
		);
	}

	const rows = await db
		.select()
		.from(items)
		.where(and(...conds))
		.orderBy(asc(sortKey), asc(items.id))
		.limit(limit + 1);

	const page = rows.slice(0, limit);
	const hasMore = rows.length > limit;
	const last = page.at(-1);
	const nextCursor =
		hasMore && last
			? encodeCursor({
					s: last.sortDate == null ? null : `${last.sortDate}|${last.captureTime?.slice(11) ?? ''}`,
					id: last.id
				})
			: null;

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

	// Manual time-of-day: an exact "HH:MM[:SS]" or a day-period token ("morning",
	// "night", ...) mapped to its representative time — scans rarely have a real
	// clock time. Anchored to the (possibly just-edited) day; a manual value
	// simply replaces any probe-derived transfer timestamp.
	let captureTime = row.captureTime;
	if (patch.captureTime === null) captureTime = null;
	else if (patch.captureTime !== undefined) {
		const time =
			periodTime(patch.captureTime) ??
			(/^\d{2}:\d{2}(:\d{2})?$/.test(patch.captureTime)
				? patch.captureTime.length === 5
					? `${patch.captureTime}:00`
					: patch.captureTime
				: null);
		if (!time) throw error(400, 'invalid capture time');
		if (nextDate.precision !== 'day' || !nextDate.dateStart) {
			throw error(400, 'capture time requires a day-precision date');
		}
		captureTime = `${nextDate.dateStart}T${time}`;
	}

	await db
		.update(items)
		.set({
			title: patch.title === undefined ? row.title : patch.title,
			description: patch.description === undefined ? row.description : patch.description,
			tapeLabel: patch.tapeLabel === undefined ? row.tapeLabel : patch.tapeLabel,
			location: patch.location === undefined ? row.location : patch.location,
			dateStart: nextDate.dateStart,
			dateEnd: nextDate.dateEnd,
			datePrecision: nextDate.precision,
			sortDate: computeSortDate(nextDate),
			captureTime
			// Status is left to the arrivals approval flow; editing metadata never
			// silently pushes an unapproved item into the timeline.
		})
		.where(eq(items.id, id));

	// Only approved items are counted, so a year change on a ready item must be
	// reflected; recompute is authoritative regardless of the item's status.
	if (!row.deletedAt && beforeYear !== afterYear) await recomputeYearCounts(db);
	if (patch.people) await setItemPeople(db, id, patch.people, { reindex: false });
	if (patch.tags) await setItemTags(db, id, patch.tags, { reindex: false });
	await applyHolidayTags(db, id);
	await reindexItem(db, id);

	const dto = await getItemDTO(db, storage, id, { includeDeleted: Boolean(row.deletedAt) });
	if (!dto) throw error(500, 'item update failed');
	return dto;
}

export async function deleteItem(db: Db, id: string): Promise<void> {
	const row = await getItemRow(db, id);
	if (!row) throw error(404, 'item not found');
	await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, id));
	if (row.status === 'ready') await recomputeYearCounts(db);
	await applyHolidayTags(db, id);
	await reindexItem(db, id);
}

export async function restoreItem(db: Db, storage: StorageAdapter, id: string): Promise<ItemDTO> {
	const row = await getItemRow(db, id, { includeDeleted: true });
	if (!row) throw error(404, 'item not found');
	await db.update(items).set({ deletedAt: null }).where(eq(items.id, id));
	if (row.status === 'ready') await recomputeYearCounts(db);
	await applyHolidayTags(db, id);
	await reindexItem(db, id);
	const dto = await getItemDTO(db, storage, id);
	if (!dto) throw error(500, 'item restore failed');
	return dto;
}

/**
 * Set a video's poster frame to `posterTime` seconds. The poster + thumbnails
 * are regenerated inline so the new frame is ready the instant this returns (the
 * DTO's cache-busted URLs then surface it immediately); if inline extraction
 * isn't available we fall back to a background derivatives job. Either way we do
 * NOT re-scan faces — the poster frame has nothing to do with face detection.
 */
export async function setItemPoster(
	db: Db,
	storage: StorageAdapter,
	queue: JobQueueAdapter,
	user: SessionUser,
	id: string,
	posterTime: number
): Promise<ItemDTO> {
	const row = await getItemRow(db, id);
	if (!row) throw error(404, 'item not found');
	if (!canModifyItem(user, row)) throw error(403, 'cannot modify item');
	if (row.type !== 'video') throw error(400, 'poster frames only apply to videos');
	if (!Number.isFinite(posterTime) || posterTime < 0) throw error(400, 'invalid poster time');
	if (row.duration != null && posterTime > row.duration + 0.5) {
		throw error(400, 'poster time is past the end of the video');
	}

	await db.update(items).set({ posterTime }).where(eq(items.id, id));

	const original = (
		await db
			.select({ key: itemFiles.storageKey })
			.from(itemFiles)
			.where(and(eq(itemFiles.itemId, id), eq(itemFiles.kind, 'original')))
			.limit(1)
	)[0];
	try {
		if (!original) throw new Error('no original file');
		const mediaPath = process.env.MEDIA_PATH ?? './data/media';
		const { renderVideoPoster } = await import('$lib/server/media/poster');
		await renderVideoPoster({
			mediaPath,
			originalKey: original.key,
			time: posterTime,
			storage,
			itemId: id
		});
	} catch {
		// Inline extraction unavailable (e.g. non-node runtime or missing binary):
		// regenerate in the background instead. skipFaceScan avoids a pointless
		// full face re-scan.
		await queue.enqueue('derivatives', { itemId: id, skipFaceScan: true });
	}

	const dto = await getItemDTO(db, storage, id);
	if (!dto) throw error(500, 'item not found after poster update');
	return dto;
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

async function enabledHolidaySet(db: Db): Promise<Set<string>> {
	const rows = (await db.all(sql`SELECT value FROM settings WHERE key = 'holidaySet'`)) as Array<{
		value: string;
	}>;
	if (rows[0]) {
		try {
			const parsed = JSON.parse(rows[0].value) as unknown;
			if (Array.isArray(parsed)) {
				return new Set(parsed.filter((value): value is string => typeof value === 'string'));
			}
		} catch {
			// Invalid settings fall back to the full registry.
		}
	}
	return new Set(HOLIDAYS.map((holiday) => holiday.id));
}

export async function applyHolidayTags(db: Db, itemId: string): Promise<string[]> {
	const rows = (await db.all(
		sql`SELECT date_start AS dateStart, date_precision AS datePrecision, deleted_at AS deletedAt
		    FROM items
		    WHERE id = ${itemId}`
	)) as Array<{ dateStart: string | null; datePrecision: string; deletedAt: unknown | null }>;
	const item = rows[0];
	if (!item) return [];

	let wanted: string[] = [];
	if (item.deletedAt == null && item.datePrecision === 'day' && item.dateStart) {
		const enabled = await enabledHolidaySet(db);
		wanted = holidaysFor(item.dateStart).filter((holiday) => enabled.has(holiday));
	}
	const wantedSet = new Set(wanted);

	const current = (await db.all(
		sql`SELECT t.id AS id, t.name AS name
		    FROM item_tags it
		    INNER JOIN tags t ON t.id = it.tag_id
		    WHERE it.item_id = ${itemId} AND t.kind = 'holiday'`
	)) as Array<{ id: string; name: string }>;

	for (const tag of current) {
		if (!wantedSet.has(tag.name)) {
			await db.run(sql`DELETE FROM item_tags WHERE item_id = ${itemId} AND tag_id = ${tag.id}`);
		}
	}

	for (const name of wanted) {
		const existing = (await db.all(sql`SELECT id FROM tags WHERE name = ${name}`)) as Array<{
			id: string;
		}>;
		let tagId = existing[0]?.id;
		if (!tagId) {
			tagId = nanoid(12);
			await db.run(sql`INSERT INTO tags (id, name, kind) VALUES (${tagId}, ${name}, 'holiday')`);
		}
		await db.run(
			sql`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (${itemId}, ${tagId})`
		);
	}

	return wanted;
}
