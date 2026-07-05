import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { nextAccent } from '$lib/domain/accents';
import { ACCENTS } from '$lib/ui/tokens';
import * as schema from './db/schema';
import {
	addThumbs,
	makeItem,
	makePerson,
	makeTestDb,
	makeUser,
	stubStorage,
	tagPerson,
	type TestDb
} from './testing/db';
import { createPerson, getPersonDetail, listPeople } from './people';

let db: TestDb;
let uploader: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
	db = makeTestDb();
	uploader = await makeUser(db, { role: 'editor' });
});

describe('createPerson', () => {
	it('assigns the least-used accent across people and users', async () => {
		await makeUser(db, { accentColor: ACCENTS[0].hex });
		await makePerson(db, { accentColor: ACCENTS[1].hex });
		const used = (await db.select().from(schema.users))
			.map((user) => user.accentColor)
			.concat((await db.select().from(schema.people)).map((person) => person.accentColor));
		const person = await createPerson(db, { name: 'Margaret Torcivia' });
		expect(person.accentColor).toBe(nextAccent(used));
		expect(person.itemCount).toBe(0);
		expect(person.name).toBe('Margaret Torcivia');
	});
});

describe('listPeople', () => {
	it('counts only non-deleted items and sorts by count desc then name', async () => {
		const meg = await makePerson(db, { name: 'Margaret' });
		const frank = await makePerson(db, { name: 'Frank' });
		await makePerson(db, { name: 'Rose' });
		const item1 = await makeItem(db, { uploadedBy: uploader.id });
		const item2 = await makeItem(db, { uploadedBy: uploader.id });
		const gone = await makeItem(db, { uploadedBy: uploader.id, deletedAt: new Date() });
		await tagPerson(db, item1.id, meg.id);
		await tagPerson(db, item2.id, meg.id);
		await tagPerson(db, item1.id, frank.id);
		await tagPerson(db, gone.id, frank.id);
		const out = await listPeople(db, stubStorage);
		expect(out.map((person) => [person.name, person.itemCount])).toEqual([
			['Margaret', 2],
			['Frank', 1],
			['Rose', 0]
		]);
	});

	it('resolves avatarUrl from the avatar item thumb_400 and parses the crop', async () => {
		const item = await makeItem(db, { uploadedBy: uploader.id });
		await addThumbs(db, item.id);
		const meg = await makePerson(db, {
			avatarItemId: item.id,
			avatarCrop: JSON.stringify({ x: 0.1, y: 0.2, w: 0.4, h: 0.5 })
		});
		await tagPerson(db, item.id, meg.id);
		const [person] = await listPeople(db, stubStorage);
		expect(person.avatarUrl).toBe(`/media/media/${item.id}/thumb_400.webp`);
		expect(person.avatarCrop).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.5 });
	});
});

describe('getPersonDetail', () => {
	it('returns null for a missing id', async () => {
		expect(await getPersonDetail(db, stubStorage, nanoid(12))).toBeNull();
	});

	it('builds year chunks with mid-year ages, stats and family', async () => {
		const meg = await makePerson(db, {
			name: 'Margaret',
			birthdate: '1941-03-15',
			deathDate: '2019-06-01'
		});
		const frank = await makePerson(db, { name: 'Frank' });
		await db.insert(schema.relationships).values({
			id: nanoid(12),
			personA: frank.id,
			personB: meg.id,
			type: 'spouse-of'
		});
		const makeDated = (iso: string) =>
			makeItem(db, { uploadedBy: uploader.id, dateStart: iso, dateEnd: iso, sortDate: iso });
		const itemA = await makeDated('1993-06-01');
		const itemB = await makeDated('1994-06-14');
		const itemC = await makeDated('1994-07-04');
		const undated = await makeItem(db, {
			uploadedBy: uploader.id,
			dateStart: null,
			dateEnd: null,
			sortDate: null,
			datePrecision: 'unknown'
		});
		for (const item of [itemA, itemB, itemC, undated]) await tagPerson(db, item.id, meg.id);

		const albumId = nanoid(12);
		await db.insert(schema.albums).values({
			id: albumId,
			title: 'Lake',
			createdBy: uploader.id,
			createdAt: new Date()
		});
		await db.insert(schema.albumItems).values({ albumId, itemId: itemB.id, position: 0 });

		const detail = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(detail.years).toEqual([
			{ year: 1993, count: 1, age: 52 },
			{ year: 1994, count: 2, age: 53 }
		]);
		expect(detail.stats).toEqual({ moments: 4, onFilm: { from: 1993, to: 1994 }, albums: 1 });
		expect(detail.family.spouses).toEqual([
			{ id: frank.id, name: 'Frank', accentColor: frank.accentColor }
		]);
		expect(detail.linkedUsername).toBeNull();
	});

	it('reports the linked username', async () => {
		const meg = await makePerson(db, { name: 'Margaret' });
		await makeUser(db, { username: 'grandma', personId: meg.id });
		const detail = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(detail.linkedUsername).toBe('grandma');
	});
});
