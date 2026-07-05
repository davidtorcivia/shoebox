import { beforeEach, describe, expect, it } from 'vitest';
import { itemPeople, items, people, users } from '$lib/server/db/schema';
import { contextFromParams, neighborsOf } from './neighbors';
import { createTestDb, type TestDb } from './db/test-db';

let db: TestDb;

async function seedItem(
	id: string,
	sortDate: string | null,
	opts: Partial<{ type: 'video' | 'photo'; status: 'ready' | 'needs_review'; deleted: boolean }> = {}
) {
	await db.insert(items).values({
		id,
		type: opts.type ?? 'video',
		datePrecision: sortDate ? 'day' : 'unknown',
		dateStart: sortDate,
		dateEnd: sortDate,
		sortDate,
		width: 640,
		height: 360,
		sizeBytes: 1,
		sha256: `sha_${id}`,
		source: 'upload',
		status: opts.status ?? 'ready',
		uploadedBy: 'u_owner00000',
		deletedAt: opts.deleted ? new Date() : null,
		createdAt: new Date()
	});
}

beforeEach(async () => {
	db = createTestDb();
	await db.insert(users).values({
		id: 'u_owner00000',
		username: 'own',
		passwordHash: 'pbkdf2$310000$x$x',
		role: 'owner',
		accentColor: '#FA7B62',
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});
	await db.insert(people).values({
		id: 'p_eric000000',
		name: 'Eric',
		accentColor: '#FA7B62',
		createdAt: new Date()
	});
	await seedItem('it_a', '1994-06-10');
	await seedItem('it_b', '1994-06-14');
	await seedItem('it_c', '1994-06-20', { type: 'photo' });
	await seedItem('it_d', '1995-01-02');
	await seedItem('it_hidden', '1994-06-12', { status: 'needs_review' });
	await seedItem('it_gone', '1994-06-13', { deleted: true });
	await db.insert(itemPeople).values([
		{ itemId: 'it_a', personId: 'p_eric000000', source: 'manual' },
		{ itemId: 'it_c', personId: 'p_eric000000', source: 'manual' }
	]);
});

describe('neighborsOf', () => {
	it('walks chronological order, skipping non-ready and deleted items', async () => {
		expect(await neighborsOf(db, 'it_b', {})).toEqual({ prevId: 'it_a', nextId: 'it_c' });
	});

	it('crosses year boundaries because y is not a filter', async () => {
		expect(await neighborsOf(db, 'it_c', {})).toEqual({ prevId: 'it_b', nextId: 'it_d' });
	});

	it('returns nulls at the edges', async () => {
		expect(await neighborsOf(db, 'it_a', {})).toEqual({ prevId: null, nextId: 'it_b' });
		expect(await neighborsOf(db, 'it_d', {})).toEqual({ prevId: 'it_c', nextId: null });
	});

	it('applies people filters', async () => {
		expect(await neighborsOf(db, 'it_a', { people: ['p_eric000000'] })).toEqual({
			prevId: null,
			nextId: 'it_c'
		});
	});

	it('applies type filters', async () => {
		expect(await neighborsOf(db, 'it_b', { type: 'video' })).toEqual({
			prevId: 'it_a',
			nextId: 'it_d'
		});
	});

	it('returns both nulls for unknown items', async () => {
		expect(await neighborsOf(db, 'it_nope', {})).toEqual({ prevId: null, nextId: null });
	});

	it('breaks sort_date ties by id', async () => {
		await seedItem('it_b2', '1994-06-14');
		expect((await neighborsOf(db, 'it_b', {})).nextId).toBe('it_b2');
		expect((await neighborsOf(db, 'it_b2', {})).prevId).toBe('it_b');
	});
});

describe('contextFromParams', () => {
	it('parses csv ids and ignores y', () => {
		const sp = new URLSearchParams('y=1994&people=p_a,p_b&tags=t_x&type=video&album=al_1');
		expect(contextFromParams(sp)).toEqual({
			people: ['p_a', 'p_b'],
			tags: ['t_x'],
			type: 'video',
			album: 'al_1'
		});
	});

	it('returns an empty context for empty params', () => {
		expect(contextFromParams(new URLSearchParams(''))).toEqual({});
	});

	it('rejects junk type values', () => {
		expect(contextFromParams(new URLSearchParams('type=banana'))).toEqual({});
	});
});
