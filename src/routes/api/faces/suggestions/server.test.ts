import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import {
	addThumbs,
	makeItem,
	makePerson,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { GET as confirmedFaces } from '../../items/[id]/faces/+server';
import { PATCH as patchFace } from '../[faceId]/+server';
import { POST as clusterAction } from '../clusters/[clusterId]/+server';
import { GET } from './+server';

const EMB = Buffer.alloc(2048);

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(
	user: unknown,
	opts: {
		body?: unknown;
		clusterId?: string;
		faceId?: string;
		itemId?: string;
		faces?: boolean;
		method?: string;
	} = {}
) {
	return {
		locals: {
			db,
			user,
			platform: {
				storage: stubStorage,
				features: { ingestion: true, faces: opts.faces ?? true, serverDerivatives: true }
			}
		},
		params: {
			clusterId: opts.clusterId ?? 'c1',
			faceId: opts.faceId ?? 'f1',
			id: opts.itemId ?? 'it1'
		},
		request: new Request('http://test/api/faces', {
			method: opts.method ?? (opts.body ? 'POST' : 'GET'),
			body: opts.body ? JSON.stringify(opts.body) : undefined,
			headers: opts.body ? { 'content-type': 'application/json' } : undefined
		})
	} as never;
}

async function addFace(
	ownerId: string,
	over: Partial<typeof schema.faces.$inferInsert> & { id: string; itemId: string }
): Promise<void> {
	const { id, itemId, box, ...rest } = over;
	await makeItem(db, { id: itemId, uploadedBy: ownerId, status: 'ready', type: 'photo' });
	await addThumbs(db, itemId);
	await db.insert(schema.faces).values({
		id,
		itemId,
		box: JSON.stringify(box ?? { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
		embedding: EMB,
		status: 'pending',
		frameTime: null,
		clusterId: 'c1',
		personId: null,
		...rest
	});
}

describe('GET /api/faces/suggestions', () => {
	it('requires editor and enabled faces', async () => {
		await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });

		const user = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(GET(evt(user))).rejects.toMatchObject({ status: 403 });

		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(GET(evt(editor, { faces: false }))).rejects.toMatchObject({ status: 404 });
	});

	it('returns pending suggestion clusters', async () => {
		const owner = await makeUser(db);
		await addFace(owner.id, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));

		const body = await (await GET(evt(editor))).json();

		expect(body.suggestions).toHaveLength(1);
		expect(body.suggestions[0].faces[0].id).toBe('f1');
	});
});

describe('POST /api/faces/clusters/[clusterId]', () => {
	it('assigns, rejects, and splits clusters', async () => {
		const owner = await makeUser(db);
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const person = await makePerson(db, { name: 'Marta' });
		await addFace(owner.id, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(owner.id, { id: 'f2', itemId: 'it2', clusterId: 'c2' });
		await addFace(owner.id, { id: 'f3', itemId: 'it3', clusterId: 'c3' });
		await addFace(owner.id, { id: 'f4', itemId: 'it4', clusterId: 'c3' });

		expect(
			await (
				await clusterAction(
					evt(editor, { clusterId: 'c1', body: { action: 'assign', personId: person.id } })
				)
			).json()
		).toEqual({ ok: true });
		expect((await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0].status).toBe(
			'confirmed'
		);

		expect(
			await (
				await clusterAction(evt(editor, { clusterId: 'c2', body: { action: 'reject' } }))
			).json()
		).toEqual({ ok: true });
		expect((await db.select().from(schema.faces).where(eq(schema.faces.id, 'f2')))[0].status).toBe(
			'rejected'
		);

		const splitBody = await (
			await clusterAction(
				evt(editor, { clusterId: 'c3', body: { action: 'not-same', faceIds: ['f4'] } })
			)
		).json();
		expect(splitBody.clusterId).toEqual(expect.any(String));
		expect(
			(await db.select().from(schema.faces).where(eq(schema.faces.id, 'f4')))[0].clusterId
		).toBe(splitBody.clusterId);
	});
});

describe('face box and item confirmed face APIs', () => {
	it('patches boxes and returns confirmed faces for signed-in users', async () => {
		const owner = await makeUser(db);
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		const person = await makePerson(db, { name: 'Marta', accentColor: '#A8D8EA' });
		await addFace(owner.id, {
			id: 'f1',
			itemId: 'it1',
			clusterId: 'c1',
			status: 'confirmed',
			personId: person.id
		});

		expect(
			await (
				await patchFace(
					evt(editor, {
						faceId: 'f1',
						method: 'PATCH',
						body: { box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }
					})
				)
			).json()
		).toEqual({ ok: true });

		const body = await (await confirmedFaces(evt(viewer, { itemId: 'it1' }))).json();
		expect(body.faces).toEqual([
			{
				id: 'f1',
				box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
				frameTime: null,
				person: { id: person.id, name: 'Marta', accentColor: '#A8D8EA' }
			}
		]);
	});
});
