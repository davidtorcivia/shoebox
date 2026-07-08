import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import { searchAlbumCards, searchPeopleCards } from './search';

type TestCtx = ReturnType<typeof makeTestDb>;

let ctx: TestCtx;

beforeEach(() => {
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
	db.insert(schema.people)
		.values([
			{
				id: 'p1',
				name: 'Eric',
				slug: 'eric',
				accentColor: '#A8D8EA',
				createdAt: new Date()
			},
			{
				id: 'p2',
				name: 'Erica',
				slug: 'erica',
				accentColor: '#FFD9A8',
				createdAt: new Date()
			},
			{
				id: 'p3',
				name: 'Mom',
				slug: 'mom',
				accentColor: '#FFD700',
				createdAt: new Date()
			}
		])
		.run();
	db.insert(schema.albums)
		.values([
			{ id: 'a1', title: 'Summer at the lake', createdBy: 'u1', createdAt: new Date() },
			{
				id: 'a2',
				title: 'Christmas mornings',
				createdBy: 'u1',
				createdAt: new Date(),
				deletedAt: new Date()
			}
		])
		.run();
});

describe('searchPeopleCards', () => {
	it('matches names by substring case-insensitively', async () => {
		const cards = await searchPeopleCards(ctx.db, 'eric');
		expect(cards.map((card) => card.name)).toEqual(['Eric', 'Erica']);
		expect(cards[0]).toEqual({
			id: 'p1',
			slug: 'eric',
			name: 'Eric',
			accentColor: '#A8D8EA',
			avatarItemId: null,
			avatarCrop: null,
			avatarStorageKey: null,
			avatarType: null,
			avatarPosterTime: null
		});
	});

	it('matches any text token', async () => {
		expect((await searchPeopleCards(ctx.db, 'lake mom')).map((card) => card.name)).toEqual(['Mom']);
	});

	it('returns no cards for empty text', async () => {
		expect(await searchPeopleCards(ctx.db, '  ')).toEqual([]);
	});

	it('escapes LIKE wildcards in input', async () => {
		expect(await searchPeopleCards(ctx.db, '%')).toEqual([]);
	});
});

describe('searchAlbumCards', () => {
	it('matches live albums by title token and counts items', async () => {
		const cards = await searchAlbumCards(ctx.db, 'lake');
		expect(cards).toEqual([
			{
				id: 'a1',
				title: 'Summer at the lake',
				coverItemId: null,
				coverStorageKey: null,
				itemCount: 0
			}
		]);
		expect(await searchAlbumCards(ctx.db, 'christmas')).toEqual([]);
	});
});
