import { describe, expect, it } from 'vitest';
import { makeItem, makeTestDb, makeUser, stubStorage } from '$lib/server/testing/db';
import { onThisDay } from './on-this-day';

describe('onThisDay', () => {
	it('groups same-calendar-day items from past years, newest first', async () => {
		const db = makeTestDb();
		const u = await makeUser(db);
		const day = (iso: string) =>
			makeItem(db, {
				uploadedBy: u.id,
				status: 'ready',
				type: 'photo',
				dateStart: iso,
				dateEnd: iso,
				sortDate: iso,
				datePrecision: 'day'
			});
		await day('1994-07-04');
		await day('2001-07-04');
		await day('2001-07-05'); // different day — excluded
		await day('2030-07-04'); // future relative to `now` below — excluded

		const now = new Date('2026-07-04T12:00:00Z');
		const groups = await onThisDay(db, stubStorage, now);

		expect(groups.map((g) => g.year)).toEqual([2001, 1994]);
		expect(groups[0]).toMatchObject({ year: 2001, yearsAgo: 25 });
		expect(groups[1]).toMatchObject({ year: 1994, yearsAgo: 32 });
		expect(groups.flatMap((g) => g.items).length).toBe(2);
	});

	it('returns nothing when no past day matches', async () => {
		const db = makeTestDb();
		const u = await makeUser(db);
		await makeItem(db, {
			uploadedBy: u.id,
			status: 'ready',
			type: 'photo',
			dateStart: '2001-01-01',
			dateEnd: '2001-01-01',
			sortDate: '2001-01-01',
			datePrecision: 'day'
		});
		expect(await onThisDay(db, stubStorage, new Date('2026-07-04T12:00:00Z'))).toEqual([]);
	});
});
