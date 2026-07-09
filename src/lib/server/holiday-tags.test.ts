import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyHolidayTags } from './items';
import { makeTestDb } from './platform/node-test-db';

type TestCtx = ReturnType<typeof makeTestDb>;

let ctx: TestCtx;

function seedItem(
	c: TestCtx,
	input: {
		id: string;
		dateStart?: string;
		precision?: 'day' | 'month' | 'year' | 'range' | 'unknown';
	}
) {
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
		.onConflictDoNothing()
		.run();
	db.insert(schema.items)
		.values({
			id: input.id,
			type: 'photo',
			title: null,
			description: null,
			dateStart: input.dateStart ?? null,
			dateEnd: input.dateStart ?? null,
			datePrecision: input.precision ?? 'day',
			sortDate: input.dateStart ?? null,
			width: 1,
			height: 1,
			sizeBytes: 1,
			sha256: `sha_${input.id}`,
			source: 'upload',
			status: 'ready',
			uploadedBy: 'u1',
			createdAt: new Date()
		})
		.run();
}

async function holidayTagsOf(c: TestCtx, itemId: string): Promise<string[]> {
	const rows = (await c.db.all(
		sql`SELECT t.name AS name
		    FROM item_tags it
		    INNER JOIN tags t ON t.id = it.tag_id
		    WHERE it.item_id = ${itemId} AND t.kind = 'holiday'
		    ORDER BY t.name`
	)) as { name: string }[];
	return rows.map((row) => row.name);
}

beforeEach(() => {
	ctx = makeTestDb();
});

describe('applyHolidayTags', () => {
	it('tags christmas for a day-precision 12-25 date', async () => {
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual(['christmas']);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['christmas']);
	});

	it('is idempotent', async () => {
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await applyHolidayTags(ctx.db, 'i1');
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['christmas']);
	});

	it('removes stale holiday tags when the date changes', async () => {
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await ctx.db.run(
			sql`UPDATE items
			    SET date_start = '1994-07-04', date_end = '1994-07-04', sort_date = '1994-07-04'
			    WHERE id = 'i1'`
		);
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual(['july-4th']);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['july-4th']);
	});

	it('sheds holiday tags when precision is not day', async () => {
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await ctx.db.run(sql`UPDATE items SET date_precision = 'month' WHERE id = 'i1'`);
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual([]);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual([]);
	});

	it('sheds holiday tags when the item is soft-deleted', async () => {
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await ctx.db.run(sql`UPDATE items SET deleted_at = 1 WHERE id = 'i1'`);
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual([]);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual([]);
	});

	it('honors the holidaySet settings key', async () => {
		await ctx.db.run(
			sql`INSERT INTO settings (key, value) VALUES ('holidaySet', '["thanksgiving"]')`
		);
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual([]);
		seedItem(ctx, { id: 'i2', dateStart: '1994-11-24' });
		expect(await applyHolidayTags(ctx.db, 'i2')).toEqual(['thanksgiving']);
	});

	it('reuses an existing topic tag of the same name without flipping its kind', async () => {
		await ctx.db.run(sql`INSERT INTO tags (id, name, kind) VALUES ('t_c', 'christmas', 'topic')`);
		seedItem(ctx, { id: 'i1', dateStart: '1994-12-25' });
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual(['christmas']);

		const kind = (await ctx.db.all(sql`SELECT kind FROM tags WHERE name = 'christmas'`)) as {
			kind: string;
		}[];
		expect(kind).toEqual([{ kind: 'topic' }]);
		const linked = (await ctx.db.all(
			sql`SELECT tag_id AS tagId FROM item_tags WHERE item_id = 'i1'`
		)) as {
			tagId: string;
		}[];
		expect(linked).toEqual([{ tagId: 't_c' }]);
	});

	it('returns [] for a missing item', async () => {
		expect(await applyHolidayTags(ctx.db, 'nope')).toEqual([]);
	});
});
