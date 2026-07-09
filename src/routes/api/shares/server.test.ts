import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { getShareByToken, listShares } from '$lib/server/shares';
import {
	makeItem,
	makeTestDb,
	makeUser,
	sessionUser,
	stubStorage,
	type TestDb
} from '$lib/server/testing/db';
import { GET, POST } from './+server';
import { DELETE } from './[id]/+server';

let db: TestDb;
let editor: ReturnType<typeof sessionUser>;
let viewer: ReturnType<typeof sessionUser>;

beforeEach(async () => {
	db = makeTestDb();
	editor = sessionUser(await makeUser(db, { role: 'editor', username: 'aunt' }));
	viewer = sessionUser(await makeUser(db, { role: 'user', username: 'kid' }));
	await db.insert(schema.albums).values({
		id: 'al_1',
		title: 'Christmas 1994',
		description: null,
		coverItemId: null,
		createdBy: editor.id,
		createdAt: new Date(),
		deletedAt: null
	});
	await makeItem(db, {
		id: 'it_1',
		uploadedBy: editor.id,
		dateStart: '1994-12-25',
		dateEnd: '1994-12-25',
		sortDate: '1994-12-25'
	});
});

function event(
	user: typeof editor | typeof viewer | null,
	init: { body?: unknown; url?: string; params?: Record<string, string> } = {}
) {
	return {
		locals: { db, user, platform: { storage: stubStorage }, shareTokens: [] },
		params: init.params ?? {},
		url: new URL(init.url ?? 'http://test/api/shares'),
		request: new Request('http://test/api/shares', {
			method: init.body ? 'POST' : 'GET',
			headers: init.body ? { 'content-type': 'application/json' } : undefined,
			body: init.body ? JSON.stringify(init.body) : undefined
		})
	} as never;
}

describe('POST /api/shares', () => {
	it('rejects role < editor', async () => {
		await expect(
			POST(event(viewer, { body: { targetType: 'album', targetId: 'al_1' } }))
		).rejects.toMatchObject({ status: 403 });
	});

	it('404s on a missing target', async () => {
		await expect(
			POST(event(editor, { body: { targetType: 'album', targetId: 'al_missing' } }))
		).rejects.toMatchObject({ status: 404 });
	});

	it('creates album share with 7d expiry and returns the public url', async () => {
		const res = await POST(
			event(editor, {
				body: {
					targetType: 'album',
					targetId: 'al_1',
					password: 'pw',
					expiry: '7d',
					allowDownload: true
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.url).toBe(`/share/${body.share.token}`);
		const stored = await getShareByToken(db, body.share.token);
		expect(stored?.hasPassword).toBe(true);
		expect(stored?.allowDownload).toBe(true);
		const days = (stored!.expiresAt!.getTime() - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(6.9);
		expect(days).toBeLessThan(7.1);
	});

	it('lets any user share their own saved collection, scoped to their id', async () => {
		// No editor role, and the client-supplied targetId is ignored in favour of
		// the caller's own id — a link can never expose someone else's saves.
		const res = await POST(
			event(viewer, { body: { targetType: 'favorites', targetId: 'not-mine' } })
		);
		expect(res.status).toBe(201);
		const { share } = await res.json();
		const stored = await getShareByToken(db, share.token);
		expect(stored?.targetType).toBe('favorites');
		expect(stored?.targetId).toBe(viewer.id);
	});

	it('persists a video segment on an item share', async () => {
		const res = await POST(
			event(editor, {
				body: { targetType: 'item', targetId: 'it_1', segmentStart: 3, segmentEnd: 12 }
			})
		);
		expect(res.status).toBe(201);
		const { share } = await res.json();
		const stored = await getShareByToken(db, share.token);
		expect(stored?.segmentStart).toBe(3);
		expect(stored?.segmentEnd).toBe(12);
	});

	it('rejects a reversed or empty segment', async () => {
		await expect(
			POST(
				event(editor, {
					body: { targetType: 'item', targetId: 'it_1', segmentStart: 12, segmentEnd: 3 }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects a segment on a non-item share', async () => {
		await expect(
			POST(
				event(editor, {
					body: { targetType: 'album', targetId: 'al_1', segmentStart: 1, segmentEnd: 5 }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('accepts a custom ISO date expiry and never-expiry', async () => {
		const past = await POST(
			event(editor, { body: { targetType: 'item', targetId: 'it_1', expiry: '2000-01-01' } })
		);
		const pastShare = (await past.json()).share;
		expect(new Date(pastShare.expiresAt).getUTCFullYear()).toBe(2000);

		const never = await POST(
			event(editor, { body: { targetType: 'item', targetId: 'it_1', expiry: 'never' } })
		);
		expect((await never.json()).share.expiresAt).toBeNull();
	});
});

describe('GET /api/shares', () => {
	it('filters by target', async () => {
		await POST(event(editor, { body: { targetType: 'album', targetId: 'al_1' } }));
		await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1' } }));

		const res = await GET(
			event(editor, { url: 'http://test/api/shares?targetType=album&targetId=al_1' })
		);
		const body = await res.json();
		expect(body.shares).toHaveLength(1);
		expect(body.shares[0].targetType).toBe('album');
	});
});

describe('DELETE /api/shares/[id]', () => {
	it('revokes', async () => {
		const res = await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1' } }));
		const { share } = await res.json();
		const del = await DELETE(event(editor, { params: { id: share.id } }));
		expect(del.status).toBe(204);
		expect(await listShares(db)).toHaveLength(0);
	});
});
