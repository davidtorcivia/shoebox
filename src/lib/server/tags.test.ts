import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import { reindexAll } from './search';
import { getTagByName, getTagOverview } from './tags';
import type { StorageAdapter } from './platform/types';

type TestCtx = ReturnType<typeof makeTestDb>;

const storage = {
	mediaUrl: async (key: string) => `/media/${key}`
} as unknown as StorageAdapter;

let ctx: TestCtx;

function seedWorld(c: TestCtx) {
	const { db, schema } = c;
	db.insert(schema.users)
		.values({
			id: 'u_owner',
			username: 'owner',
			passwordHash: 'x',
			role: 'owner',
			accentColor: '#FA7B62',
			createdAt: new Date()
		})
		.run();
	db.insert(schema.people)
		.values([
			{ id: 'p_eric', name: 'Eric', slug: 'eric', accentColor: '#A8D8EA', createdAt: new Date() },
			{ id: 'p_mom', name: 'Mom', slug: 'mom', accentColor: '#FFD9A8', createdAt: new Date() }
		])
		.run();
	db.insert(schema.tags)
		.values([
			{ id: 't_beach', name: 'beach', kind: 'topic' },
			{ id: 't_xmas', name: 'christmas', kind: 'holiday' }
		])
		.run();

	const item = (
		id: string,
		date: string,
		type: 'photo' | 'video',
		status: 'ready' | 'needs_review' = 'ready'
	) =>
		db
			.insert(schema.items)
			.values({
				id,
				type,
				dateStart: date,
				dateEnd: date,
				datePrecision: 'day',
				sortDate: date,
				width: 1,
				height: 1,
				sizeBytes: 1,
				sha256: `sha_${id}`,
				source: 'upload',
				status,
				uploadedBy: 'u_owner',
				createdAt: new Date()
			})
			.run();

	item('it_1', '1993-08-10', 'photo');
	item('it_2', '1996-07-04', 'video');
	item('it_3', '1990-01-01', 'photo');
	// A pending item that must NOT count toward the tag overview.
	item('it_pending', '1999-01-01', 'photo', 'needs_review');

	db.insert(schema.itemTags)
		.values([
			{ itemId: 'it_1', tagId: 't_beach' },
			{ itemId: 'it_2', tagId: 't_beach' },
			{ itemId: 'it_3', tagId: 't_beach' },
			{ itemId: 'it_pending', tagId: 't_beach' }
		])
		.run();
	db.insert(schema.itemPeople)
		.values([
			{ itemId: 'it_1', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_2', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_3', personId: 'p_mom', source: 'manual' }
		])
		.run();
}

beforeEach(async () => {
	ctx = makeTestDb();
	seedWorld(ctx);
	await reindexAll(ctx.db);
});

describe('getTagByName', () => {
	it('resolves a tag case-insensitively', async () => {
		expect(await getTagByName(ctx.db, 'BEACH')).toMatchObject({ id: 't_beach', name: 'beach' });
	});

	it('returns null for an unknown tag', async () => {
		expect(await getTagByName(ctx.db, 'nope')).toBeNull();
	});
});

describe('getTagOverview', () => {
	it('counts only ready items and breaks them down by type', async () => {
		const tag = (await getTagByName(ctx.db, 'beach'))!;
		const overview = await getTagOverview(ctx.db, storage, tag);
		expect(overview.count).toBe(3);
		expect(overview.photoCount).toBe(2);
		expect(overview.videoCount).toBe(1);
	});

	it('reports the year span across tagged items', async () => {
		const tag = (await getTagByName(ctx.db, 'beach'))!;
		const overview = await getTagOverview(ctx.db, storage, tag);
		expect(overview.yearFrom).toBe(1990);
		expect(overview.yearTo).toBe(1996);
	});

	it('ranks the people who appear most under the tag', async () => {
		const tag = (await getTagByName(ctx.db, 'beach'))!;
		const overview = await getTagOverview(ctx.db, storage, tag);
		expect(overview.people.map((person) => person.name)).toEqual(['Eric', 'Mom']);
		expect(overview.people[0]).toMatchObject({ name: 'Eric', count: 2 });
	});
});
