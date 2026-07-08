import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
import {
	applyRelationshipChanges,
	createPerson,
	deletePersonGuarded,
	getPersonDetail,
	listPeople,
	personSlugBase,
	resolvePersonId,
	updatePerson
} from './people';

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
		expect(person.slug).toBe('margaret-torcivia');
	});

	it('generates stable readable slugs and suffixes duplicates', async () => {
		expect(personSlugBase('  José & Rose Torcivia!  ')).toBe('jose-and-rose-torcivia');
		const first = await createPerson(db, { name: 'Margaret Torcivia' });
		const second = await createPerson(db, { name: 'Margaret Torcivia' });
		expect(first.slug).toBe('margaret-torcivia');
		expect(second.slug).toBe('margaret-torcivia-2');
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
		// Born 1941-03-15, so each calendar year spans two ages.
		expect(detail.years).toEqual([
			{ year: 1993, count: 1, age: { min: 51, max: 52 } },
			{ year: 1994, count: 2, age: { min: 52, max: 53 } }
		]);
		expect(detail.stats).toEqual({ moments: 4, onFilm: { from: 1993, to: 1994 }, albums: 1 });
		expect(detail.family.spouses).toEqual([
			{
				id: frank.id,
				slug: frank.slug,
				name: 'Frank',
				accentColor: frank.accentColor,
				avatarUrl: null,
				avatarCrop: null
			}
		]);
		expect(detail.linkedUsername).toBeNull();
	});

	it('resolves people by slug or legacy id', async () => {
		const meg = await makePerson(db, { name: 'Margaret', slug: 'margaret' });
		expect(await resolvePersonId(db, 'margaret')).toBe(meg.id);
		expect(await resolvePersonId(db, meg.id)).toBe(meg.id);
		expect(await resolvePersonId(db, 'missing')).toBeNull();
	});

	it('reports the linked username', async () => {
		const meg = await makePerson(db, { name: 'Margaret' });
		await makeUser(db, { username: 'grandma', personId: meg.id });
		const detail = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(detail.linkedUsername).toBe('grandma');
	});
});

describe('updatePerson', () => {
	it('rejects unknown accents, bad dates, empty names, and missing people', async () => {
		const meg = await makePerson(db, {});
		await expect(updatePerson(db, meg.id, { accentColor: '#123456' })).rejects.toMatchObject({
			status: 400
		});
		await expect(updatePerson(db, meg.id, { birthdate: '14 June 1941' })).rejects.toMatchObject({
			status: 400
		});
		await expect(updatePerson(db, meg.id, { name: '  ' })).rejects.toMatchObject({
			status: 400
		});
		await expect(updatePerson(db, nanoid(12), { name: 'X' })).rejects.toMatchObject({
			status: 404
		});
	});

	it('rejects avatar items the person is not tagged in, and bad crops', async () => {
		const meg = await makePerson(db, {});
		const item = await makeItem(db, { uploadedBy: uploader.id });
		await expect(updatePerson(db, meg.id, { avatarItemId: item.id })).rejects.toMatchObject({
			status: 400
		});
		await tagPerson(db, item.id, meg.id);
		await expect(
			updatePerson(db, meg.id, {
				avatarItemId: item.id,
				avatarCrop: { x: 0.8, y: 0, w: 0.4, h: 0.5 }
			})
		).rejects.toMatchObject({ status: 400 });
		await updatePerson(db, meg.id, {
			avatarItemId: item.id,
			avatarCrop: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 }
		});
		const detail = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(detail.avatarCrop).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 });
	});

	it('updates plain fields', async () => {
		const meg = await makePerson(db, { name: 'M' });
		await updatePerson(db, meg.id, {
			name: 'Margaret Torcivia',
			birthdate: '1941-03-15',
			deathDate: '2019-06-01',
			birthPlace: 'Brooklyn, New York',
			bio: 'Ran the kitchen.',
			accentColor: ACCENTS[7].hex
		});
		const detail = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(detail.name).toBe('Margaret Torcivia');
		expect(detail.birthPlace).toBe('Brooklyn, New York');
		expect(detail.accentColor).toBe(ACCENTS[7].hex);
		expect(detail.slug).toBe('margaret-torcivia');
	});
});

describe('deletePersonGuarded', () => {
	it('refuses with the tag count when item_people rows exist', async () => {
		const meg = await makePerson(db, {});
		const item = await makeItem(db, { uploadedBy: uploader.id });
		await tagPerson(db, item.id, meg.id);
		expect(await deletePersonGuarded(db, meg.id)).toEqual({ ok: false, taggedCount: 1 });
	});

	it('deletes an untagged person, their rels, and unlinks users', async () => {
		const meg = await makePerson(db, {});
		const frank = await makePerson(db, {});
		await db.insert(schema.relationships).values({
			id: nanoid(12),
			personA: frank.id,
			personB: meg.id,
			type: 'spouse-of'
		});
		const account = await makeUser(db, { personId: meg.id });
		expect(await deletePersonGuarded(db, meg.id)).toEqual({ ok: true });
		expect(await db.select().from(schema.people).where(eq(schema.people.id, meg.id))).toHaveLength(
			0
		);
		expect(await db.select().from(schema.relationships)).toHaveLength(0);
		const after = (await db.select().from(schema.users)).find((user) => user.id === account.id)!;
		expect(after.personId).toBeNull();
	});

	it('404s on a missing person', async () => {
		await expect(deletePersonGuarded(db, nanoid(12))).rejects.toMatchObject({ status: 404 });
	});
});

describe('applyRelationshipChanges', () => {
	it('canonicalizes symmetric rels at write time', async () => {
		const meg = await makePerson(db, { id: 'p-meg' });
		await makePerson(db, { id: 'p-frank' });
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }],
			remove: []
		});
		const [row] = await db.select().from(schema.relationships);
		expect(row.personA).toBe('p-frank');
		expect(row.personB).toBe('p-meg');
	});

	it('rejects self-rels, unknown people, rels not involving the person, and bad types', async () => {
		const meg = await makePerson(db, {});
		const other = await makePerson(db, {});
		const third = await makePerson(db, {});
		const bad = (add: object) =>
			applyRelationshipChanges(db, stubStorage, meg.id, { add: [add as never], remove: [] });
		await expect(
			bad({ personA: meg.id, personB: meg.id, type: 'spouse-of' })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			bad({ personA: meg.id, personB: nanoid(12), type: 'spouse-of' })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			bad({ personA: other.id, personB: third.id, type: 'spouse-of' })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			bad({ personA: meg.id, personB: other.id, type: 'best-of' })
		).rejects.toMatchObject({ status: 400 });
	});

	it('409s on duplicates in either input order', async () => {
		const meg = await makePerson(db, { id: 'p-meg' });
		await makePerson(db, { id: 'p-frank' });
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-frank', personB: 'p-meg', type: 'spouse-of' }],
			remove: []
		});
		await expect(
			applyRelationshipChanges(db, stubStorage, meg.id, {
				add: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }],
				remove: []
			})
		).rejects.toMatchObject({ status: 409 });
	});

	it('allows replacing a relationship removed in the same change set', async () => {
		const meg = await makePerson(db, { id: 'p-meg' });
		await makePerson(db, { id: 'p-frank' });
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }],
			remove: []
		});
		await expect(
			applyRelationshipChanges(db, stubStorage, meg.id, {
				add: [{ personA: 'p-frank', personB: 'p-meg', type: 'spouse-of' }],
				remove: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }]
			})
		).resolves.toMatchObject({ spouses: [{ id: 'p-frank' }] });
	});

	it('removes rels given either order and returns the updated family', async () => {
		const meg = await makePerson(db, { id: 'p-meg', name: 'Margaret' });
		const frank = await makePerson(db, { id: 'p-frank', name: 'Frank' });
		const carol = await makePerson(db, { id: 'p-carol', name: 'Carol' });
		let family = await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [
				{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' },
				{ personA: 'p-meg', personB: 'p-carol', type: 'parent-of' }
			],
			remove: []
		});
		expect(family.spouses.map((person) => person.id)).toEqual([frank.id]);
		expect(family.children.map((person) => person.id)).toEqual([carol.id]);
		family = await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [],
			remove: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }]
		});
		expect(family.spouses).toEqual([]);
		expect(family.children.map((person) => person.id)).toEqual([carol.id]);
	});

	it('shares a parent added to one sibling with the other, for both people', async () => {
		const meg = await makePerson(db, { id: 'p-meg', name: 'Margaret' });
		const rose = await makePerson(db, { id: 'p-rose', name: 'Rose' });
		const dad = await makePerson(db, { id: 'p-dad', name: 'Dad' });
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-meg', personB: 'p-rose', type: 'sibling-of' }],
			remove: []
		});
		const family = await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-dad', personB: 'p-meg', type: 'parent-of' }],
			remove: []
		});
		expect(family.parents.map((p) => p.id)).toEqual([dad.id]);
		// The inferred parent shows up when viewing the sibling too.
		const roseFamily = await getPersonDetail(db, stubStorage, rose.id);
		expect(roseFamily?.family.parents.map((p) => p.id)).toEqual([dad.id]);
	});

	it('regenerates inferred edges when the manual edge behind them is removed', async () => {
		const meg = await makePerson(db, { id: 'p-meg', name: 'Margaret' });
		await makePerson(db, { id: 'p-rose', name: 'Rose' });
		await makePerson(db, { id: 'p-dad', name: 'Dad' });
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-meg', personB: 'p-rose', type: 'sibling-of' }],
			remove: []
		});
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [{ personA: 'p-dad', personB: 'p-meg', type: 'parent-of' }],
			remove: []
		});
		// Removing the sibling link drops the inferred parent-of dad->rose edge.
		await applyRelationshipChanges(db, stubStorage, meg.id, {
			add: [],
			remove: [{ personA: 'p-meg', personB: 'p-rose', type: 'sibling-of' }]
		});
		const inferred = (await db.select().from(schema.relationships)).filter(
			(r) => r.source === 'inferred'
		);
		expect(inferred).toEqual([]);
	});
});
