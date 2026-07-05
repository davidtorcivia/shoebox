import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { makeItem, makeTestDb, makeUser, sessionUser, type TestDb } from '$lib/server/testing/db';
import type { StorageAdapter } from '$lib/server/platform/types';
import { GET } from './+server';

let db: TestDb;
let user: ReturnType<typeof sessionUser>;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);

const storage: StorageAdapter = {
	put: vi.fn(),
	head: vi.fn(),
	delete: vi.fn(),
	get: vi.fn(async (key: string) =>
		key === 'media/it_1/original.jpg'
			? { stream: new Blob([JPEG]).stream(), size: JPEG.length, contentType: 'image/jpeg' }
			: null
	),
	mediaUrl: vi.fn(async (key: string) => `/media/${key}`)
};

beforeEach(async () => {
	db = makeTestDb();
	vi.clearAllMocks();
	const owner = await makeUser(db, { id: 'u_owner', username: 'gran', role: 'owner' });
	user = sessionUser(owner);
	await makeItem(db, {
		id: 'it_1',
		uploadedBy: owner.id,
		title: 'Porch',
		dateStart: '1994-06-14',
		dateEnd: '1994-06-14',
		sortDate: '1994-06-14'
	});
	await db.insert(schema.itemFiles).values([
		{
			id: 'if_original',
			itemId: 'it_1',
			kind: 'original',
			storageKey: 'media/it_1/original.jpg',
			mime: 'image/jpeg',
			width: 8,
			height: 8
		},
		{
			id: 'if_thumb',
			itemId: 'it_1',
			kind: 'thumb_800',
			storageKey: 'media/it_1/thumb_800.webp',
			mime: 'image/webp',
			width: 8,
			height: 8
		}
	]);
	await db.insert(schema.albums).values({
		id: 'al_1',
		title: 'Summer 94',
		description: null,
		coverItemId: null,
		createdBy: owner.id,
		createdAt: new Date(),
		deletedAt: null
	});
	await db.insert(schema.albumItems).values({ albumId: 'al_1', itemId: 'it_1', position: 0 });
});

function event(features: { serverDerivatives: boolean }, id = 'al_1', activeUser: unknown = user) {
	return {
		locals: {
			db,
			user: activeUser,
			platform: {
				name: features.serverDerivatives ? 'node' : 'cloudflare',
				storage,
				queue: { enqueue: vi.fn() },
				features: { ingestion: false, faces: false, serverDerivatives: features.serverDerivatives }
			}
		},
		params: { id }
	} as never;
}

describe('GET /api/albums/[id]/export', () => {
	it('requires a signed-in user', async () => {
		await expect(GET(event({ serverDerivatives: true }, 'al_1', null))).rejects.toMatchObject({
			status: 401
		});
	});

	it('501s on platforms without server derivatives', async () => {
		const res = await GET(event({ serverDerivatives: false }));
		expect(res.status).toBe(501);
		expect(await res.json()).toEqual({ reason: 'export requires the Docker deployment' });
	});

	it('streams a zip with metadata and originals on node', async () => {
		const res = await GET(event({ serverDerivatives: true }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/zip');
		expect(res.headers.get('content-disposition')).toContain('summer-94.zip');
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes[0]).toBe(0x50);
		expect(bytes[1]).toBe(0x4b);
		const text = new TextDecoder('latin1').decode(bytes);
		expect(text).toContain('metadata.json');
		expect(text).toContain('originals/it_1.jpg');
	});

	it('404s a missing or deleted album', async () => {
		await expect(GET(event({ serverDerivatives: true }, 'al_missing'))).rejects.toMatchObject({
			status: 404
		});
		await db
			.update(schema.albums)
			.set({ deletedAt: new Date() })
			.where(eq(schema.albums.id, 'al_1'));
		await expect(GET(event({ serverDerivatives: true }))).rejects.toMatchObject({ status: 404 });
	});
});
