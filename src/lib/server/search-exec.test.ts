import { beforeEach, describe, expect, it } from 'vitest';
import { dateWindowForAge } from '../domain/ages';
import { parseOmnibox } from '../domain/search-query';
import { makeTestDb } from './platform/node-test-db';
import { executeSearch, reindexAll } from './search';

type TestCtx = ReturnType<typeof makeTestDb>;

let ctx: TestCtx;

function seedWorld(c: TestCtx) {
	const { db, schema } = c;
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
	db.insert(schema.people)
		.values([
			{
				id: 'p_eric',
				name: 'Eric',
				slug: 'eric',
				birthdate: '1988-06-14',
				accentColor: '#A8D8EA',
				createdAt: new Date()
			},
			{
				id: 'p_mom',
				name: 'Mom',
				slug: 'mom',
				accentColor: '#FFD9A8',
				createdAt: new Date()
			}
		])
		.run();

	const item = (
		id: string,
		date: string,
		extra: Partial<{ title: string; description: string; type: 'video' | 'photo' }> = {}
	) =>
		db
			.insert(schema.items)
			.values({
				id,
				type: extra.type ?? 'photo',
				title: extra.title ?? null,
				description: extra.description ?? null,
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

	item('it_93', '1993-08-10', {
		title: 'Lake day',
		description: 'Eating watermelon at the lake'
	});
	item('it_96', '1996-08-10', { title: 'Bike ride', type: 'video' });
	item('it_xmas', '1994-12-25', { title: 'Morning presents' });
	item('it_85', '1985-05-05', { title: 'Old photo' });

	db.insert(schema.itemPeople)
		.values([
			{ itemId: 'it_93', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_96', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_xmas', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_xmas', personId: 'p_mom', source: 'manual' }
		])
		.run();
	db.insert(schema.tags).values({ id: 't_x', name: 'christmas', kind: 'holiday' }).run();
	db.insert(schema.itemTags).values({ itemId: 'it_xmas', tagId: 't_x' }).run();
}

const run = (q: string, opts?: { cursor?: string; limit?: number }) =>
	executeSearch(ctx.db, parseOmnibox(q), opts);

beforeEach(async () => {
	ctx = makeTestDb();
	seedWorld(ctx);
	await reindexAll(ctx.db);
});

describe('executeSearch', () => {
	it('keeps the Contract 5 age window behavior', () => {
		expect(dateWindowForAge('1988-06-14', { min: 5, max: 7 })).toEqual({
			start: '1993-06-14',
			end: '1996-06-13'
		});
	});

	it('filters free text through FTS', async () => {
		expect((await run('watermelon')).itemIds).toEqual(['it_93']);
	});

	it('applies person age windows and excludes dates outside the window', async () => {
		const result = await run('person:Eric age:5-7');
		expect(result.itemIds).toEqual(['it_xmas', 'it_93']);
		expect(result.itemIds).not.toContain('it_96');
		expect(result.warnings).toEqual([]);
	});

	it('ANDs repeated person filters', async () => {
		expect((await run('person:Eric person:Mom')).itemIds).toEqual(['it_xmas']);
	});

	it('combines person and tag filters', async () => {
		expect((await run('person:Mom tag:christmas')).itemIds).toEqual(['it_xmas']);
	});

	it('filters by year window', async () => {
		expect((await run('1988..1999')).itemIds).toEqual(['it_96', 'it_xmas', 'it_93']);
	});

	it('filters by type', async () => {
		expect((await run('type:video')).itemIds).toEqual(['it_96']);
	});

	it('filters by uploader', async () => {
		expect((await run('uploader:owner 1985')).itemIds).toEqual(['it_85']);
	});

	it('returns empty results and a warning for unknown people', async () => {
		const result = await run('person:Zorp');
		expect(result.itemIds).toEqual([]);
		expect(result.warnings.some((warning) => warning.includes('Zorp'))).toBe(true);
	});

	it('drops age filters with a warning when the person has no birthdate', async () => {
		const result = await run('person:Mom age:5');
		expect(result.warnings.some((warning) => warning.includes('birthdate'))).toBe(true);
		expect(result.itemIds).toEqual(['it_xmas']);
	});

	it('paginates with an opaque cursor and no overlap', async () => {
		const page1 = await run('1985..1999', { limit: 2 });
		expect(page1.itemIds).toEqual(['it_96', 'it_xmas']);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await run('1985..1999', { cursor: page1.nextCursor!, limit: 2 });
		expect(page2.itemIds).toEqual(['it_93', 'it_85']);
		expect(page2.nextCursor).toBeNull();
	});

	it('passes parse warnings through', async () => {
		const result = await run('age:5 watermelon');
		expect(result.itemIds).toEqual(['it_93']);
		expect(result.warnings).toHaveLength(1);
	});
});
