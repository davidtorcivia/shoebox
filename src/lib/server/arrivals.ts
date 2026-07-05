import { and, eq, isNull, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sortDate, type ItemDate } from '$lib/domain/dates';
import { recomputeYearCounts } from './aggregates';
import type { Db } from './db';
import * as schema from './db/schema';
import { applyHolidayTags } from './items';
import { reindexItem } from './search';

export interface ArrivalsApply {
	date?: ItemDate;
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

	for (const itemId of req.itemIds) {
		const [item] = await db
			.select({ id: schema.items.id })
			.from(schema.items)
			.where(and(eq(schema.items.id, itemId), isNull(schema.items.deletedAt)))
			.limit(1);
		if (!item) continue;

		if (apply.date && apply.date.precision !== 'unknown') {
			await db
				.update(schema.items)
				.set({
					dateStart: apply.date.dateStart,
					dateEnd: apply.date.dateEnd,
					datePrecision: apply.date.precision,
					sortDate: sortDate(apply.date)
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

	if (req.approve && updated > 0) await recomputeYearCounts(db);
	return { updated };
}
