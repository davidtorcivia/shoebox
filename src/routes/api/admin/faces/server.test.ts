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
import { GET } from './+server';
import { POST as assign } from './clusters/[clusterId]/assign/+server';
import { POST as reject } from './clusters/[clusterId]/reject/+server';
import { POST as split } from './clusters/[clusterId]/split/+server';
import { PATCH as patchBox } from './faces/[faceId]/box/+server';

const EMB = Buffer.alloc(2048);

let db: TestDb;

beforeEach(() => {
	db = makeTestDb();
});

function evt(
	user: unknown,
	opts: { body?: unknown; clusterId?: string; faceId?: string; faces?: boolean } = {}
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
		params: { clusterId: opts.clusterId ?? 'c1', faceId: opts.faceId ?? 'f1' },
		request: new Request('http://test/api/admin/faces', {
			method: opts.body ? 'POST' : 'GET',
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
	await makeItem(db, { id: over.itemId, uploadedBy: ownerId, status: 'ready', type: 'photo' });
	await addThumbs(db, over.itemId);
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

describe('GET /api/admin/faces', () => {
	it('requires admin and the faces feature', async () => {
		const editor = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(GET(evt(editor))).rejects.toMatchObject({ status: 403 });

		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		await expect(GET(evt(admin, { faces: false }))).rejects.toMatchObject({ status: 404 });
	});

	it('lists pending suggestions', async () => {
		const owner = await makeUser(db);
		await addFace(owner.id, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));

		const res = await GET(evt(admin));
		const body = await res.json();

		expect(body.suggestions).toHaveLength(1);
		expect(body.suggestions[0].faces[0].thumbUrl).toBe('/media/media/it1/thumb_400.webp');
	});
});

describe('face review admin actions', () => {
	it('assigns, rejects, splits, and edits boxes', async () => {
		const owner = await makeUser(db);
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const person = await makePerson(db, { name: 'Marta' });
		await addFace(owner.id, { id: 'f1', itemId: 'it1', clusterId: 'c1' });
		await addFace(owner.id, { id: 'f2', itemId: 'it2', clusterId: 'c2' });
		await addFace(owner.id, { id: 'f3', itemId: 'it3', clusterId: 'c3' });
		await addFace(owner.id, { id: 'f4', itemId: 'it4', clusterId: 'c3' });

		expect(
			await (await assign(evt(admin, { clusterId: 'c1', body: { personId: person.id } }))).json()
		).toEqual({ ok: true });
		expect((await db.select().from(schema.faces).where(eq(schema.faces.id, 'f1')))[0].status).toBe(
			'confirmed'
		);

		expect(await (await reject(evt(admin, { clusterId: 'c2' }))).json()).toEqual({ ok: true });
		expect((await db.select().from(schema.faces).where(eq(schema.faces.id, 'f2')))[0].status).toBe(
			'rejected'
		);

		const splitBody = await (
			await split(evt(admin, { clusterId: 'c3', body: { faceIds: ['f4'] } }))
		).json();
		expect(splitBody.clusterId).toEqual(expect.any(String));
		expect(
			(await db.select().from(schema.faces).where(eq(schema.faces.id, 'f4')))[0].clusterId
		).toBe(splitBody.clusterId);

		expect(
			await (
				await patchBox(
					evt(admin, { faceId: 'f3', body: { box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } } })
				)
			).json()
		).toEqual({ ok: true });
		expect((await db.select().from(schema.faces).where(eq(schema.faces.id, 'f3')))[0].box).toBe(
			'{"x":0.2,"y":0.2,"w":0.3,"h":0.3}'
		);
	});
});
