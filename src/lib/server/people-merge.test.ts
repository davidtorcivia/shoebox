import { beforeEach, describe, expect, it } from 'vitest';
import { eq, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from './db/schema';
import { makeItem, makePerson, makeTestDb, makeUser, tagPerson, type TestDb } from './testing/db';
import { applyRelationshipChanges, mergePeople } from './people';
import { stubStorage } from './testing/db';

let db: TestDb;
let owner: Awaited<ReturnType<typeof makeUser>>;

beforeEach(async () => {
	db = makeTestDb();
	owner = await makeUser(db, { role: 'editor' });
});

describe('mergePeople', () => {
	it('moves tags (deduping shared items), faces, links, and deletes the source', async () => {
		const dup = await makePerson(db, { id: 'p-dup', name: 'Bob' });
		const keep = await makePerson(db, { id: 'p-keep', name: 'Robert' });
		const shared = await makeItem(db, { uploadedBy: owner.id, status: 'ready' });
		const onlyDup = await makeItem(db, { uploadedBy: owner.id, status: 'ready' });
		await tagPerson(db, shared.id, dup.id);
		await tagPerson(db, shared.id, keep.id); // both tagged — must not collide
		await tagPerson(db, onlyDup.id, dup.id);
		// A linked user account on the duplicate.
		const linked = await makeUser(db, { username: 'bobby' });
		await db.update(schema.users).set({ personId: dup.id }).where(eq(schema.users.id, linked.id));
		// A face confirmed as the duplicate.
		await db.insert(schema.faces).values({
			id: nanoid(12),
			itemId: onlyDup.id,
			box: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
			embedding: Buffer.alloc(8),
			status: 'confirmed',
			clusterId: null,
			personId: dup.id
		});

		await mergePeople(db, dup.id, keep.id);

		expect(
			(await db.select().from(schema.people).where(eq(schema.people.id, dup.id)))[0]
		).toBeUndefined();
		const keepItems = (
			await db.select().from(schema.itemPeople).where(eq(schema.itemPeople.personId, keep.id))
		).map((r) => r.itemId);
		expect(keepItems.sort()).toEqual([onlyDup.id, shared.id].sort());
		expect(
			(await db.select().from(schema.itemPeople).where(eq(schema.itemPeople.personId, dup.id)))
				.length
		).toBe(0);
		expect(
			(await db.select().from(schema.faces).where(eq(schema.faces.personId, keep.id))).length
		).toBe(1);
		expect(
			(await db.select().from(schema.users).where(eq(schema.users.personId, keep.id))).length
		).toBe(1);
	});

	it('rewrites relationships onto the target and drops resulting self-links', async () => {
		const dup = await makePerson(db, { id: 'p-dup', name: 'Bob' });
		const keep = await makePerson(db, { id: 'p-keep', name: 'Robert' });
		const kid = await makePerson(db, { id: 'p-kid', name: 'Kid' });
		// dup is a parent of kid; after merge, keep should be the parent of kid.
		await applyRelationshipChanges(db, stubStorage, dup.id, {
			add: [{ personA: dup.id, personB: kid.id, type: 'parent-of' }],
			remove: []
		});

		await mergePeople(db, dup.id, keep.id);

		const rels = await db
			.select()
			.from(schema.relationships)
			.where(
				or(eq(schema.relationships.personA, keep.id), eq(schema.relationships.personB, keep.id))
			);
		expect(
			rels.some((r) => r.personA === keep.id && r.personB === kid.id && r.type === 'parent-of')
		).toBe(true);
		expect(rels.some((r) => r.personA === r.personB)).toBe(false);
	});

	it('refuses merging a person into themselves', async () => {
		const p = await makePerson(db, { id: 'p1' });
		await expect(mergePeople(db, p.id, p.id)).rejects.toMatchObject({ status: 400 });
	});
});
