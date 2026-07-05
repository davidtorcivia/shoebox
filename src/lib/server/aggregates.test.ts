import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { items, yearCounts } from '$lib/server/db/schema';
import { bumpYearCount, recomputeYearCounts } from './aggregates';
import { memoryDb, seedUser } from './testing/memory-db';

type Db = App.Locals['db'];

let db: Db;
let userId: string;

async function insertItem(over: {
	type: 'video' | 'photo';
	sortDate: string | null;
	deletedAt?: Date | null;
}) {
	await db.insert(items).values({
		id: nanoid(12),
		type: over.type,
		dateStart: over.sortDate,
		dateEnd: over.sortDate,
		datePrecision: over.sortDate ? 'day' : 'unknown',
		sortDate: over.sortDate,
		width: 192,
		height: 108,
		sizeBytes: 1000,
		sha256: nanoid(32),
		source: 'upload',
		status: over.sortDate ? 'ready' : 'needs_review',
		uploadedBy: userId,
		deletedAt: over.deletedAt ?? null,
		createdAt: new Date()
	});
}

beforeEach(async () => {
	db = memoryDb();
	userId = (await seedUser(db)).id;
});

describe('recomputeYearCounts', () => {
	it('groups live, dated items by year and type', async () => {
		await insertItem({ type: 'video', sortDate: '1994-06-14' });
		await insertItem({ type: 'video', sortDate: '1994-12-25' });
		await insertItem({ type: 'photo', sortDate: '1994-01-01' });
		await insertItem({ type: 'photo', sortDate: '1988-07-04' });
		await insertItem({ type: 'photo', sortDate: null });
		await insertItem({ type: 'video', sortDate: '1994-03-03', deletedAt: new Date() });

		await recomputeYearCounts(db);

		const rows = (await db.select().from(yearCounts)).sort(
			(a, b) => a.year - b.year || a.type.localeCompare(b.type)
		);
		expect(rows).toEqual([
			{ year: 1988, type: 'photo', count: 1 },
			{ year: 1994, type: 'photo', count: 1 },
			{ year: 1994, type: 'video', count: 2 }
		]);
	});

	it('replaces stale rows', async () => {
		await db.insert(yearCounts).values({ year: 1970, type: 'video', count: 99 });
		await recomputeYearCounts(db);
		expect(await db.select().from(yearCounts)).toEqual([]);
	});
});

describe('bumpYearCount', () => {
	it('inserts on first bump and increments after', async () => {
		await bumpYearCount(db, 1994, 'video', 1);
		await bumpYearCount(db, 1994, 'video', 1);
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 2 }]);
	});

	it('decrements and floors at zero', async () => {
		await bumpYearCount(db, 1994, 'photo', 1);
		await bumpYearCount(db, 1994, 'photo', -1);
		await bumpYearCount(db, 1994, 'photo', -1);
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'photo', count: 0 }]);
	});

	it('is a no-op for null year', async () => {
		await bumpYearCount(db, null, 'video', 1);
		expect(await db.select().from(yearCounts)).toEqual([]);
	});
});

