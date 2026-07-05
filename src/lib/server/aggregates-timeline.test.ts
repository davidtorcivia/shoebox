import { beforeEach, describe, expect, it } from 'vitest';
import { items, itemPeople } from '$lib/server/db/schema';
import { bumpYearCount, timelineYears } from './aggregates';
import { memoryDb, seedPerson, seedUser } from './testing/memory-db';

type Db = App.Locals['db'];

let db: Db;
let userId: string;

beforeEach(async () => {
	db = memoryDb();
	userId = (await seedUser(db)).id;
});

async function insertItem(id: string, year: number) {
	await db.insert(items).values({
		id,
		type: 'photo',
		dateStart: `${year}-01-01`,
		dateEnd: `${year}-12-31`,
		datePrecision: 'year',
		sortDate: `${year}-07-02`,
		width: 100,
		height: 100,
		sizeBytes: 10,
		sha256: id.padEnd(64, '0'),
		source: 'upload',
		status: 'ready',
		uploadedBy: userId,
		createdAt: new Date()
	});
	await bumpYearCount(db, year, 'photo', 1);
}

describe('timelineYears', () => {
	it('returns unfiltered year counts plus distinct people counts', async () => {
		const mom = await seedPerson(db, { id: 'p_mom', name: 'Mom' });
		const dad = await seedPerson(db, { id: 'p_dad', name: 'Dad' });
		await insertItem('itm1', 1994);
		await insertItem('itm2', 1994);
		await insertItem('itm3', 1995);
		await db.insert(itemPeople).values([
			{ itemId: 'itm1', personId: mom.id },
			{ itemId: 'itm2', personId: mom.id },
			{ itemId: 'itm2', personId: dad.id }
		]);

		await expect(timelineYears(db)).resolves.toEqual({
			years: [
				{ year: 1994, count: 2, people: 2 },
				{ year: 1995, count: 1, people: 0 }
			],
			earliest: 1994,
			latest: 1995
		});
	});

	it('returns null bounds for an empty archive', async () => {
		await expect(timelineYears(db)).resolves.toEqual({ years: [], earliest: null, latest: null });
	});
});
