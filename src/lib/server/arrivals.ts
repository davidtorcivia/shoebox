import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { resolveTimeOfDay } from '$lib/domain/day-period';
import { sortDate, type ItemDate } from '$lib/domain/dates';
import { recomputeYearCounts } from './aggregates';
import type { Db } from './db';
import * as schema from './db/schema';
import { applyHolidayTags } from './items';
import type { StorageAdapter } from './platform/types';
import { reindexItem } from './search';
import { hardDeleteItems } from './trash';

export interface ArrivalsApply {
	date?: ItemDate;
	/** Time-of-day for same-day ordering: a day-period token ("morning") or an
	 * exact "HH:MM[:SS]". Only applied alongside a day-precision date. */
	captureTime?: string;
	people?: string[];
	tags?: string[];
	albumId?: string;
}

export interface ArrivalsRequest {
	itemIds: string[];
	apply?: ArrivalsApply;
	approve: boolean;
}

export async function applyArrivalsBatch(
	db: Db,
	req: ArrivalsRequest
): Promise<{ updated: number }> {
	const apply = req.apply ?? {};
	let updated = 0;
	// Changing an item's date moves it between year_counts buckets; approval
	// can also change status. Either path can leave the aggregate stale.
	const datesApplied = Boolean(apply.date && apply.date.precision !== 'unknown');

	for (const itemId of req.itemIds) {
		const [item] = await db
			.select({ id: schema.items.id })
			.from(schema.items)
			.where(and(eq(schema.items.id, itemId), isNull(schema.items.deletedAt)))
			.limit(1);
		if (!item) continue;

		if (apply.date && apply.date.precision !== 'unknown') {
			// Time-of-day rides along only with a day-precision date; anything else
			// (or an unparseable value) leaves capture_time untouched.
			const time =
				apply.date.precision === 'day' && apply.date.dateStart && apply.captureTime
					? resolveTimeOfDay(apply.captureTime)
					: null;
			await db
				.update(schema.items)
				.set({
					dateStart: apply.date.dateStart,
					dateEnd: apply.date.dateEnd,
					datePrecision: apply.date.precision,
					sortDate: sortDate(apply.date),
					...(time ? { captureTime: `${apply.date.dateStart}T${time}` } : {})
				})
				.where(eq(schema.items.id, itemId));
			if (apply.date.precision === 'day') await applyHolidayTags(db, itemId);
		}

		for (const personId of apply.people ?? []) {
			const [person] = await db
				.select({ id: schema.people.id })
				.from(schema.people)
				.where(eq(schema.people.id, personId))
				.limit(1);
			if (!person) continue;
			await db
				.insert(schema.itemPeople)
				.values({ itemId, personId, source: 'manual' })
				.onConflictDoNothing();
		}

		for (const raw of apply.tags ?? []) {
			const name = raw.trim().toLowerCase();
			if (!name) continue;
			await db
				.insert(schema.tags)
				.values({ id: nanoid(12), name, kind: 'topic' })
				.onConflictDoNothing();
			const [tag] = await db
				.select({ id: schema.tags.id })
				.from(schema.tags)
				.where(eq(schema.tags.name, name))
				.limit(1);
			await db.insert(schema.itemTags).values({ itemId, tagId: tag.id }).onConflictDoNothing();
		}

		if (apply.albumId) {
			const [album] = await db
				.select({ id: schema.albums.id })
				.from(schema.albums)
				.where(and(eq(schema.albums.id, apply.albumId), isNull(schema.albums.deletedAt)))
				.limit(1);
			if (album) {
				const [row] = await db
					.select({ m: max(schema.albumItems.position) })
					.from(schema.albumItems)
					.where(eq(schema.albumItems.albumId, apply.albumId));
				await db
					.insert(schema.albumItems)
					.values({ albumId: apply.albumId, itemId, position: (row?.m ?? -1) + 1 })
					.onConflictDoNothing();
			}
		}

		if (req.approve) {
			await db.update(schema.items).set({ status: 'ready' }).where(eq(schema.items.id, itemId));
		}
		await reindexItem(db, itemId);
		updated += 1;
	}

	if (updated > 0 && (req.approve || datesApplied)) await recomputeYearCounts(db);
	return { updated };
}

/**
 * Permanently delete queued arrivals — media files and all derived rows, no
 * trash stop. Only needs_review items qualify; anything already in the library
 * (or soft-deleted) is silently skipped so a stale queue can't nuke curation.
 * Year counts only track ready items, so no recompute is needed.
 */
export async function discardArrivals(
	db: Db,
	storage: StorageAdapter,
	itemIds: string[]
): Promise<{ deleted: number }> {
	if (itemIds.length === 0) return { deleted: 0 };
	const rows = await db
		.select({ id: schema.items.id })
		.from(schema.items)
		.where(
			and(
				inArray(schema.items.id, itemIds),
				eq(schema.items.status, 'needs_review'),
				isNull(schema.items.deletedAt)
			)
		);
	const deleted = await hardDeleteItems(
		db,
		storage,
		rows.map((row) => row.id)
	);
	return { deleted };
}
