import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { makeItem, makePerson, makeTestDb, makeUser, stubStorage } from '$lib/server/testing/db';
import {
	assignCluster,
	assignFaces,
	confirmedFacesForItem,
	listSuggestions,
	rejectCluster,
	rejectFace,
	rejectFaces,
	splitCluster,
	updateFaceBox
} from './faces';

const EMB = Buffer.alloc(2048);

async function addReadyItem(db: ReturnType<typeof makeTestDb>, id: string, uploadedBy: string) {
	await makeItem(db, { id, uploadedBy, status: 'ready', type: 'photo' });
	await db.insert(schema.itemFiles).values({
		id: `file-${id}`,
		itemId: id,
		kind: 'thumb_400',
		storageKey: `media/${id}/thumb_400.webp`,
		mime: 'image/webp',
		width: 400,
		height: 300
	});
}

async function addFace(
	db: ReturnType<typeof makeTestDb>,
	over: Partial<typeof schema.faces.$inferInsert> & { id: string; itemId: string }
) {
	await db.insert(schema.faces).values({
		box: JSON.stringify(over.box ?? { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
		embedding: EMB,
		status: 'pending',
		frameTime: null,
		clusterId: 'c1',
		personId: null,
		...over
	});
}

describe('faces service', () => {
	it('groups pending suggestions by cluster with item thumbnails', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'f2', itemId: 'it2', clusterId: 'c1', frameTime: 3 });
		await addFace(db, { id: 'ignored', itemId: 'it1', clusterId: 'c2', status: 'rejected' });

		const suggestions = await listSuggestions(db, stubStorage);

		expect(suggestions).toEqual([
			{
				clusterId: 'c1',
				count: 2,
				suggestedPerson: null,
				faces: [
					{
						id: 'f1',
						itemId: 'it1',
						itemType: 'photo',
						frameTime: null,
						box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
						thumbUrl: '/media/media/it1/thumb_400.webp',
						cropUrl: '/media/media/it1/faces/f1.jpg'
					},
					{
						id: 'f2',
						itemId: 'it2',
						itemType: 'photo',
						frameTime: 3,
						box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
						thumbUrl: '/media/media/it2/thumb_400.webp',
						cropUrl: '/media/media/it2/faces/f2.jpg'
					}
				]
			}
		]);
	});

	it('surfaces the worker person suggestion and sorts suggested clusters first', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'plain' });
		await addFace(db, { id: 'f2', itemId: 'it1', clusterId: 'plain' });
		await addFace(db, {
			id: 'f3',
			itemId: 'it1',
			clusterId: 'hinted',
			suggestedPersonId: person.id
		});

		const suggestions = await listSuggestions(db, stubStorage);

		expect(suggestions.map((s) => s.clusterId)).toEqual(['hinted', 'plain']);
		expect(suggestions[0].suggestedPerson).toEqual({ id: person.id, name: person.name });
	});

	it('treats a dangling suggested person as no suggestion', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1', suggestedPersonId: 'gone' });

		const suggestions = await listSuggestions(db, stubStorage);

		expect(suggestions[0].suggestedPerson).toBeNull();
	});

	it('assigns a cluster to a person and upserts ml item_people rows', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });

		await assignCluster(db, 'c1', person.id);

		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.status).toBe('confirmed');
		expect(face.personId).toBe(person.id);
		const tagged = await db.select().from(schema.itemPeople);
		expect(tagged).toEqual([
			{
				itemId: 'it1',
				personId: person.id,
				faceBox: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
				source: 'ml'
			}
		]);
	});

	it('reindexes each affected item when assigning a cluster', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'f2', itemId: 'it2', clusterId: 'c1' });
		const reindex = vi.fn(async (_db: ReturnType<typeof makeTestDb>, _itemId: string) => undefined);

		await assignCluster(db, 'c1', person.id, { reindex });

		expect(reindex.mock.calls.map((call) => call[1]).sort()).toEqual(['it1', 'it2']);
	});

	it('refuses missing people and missing items during assignment', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await expect(assignCluster(db, 'c1', 'missing')).rejects.toMatchObject({ status: 404 });

		await addReadyItem(db, 'deleted-item', owner.id);
		await addFace(db, { id: 'bad-item', itemId: 'deleted-item', clusterId: 'c2' });
		await db
			.update(schema.items)
			.set({ deletedAt: new Date() })
			.where(eq(schema.items.id, 'deleted-item'));
		const person = await makePerson(db);
		await expect(assignCluster(db, 'c2', person.id)).rejects.toMatchObject({ status: 404 });
	});

	it('assigns the live faces of a cluster even when a member sits on a deleted item', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db);
		await addReadyItem(db, 'live', owner.id);
		await addReadyItem(db, 'gone', owner.id);
		await addFace(db, { id: 'f-live', itemId: 'live', clusterId: 'c1' });
		await addFace(db, { id: 'f-gone', itemId: 'gone', clusterId: 'c1' });
		await db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, 'gone'));

		// The deleted-item face must not block assigning the rest of the cluster.
		await assignCluster(db, 'c1', person.id, { reindex: async () => undefined });

		const live = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f-live')))[0];
		expect(live.status).toBe('confirmed');
		expect(live.personId).toBe(person.id);
		const tagged = await db.select().from(schema.itemPeople);
		expect(tagged.map((row) => row.itemId)).toEqual(['live']);
	});

	it('rejects a single bad face box without touching its cluster mates', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'good', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'bad', itemId: 'it2', clusterId: 'c1' });

		await rejectFace(db, 'bad', { reindex: async () => undefined });

		const bad = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'bad')))[0];
		expect(bad.status).toBe('rejected');
		expect(bad.clusterId).toBeNull();
		expect(bad.personId).toBeNull();
		const good = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'good')))[0];
		expect(good.status).toBe('pending');
		expect(good.clusterId).toBe('c1');
		// The rejected box drops out of future suggestions; its mate remains.
		const suggestions = await listSuggestions(db, stubStorage);
		expect(suggestions).toEqual([expect.objectContaining({ clusterId: 'c1', count: 1 })]);
	});

	it('assignFaces confirms by face id even after the cluster was renamed', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		// Simulate the worker reclustering and renaming the cluster after the admin
		// loaded the suggestion but before they clicked Assign.
		await db.update(schema.faces).set({ clusterId: 'c1-renamed' }).where(eq(schema.faces.id, 'f1'));

		await assignFaces(db, ['f1'], person.id, { reindex: async () => undefined });

		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.status).toBe('confirmed');
		expect(face.personId).toBe(person.id);
	});

	it('rejectFaces rejects by face id regardless of current cluster', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await db.update(schema.faces).set({ clusterId: 'c1-renamed' }).where(eq(schema.faces.id, 'f1'));

		await rejectFaces(db, ['f1'], { reindex: async () => undefined });

		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.status).toBe('rejected');
		expect(face.clusterId).toBeNull();
	});

	it('rejects a cluster and clears its cluster id', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });

		await rejectCluster(db, 'c1');

		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.status).toBe('rejected');
		expect(face.clusterId).toBeNull();
		expect(face.personId).toBeNull();
	});

	it('reindexes each affected item when rejecting a cluster', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'f2', itemId: 'it2', clusterId: 'c1' });
		const reindex = vi.fn(async (_db: ReturnType<typeof makeTestDb>, _itemId: string) => undefined);

		await rejectCluster(db, 'c1', { reindex });

		expect(reindex.mock.calls.map((call) => call[1]).sort()).toEqual(['it1', 'it2']);
	});

	it('keeps rejected faces out of future suggestions', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });

		await rejectCluster(db, 'c1', { reindex: async () => undefined });

		expect(await listSuggestions(db, stubStorage)).toEqual([]);
	});

	it('splits selected faces into a new pending cluster', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'f2', itemId: 'it2', clusterId: 'c1' });

		const newClusterId = await splitCluster(db, ['f2'], () => 'c2');

		expect(newClusterId).toBe('c2');
		const rows = await db.select().from(schema.faces);
		expect(Object.fromEntries(rows.map((row) => [row.id, row.clusterId]))).toEqual({
			f1: 'c1',
			f2: 'c2'
		});
	});

	it('reindexes each affected item when splitting a cluster', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addReadyItem(db, 'it2', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(db, { id: 'f2', itemId: 'it2', clusterId: 'c1' });
		const reindex = vi.fn(async (_db: ReturnType<typeof makeTestDb>, _itemId: string) => undefined);

		await splitCluster(db, ['f1', 'f2'], () => 'c2', { reindex });

		expect(reindex.mock.calls.map((call) => call[1]).sort()).toEqual(['it1', 'it2']);
	});

	it('refuses empty or unknown-face split requests', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });

		await expect(splitCluster(db, [])).rejects.toMatchObject({ status: 400 });
		await expect(splitCluster(db, ['missing'])).rejects.toMatchObject({ status: 404 });
	});

	it('splits by face id regardless of the current cluster id', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		// A background recluster renamed the cluster; split still works by face id.
		await db.update(schema.faces).set({ clusterId: 'c1-renamed' }).where(eq(schema.faces.id, 'f1'));

		const next = await splitCluster(db, ['f1'], () => 'c2', { reindex: async () => undefined });
		expect(next).toBe('c2');
		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.clusterId).toBe('c2');
	});

	it('validates and patches face boxes', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, { id: 'f1', itemId: 'it1' });
		const reindex = vi.fn(async (_db: ReturnType<typeof makeTestDb>, _itemId: string) => undefined);

		await updateFaceBox(db, 'f1', { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, { reindex });
		const face = (await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0];
		expect(face.box).toBe('{"x":0.2,"y":0.3,"w":0.4,"h":0.2}');
		expect(reindex.mock.calls.map((call) => call[1])).toEqual(['it1']);

		await expect(updateFaceBox(db, 'f1', { x: 0.9, y: 0.3, w: 0.4, h: 0.2 })).rejects.toMatchObject(
			{
				status: 400
			}
		);
		await expect(
			updateFaceBox(db, 'missing', { x: 0.2, y: 0.3, w: 0.4, h: 0.2 })
		).rejects.toMatchObject({
			status: 404
		});
	});

	it('returns confirmed faces for an item with person labels', async () => {
		const db = makeTestDb();
		const owner = await makeUser(db);
		const person = await makePerson(db, { name: 'Marta', accentColor: '#A8D8EA' });
		await addReadyItem(db, 'it1', owner.id);
		await addFace(db, {
			id: 'f1',
			itemId: 'it1',
			status: 'confirmed',
			personId: person.id,
			clusterId: 'c1'
		});

		expect(await confirmedFacesForItem(db, 'it1')).toEqual([
			{
				id: 'f1',
				box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
				frameTime: null,
				person: { id: person.id, slug: person.slug, name: 'Marta', accentColor: '#A8D8EA' }
			}
		]);
	});
});
