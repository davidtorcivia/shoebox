import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb, seedItem, seedOwner } from '../../worker/test-helpers';
import { applyArrivalsBatch, discardArrivals } from './arrivals';
import * as schema from './db/schema';
import { MemoryStorage } from './testing/memory-platform';

function setup() {
	const db = createTestDb();
	const owner = seedOwner(db);
	const itemId = seedItem(db, owner, { type: 'video', status: 'needs_review', source: 'ingest' });
	return { db, owner, itemId };
}

describe('applyArrivalsBatch', () => {
	it('applies a day date with holiday tags, tags, and approval to ready', async () => {
		const { db, itemId } = setup();
		const result = await applyArrivalsBatch(db as never, {
			itemIds: [itemId],
			apply: {
				date: { dateStart: '1994-12-25', dateEnd: '1994-12-25', precision: 'day' },
				tags: ['Tape 04', 'birthday']
			},
			approve: true
		});

		expect(result.updated).toBe(1);
		const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.status).toBe('ready');
		expect(item.dateStart).toBe('1994-12-25');
		expect(item.datePrecision).toBe('day');
		expect(item.sortDate).toBe('1994-12-25');

		const tagNames = db
			.select({ name: schema.tags.name })
			.from(schema.itemTags)
			.innerJoin(schema.tags, eq(schema.itemTags.tagId, schema.tags.id))
			.where(eq(schema.itemTags.itemId, itemId))
			.all()
			.map((tag) => tag.name)
			.sort();
		expect(tagNames).toContain('tape 04');
		expect(tagNames).toContain('birthday');
		expect(tagNames).toContain('christmas');

		const yearRows = db
			.select()
			.from(schema.yearCounts)
			.where(eq(schema.yearCounts.year, 1994))
			.all();
		expect(yearRows.length).toBeGreaterThan(0);
	});

	it('applies a day-period capture time alongside a day date', async () => {
		const { db, itemId } = setup();
		await applyArrivalsBatch(db as never, {
			itemIds: [itemId],
			apply: {
				date: { dateStart: '1994-12-25', dateEnd: '1994-12-25', precision: 'day' },
				captureTime: 'afternoon'
			},
			approve: false
		});
		const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.captureTime).toBe('1994-12-25T15:00:00');

		// A non-day date ignores the time rather than storing something bogus.
		await applyArrivalsBatch(db as never, {
			itemIds: [itemId],
			apply: {
				date: { dateStart: '1995-01-01', dateEnd: '1995-12-31', precision: 'year' },
				captureTime: 'morning'
			},
			approve: false
		});
		const after = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(after.captureTime).toBe('1994-12-25T15:00:00');
	});

	it('attaches people and albums without approving', async () => {
		const { db, owner, itemId } = setup();
		db.insert(schema.people)
			.values({
				id: 'p1',
				name: 'Mom',
				slug: 'mom',
				accentColor: '#FA7B62',
				createdAt: new Date()
			})
			.run();
		db.insert(schema.albums)
			.values({ id: 'al1', title: 'Holidays', createdBy: owner, createdAt: new Date() })
			.run();

		await applyArrivalsBatch(db as never, {
			itemIds: [itemId],
			apply: { people: ['p1'], albumId: 'al1' },
			approve: false
		});

		const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.status).toBe('needs_review');
		const people = db
			.select()
			.from(schema.itemPeople)
			.where(eq(schema.itemPeople.itemId, itemId))
			.all();
		expect(people).toHaveLength(1);
		expect(people[0].personId).toBe('p1');
		expect(people[0].source).toBe('manual');
		const albumRows = db
			.select()
			.from(schema.albumItems)
			.where(eq(schema.albumItems.itemId, itemId))
			.all();
		expect(albumRows).toHaveLength(1);
		expect(albumRows[0].position).toBe(0);
	});

	it('is idempotent for repeated people and tags and skips unknown items', async () => {
		const { db, itemId } = setup();
		db.insert(schema.people)
			.values({
				id: 'p1',
				name: 'Mom',
				slug: 'mom',
				accentColor: '#FA7B62',
				createdAt: new Date()
			})
			.run();
		const request = {
			itemIds: [itemId, 'ghost'],
			apply: { people: ['p1'], tags: ['christmas'] },
			approve: false
		};

		await applyArrivalsBatch(db as never, request);
		const result = await applyArrivalsBatch(db as never, request);

		expect(result.updated).toBe(1);
		expect(db.select().from(schema.itemPeople).all()).toHaveLength(1);
		expect(db.select().from(schema.itemTags).all()).toHaveLength(1);
	});
});

describe('discardArrivals', () => {
	it('hard-deletes queued arrivals and their storage files', async () => {
		const { db, itemId } = setup();
		const storage = new MemoryStorage();
		db.insert(schema.itemFiles)
			.values({
				id: 'f1',
				itemId,
				kind: 'original',
				storageKey: `media/${itemId}/original.mp4`,
				mime: 'video/mp4'
			})
			.run();
		await storage.put(`media/${itemId}/original.mp4`, new TextEncoder().encode('bytes'), {
			contentType: 'video/mp4'
		});

		const result = await discardArrivals(db as never, storage, [itemId, 'ghost']);

		expect(result.deleted).toBe(1);
		expect(db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()).toBeUndefined();
		expect(db.select().from(schema.itemFiles).all()).toHaveLength(0);
		expect(await storage.head(`media/${itemId}/original.mp4`)).toBeNull();
	});

	it('refuses items that are not in the review queue', async () => {
		const { db, owner } = setup();
		const readyId = seedItem(db, owner, { status: 'ready' });
		const storage = new MemoryStorage();

		const result = await discardArrivals(db as never, storage, [readyId]);

		expect(result.deleted).toBe(0);
		expect(db.select().from(schema.items).where(eq(schema.items.id, readyId)).get()).toBeDefined();
	});
});
