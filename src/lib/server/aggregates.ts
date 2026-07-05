import { and, eq, isNull, sql } from 'drizzle-orm';
import { items, yearCounts } from '$lib/server/db/schema';

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
