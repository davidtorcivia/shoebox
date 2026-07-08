import { and, eq, isNull, sql } from 'drizzle-orm';
import { items } from '$lib/server/db/schema';
import { getItemDTOsByIds } from '$lib/server/items';
import type { Db } from '$lib/server/db';
import type { StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO } from '$lib/types';

export interface OnThisDayGroup {
	year: number;
	yearsAgo: number;
	items: ItemDTO[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Approved media from earlier years that fall on the same calendar day as
 * `now` (matched on the day-precision sort date), grouped by year, most recent
 * first. This is the "N years ago today" resurfacing feed.
 */
export async function onThisDay(
	db: Db,
	storage: StorageAdapter,
	now: Date
): Promise<OnThisDayGroup[]> {
	const monthDay = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const thisYear = now.getFullYear();

	const rows = await db
		.select({
			id: items.id,
			year: sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`
		})
		.from(items)
		.where(
			and(
				isNull(items.deletedAt),
				eq(items.status, 'ready'),
				eq(items.datePrecision, 'day'),
				sql`substr(${items.sortDate}, 6, 5) = ${monthDay}`,
				sql`cast(substr(${items.sortDate}, 1, 4) as integer) < ${thisYear}`
			)
		)
		.orderBy(sql`${items.sortDate} desc`);

	if (rows.length === 0) return [];

	const dtos = await getItemDTOsByIds(
		db,
		storage,
		rows.map((row) => row.id)
	);
	const byId = new Map(dtos.map((dto) => [dto.id, dto]));

	const groups = new Map<number, ItemDTO[]>();
	for (const row of rows) {
		const dto = byId.get(row.id);
		if (!dto) continue;
		(groups.get(row.year) ?? groups.set(row.year, []).get(row.year)!).push(dto);
	}

	return [...groups.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, groupItems]) => ({ year, yearsAgo: thisYear - year, items: groupItems }));
}

/**
 * Cheap existence check for the timeline: how many approved day-precision items
 * from earlier years land on today's calendar day. Used to decide whether to
 * surface the "On This Day" entry point at all.
 */
export async function countOnThisDay(db: Db, now: Date): Promise<number> {
	const monthDay = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const thisYear = now.getFullYear();
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(items)
		.where(
			and(
				isNull(items.deletedAt),
				eq(items.status, 'ready'),
				eq(items.datePrecision, 'day'),
				sql`substr(${items.sortDate}, 6, 5) = ${monthDay}`,
				sql`cast(substr(${items.sortDate}, 1, 4) as integer) < ${thisYear}`
			)
		);
	return row?.n ?? 0;
}
