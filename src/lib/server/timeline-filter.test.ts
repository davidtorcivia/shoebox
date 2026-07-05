import { beforeEach, describe, expect, it } from 'vitest';
import { parseOmnibox } from '../domain/search-query';
import { makeTestDb } from './platform/node-test-db';
import { filteredYearCounts, filterFromQuery, reindexAll } from './search';

type TestCtx = ReturnType<typeof makeTestDb>;

let ctx: TestCtx;

beforeEach(async () => {
	ctx = makeTestDb();
	const { db, schema } = ctx;
	db.insert(schema.users)
		.values({
			id: 'u1',
			username: 'owner',
			passwordHash: 'x',
			role: 'owner',
			accentColor: '#FA7B62',
			createdAt: new Date()
		})
		.run();

	const item = (
		id: string,
		date: string,
		type: 'video' | 'photo',
		description: string | null = null
	) =>
		db
			.insert(schema.items)
			.values({
				id,
				type,
				title: null,
				description,
				dateStart: date,
				dateEnd: date,
				datePrecision: 'day',
				sortDate: date,
				width: 1,
				height: 1,
				sizeBytes: 1,
				sha256: `sha_${id}`,
				source: 'upload',
				status: 'ready',
				uploadedBy: 'u1',
				createdAt: new Date()
			})
			.run();

	item('i1', '1993-08-10', 'photo', 'watermelon at the lake');
	item('i2', '1993-12-25', 'video');
	item('i3', '1996-08-10', 'video');
	db.insert(schema.tags).values({ id: 't1', name: 'christmas', kind: 'holiday' }).run();
	db.insert(schema.itemTags).values({ itemId: 'i2', tagId: 't1' }).run();
	await reindexAll(db);
});

describe('filteredYearCounts', () => {
	it('groups by year with only ready and live defaults', async () => {
		expect(await filteredYearCounts(ctx.db, {})).toEqual([
			{ year: 1993, count: 2 },
			{ year: 1996, count: 1 }
		]);
	});

	it('filters by type', async () => {
		expect(await filteredYearCounts(ctx.db, { type: 'video' })).toEqual([
			{ year: 1993, count: 1 },
			{ year: 1996, count: 1 }
		]);
	});

	it('filters by tag ids from timeline chip params', async () => {
		expect(await filteredYearCounts(ctx.db, { tagIds: ['t1'] })).toEqual([
			{ year: 1993, count: 1 }
		]);
	});

	it('filters omnibox text through FTS', async () => {
		expect(await filteredYearCounts(ctx.db, filterFromQuery(parseOmnibox('watermelon')))).toEqual([
			{ year: 1993, count: 1 }
		]);
	});

	it('returns an empty histogram for impossible filters', async () => {
		expect(await filteredYearCounts(ctx.db, { tagNames: ['nope'] })).toEqual([]);
	});
});
