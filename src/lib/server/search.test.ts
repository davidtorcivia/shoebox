import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import {
	ftsMatchExpr,
	reindexAll,
	reindexItem,
	reindexItemsForAlbum,
	reindexItemsForPerson,
	reindexItemsForTag
} from './search';

type TestCtx = ReturnType<typeof makeTestDb>;

let ctx: TestCtx;

function seedBase(c: TestCtx) {
	c.db
		.insert(c.schema.users)
		.values({
			id: 'u_owner',
			username: 'owner',
			passwordHash: 'x',
			role: 'owner',
			accentColor: '#FA7B62',
			createdAt: new Date()
		})
		.run();
}

function seedItem(
	c: TestCtx,
	input: {
		id: string;
		title?: string;
		description?: string;
		dateStart?: string;
		precision?: 'day' | 'month' | 'year' | 'range' | 'unknown';
		type?: 'video' | 'photo';
	}
) {
	c.db
		.insert(c.schema.items)
		.values({
			id: input.id,
			type: input.type ?? 'photo',
			title: input.title ?? null,
			description: input.description ?? null,
			dateStart: input.dateStart ?? null,
			dateEnd: input.dateStart ?? null,
			datePrecision: input.precision ?? (input.dateStart ? 'day' : 'unknown'),
			sortDate: input.dateStart ?? null,
			width: 1,
			height: 1,
			sizeBytes: 1,
			sha256: `sha_${input.id}`,
			source: 'upload',
			status: 'ready',
			uploadedBy: 'u_owner',
			createdAt: new Date()
		})
		.run();
}

async function matchIds(c: TestCtx, expr: string): Promise<string[]> {
	const rows = (await c.db.all(
		sql`SELECT i.id AS id
		    FROM items i
		    WHERE i.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ${expr})`
	)) as { id: string }[];
	return rows.map((row) => row.id).sort();
}

beforeEach(() => {
	ctx = makeTestDb();
	seedBase(ctx);
});

describe('ftsMatchExpr', () => {
	it('turns plain tokens into prefix queries', () => {
		expect(ftsMatchExpr('lake watermelon')).toBe('"lake"* "watermelon"*');
	});

	it('keeps quoted phrases exact but prefixes bare tokens', () => {
		expect(ftsMatchExpr('"birthday party" lake')).toBe('"birthday party" "lake"*');
	});

	it('doubles embedded quotes', () => {
		expect(ftsMatchExpr('say"cheese')).toBe('"say""cheese"*');
	});

	it('drops pure punctuation', () => {
		expect(ftsMatchExpr('--- ...')).toBe('');
	});

	it('returns empty for empty input', () => {
		expect(ftsMatchExpr('   ')).toBe('');
	});
});

describe('reindexItem', () => {
	beforeEach(async () => {
		const { db, schema } = ctx;
		seedItem(ctx, {
			id: 'it_1',
			title: 'Lake day',
			description: 'Eating watermelon at the lake'
		});
		db.insert(schema.people)
			.values({
				id: 'p_eric',
				name: 'Eric',
				slug: 'eric',
				accentColor: '#A8D8EA',
				createdAt: new Date()
			})
			.run();
		db.insert(schema.itemPeople)
			.values({ itemId: 'it_1', personId: 'p_eric', source: 'manual' })
			.run();
		db.insert(schema.tags).values({ id: 't_sum', name: 'summer', kind: 'topic' }).run();
		db.insert(schema.itemTags).values({ itemId: 'it_1', tagId: 't_sum' }).run();
		db.insert(schema.albums)
			.values({ id: 'a_94', title: 'Summers', createdBy: 'u_owner', createdAt: new Date() })
			.run();
		db.insert(schema.albumItems).values({ albumId: 'a_94', itemId: 'it_1', position: 0 }).run();
		db.insert(schema.comments)
			.values({
				id: 'c_1',
				itemId: 'it_1',
				userId: 'u_owner',
				body: 'the famous cannonball',
				createdAt: new Date()
			})
			.run();
		await reindexItem(db, 'it_1');
	});

	it('matches title', async () => {
		expect(await matchIds(ctx, '"lake"')).toEqual(['it_1']);
	});

	it('matches description', async () => {
		expect(await matchIds(ctx, '"watermelon"')).toEqual(['it_1']);
	});

	it('matches person name', async () => {
		expect(await matchIds(ctx, '"eric"')).toEqual(['it_1']);
	});

	it('matches tag name', async () => {
		expect(await matchIds(ctx, '"summer"')).toEqual(['it_1']);
	});

	it('matches album title', async () => {
		expect(await matchIds(ctx, '"summers"')).toEqual(['it_1']);
	});

	it('matches comment body', async () => {
		expect(await matchIds(ctx, '"cannonball"')).toEqual(['it_1']);
	});

	it('matches partial terms via prefix queries', async () => {
		expect(await matchIds(ctx, ftsMatchExpr('water'))).toEqual(['it_1']);
		expect(await matchIds(ctx, ftsMatchExpr('lak'))).toEqual(['it_1']);
		expect(await matchIds(ctx, ftsMatchExpr('summ'))).toEqual(['it_1']);
		expect(await matchIds(ctx, ftsMatchExpr('zzz'))).toEqual([]);
	});

	it('replaces rows without keeping stale terms', async () => {
		await ctx.db.run(
			sql`UPDATE items SET description = 'sandcastles all afternoon' WHERE id = 'it_1'`
		);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"watermelon"')).toEqual([]);
		expect(await matchIds(ctx, '"sandcastles"')).toEqual(['it_1']);
	});

	it('excludes deleted comments', async () => {
		await ctx.db.run(sql`UPDATE comments SET deleted_at = 1 WHERE id = 'c_1'`);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"cannonball"')).toEqual([]);
	});

	it('removes soft-deleted items from the index', async () => {
		await ctx.db.run(sql`UPDATE items SET deleted_at = 1 WHERE id = 'it_1'`);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"lake"')).toEqual([]);
	});
});

describe('fan-out reindex helpers', () => {
	beforeEach(async () => {
		const { db, schema } = ctx;
		seedItem(ctx, { id: 'it_a', title: 'Alpha' });
		seedItem(ctx, { id: 'it_b', title: 'Beta' });
		db.insert(schema.people)
			.values({
				id: 'p_x',
				name: 'Eric',
				slug: 'eric',
				accentColor: '#A8D8EA',
				createdAt: new Date()
			})
			.run();
		db.insert(schema.itemPeople)
			.values([
				{ itemId: 'it_a', personId: 'p_x', source: 'manual' },
				{ itemId: 'it_b', personId: 'p_x', source: 'manual' }
			])
			.run();
		db.insert(schema.tags).values({ id: 't_x', name: 'boat', kind: 'topic' }).run();
		db.insert(schema.itemTags).values({ itemId: 'it_a', tagId: 't_x' }).run();
		db.insert(schema.albums)
			.values({ id: 'al_x', title: 'Voyages', createdBy: 'u_owner', createdAt: new Date() })
			.run();
		db.insert(schema.albumItems).values({ albumId: 'al_x', itemId: 'it_b', position: 0 }).run();
		await reindexAll(db);
	});

	it('updates all items for a renamed person', async () => {
		await ctx.db.run(sql`UPDATE people SET name = 'Eric Junior' WHERE id = 'p_x'`);
		await reindexItemsForPerson(ctx.db, 'p_x');
		expect(await matchIds(ctx, '"junior"')).toEqual(['it_a', 'it_b']);
	});

	it('updates all items for a renamed tag', async () => {
		await ctx.db.run(sql`UPDATE tags SET name = 'sailboat' WHERE id = 't_x'`);
		await reindexItemsForTag(ctx.db, 't_x');
		expect(await matchIds(ctx, '"sailboat"')).toEqual(['it_a']);
		expect(await matchIds(ctx, '"boat"')).toEqual([]);
	});

	it('updates all items for a renamed album', async () => {
		await ctx.db.run(sql`UPDATE albums SET title = 'Odysseys' WHERE id = 'al_x'`);
		await reindexItemsForAlbum(ctx.db, 'al_x');
		expect(await matchIds(ctx, '"odysseys"')).toEqual(['it_b']);
	});

	it('wipes and rebuilds all non-deleted items', async () => {
		await ctx.db.run(sql`UPDATE items SET deleted_at = 1 WHERE id = 'it_b'`);
		const n = await reindexAll(ctx.db);
		expect(n).toBe(1);
		expect(await matchIds(ctx, '"alpha"')).toEqual(['it_a']);
		expect(await matchIds(ctx, '"beta"')).toEqual([]);
	});
});
