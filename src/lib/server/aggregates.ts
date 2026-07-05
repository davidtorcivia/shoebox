import { and, eq, isNull, sql } from 'drizzle-orm';
import { itemPeople, items, yearCounts } from '$lib/server/db/schema';

type Db = App.Locals['db'];

export async function recomputeYearCounts(db: Db): Promise<void> {
	await db.delete(yearCounts);

	const rows = await db
		.select({
			year: sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`,
			type: items.type,
			count: sql<number>`count(*)`
		})
		.from(items)
		.where(and(isNull(items.deletedAt), sql`${items.sortDate} is not null`))
		.groupBy(sql`substr(${items.sortDate}, 1, 4)`, items.type);

	if (rows.length > 0) {
		await db.insert(yearCounts).values(rows);
	}
}

export async function bumpYearCount(
	db: Db,
	year: number | null,
	type: 'video' | 'photo',
	delta: 1 | -1
): Promise<void> {
	if (year === null) return;

	if (delta === 1) {
		await db
			.insert(yearCounts)
			.values({ year, type, count: 1 })
			.onConflictDoUpdate({
				target: [yearCounts.year, yearCounts.type],
				set: { count: sql`${yearCounts.count} + 1` }
			});
		return;
	}

	await db
		.update(yearCounts)
		.set({ count: sql`max(${yearCounts.count} - 1, 0)` })
		.where(and(eq(yearCounts.year, year), eq(yearCounts.type, type)));
}

export interface TimelineYear {
	year: number;
	count: number;
	people: number;
}

export async function timelineYears(
	db: Db
): Promise<{ years: TimelineYear[]; earliest: number | null; latest: number | null }> {
	const countRows = await db
		.select({ year: yearCounts.year, count: sql<number>`sum(${yearCounts.count})` })
		.from(yearCounts)
		.groupBy(yearCounts.year)
		.orderBy(yearCounts.year);

	if (countRows.length === 0) return { years: [], earliest: null, latest: null };

	const peopleRows = await db
		.select({
			year: sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`,
			people: sql<number>`count(distinct ${itemPeople.personId})`
		})
		.from(items)
		.leftJoin(itemPeople, eq(itemPeople.itemId, items.id))
		.where(and(isNull(items.deletedAt), sql`${items.sortDate} is not null`))
		.groupBy(sql`substr(${items.sortDate}, 1, 4)`);
	const peopleByYear = new Map(peopleRows.map((row) => [row.year, row.people]));
	const years = countRows.map((row) => ({
		year: row.year,
		count: row.count,
		people: peopleByYear.get(row.year) ?? 0
	}));

	return {
		years,
		earliest: years[0]?.year ?? null,
		latest: years.at(-1)?.year ?? null
	};
}
