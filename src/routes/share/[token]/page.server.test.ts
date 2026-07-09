import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { Db } from '$lib/server/db';
import { createTestDb } from '$lib/server/db/test-db';
import { _resetShareRateLimits, SHARE_COOKIE_MAX_AGE, createShare } from '$lib/server/shares';
import { actions, load } from './+page.server';

let db: Db;
const OWNER_ID = 'u_owner000001';
type OkShareData = {
	state: 'ok';
	album: { title: string } | null;
	items: Array<{ id: string; title: string | null }>;
	share: { allowDownload: boolean };
};

const fakeStorage = {
	put: vi.fn(),
	get: vi.fn(),
	head: vi.fn(),
	delete: vi.fn(),
	mediaUrl: vi.fn(async (key: string) => `/media/${key}`)
};

function baseEvent(token: string, shareTokens: string[] = []) {
	const cookies = {
		set: vi.fn(),
		get: vi.fn(),
		getAll: vi.fn(() => []),
		delete: vi.fn(),
		serialize: vi.fn()
	};
	return {
		params: { token },
		locals: {
			db,
			user: null,
			shareTokens,
			platform: {
				name: 'node',
				storage: fakeStorage,
				queue: { enqueue: vi.fn() },
				features: { ingestion: true, faces: false, serverDerivatives: true }
			}
		},
		cookies,
		url: new URL(`http://localhost/share/${token}`),
		getClientAddress: () => '203.0.113.7'
	} as never;
}

beforeEach(async () => {
	db = createTestDb();
	_resetShareRateLimits();
	vi.clearAllMocks();
	const now = new Date();
	await db.insert(schema.users).values({
		id: OWNER_ID,
		username: 'gran',
		passwordHash: 'x',
		role: 'owner',
		accentColor: '#FA7B62',
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: now
	});
	await db.insert(schema.items).values({
		id: 'it_1',
		type: 'photo',
		title: 'Porch',
		description: null,
		dateStart: '1994-06-14',
		dateEnd: '1994-06-14',
		datePrecision: 'day',
		sortDate: '1994-06-14',
		duration: null,
		width: 800,
		height: 600,
		sizeBytes: 1,
		sha256: 'a'.repeat(64),
		source: 'upload',
		tapeLabel: null,
		status: 'ready',
		uploadedBy: OWNER_ID,
		deletedAt: null,
		createdAt: now
	});
	await db.insert(schema.itemFiles).values({
		id: 'if_1',
		itemId: 'it_1',
		kind: 'thumb_800',
		storageKey: 'media/it_1/thumb_800.webp',
		mime: 'image/webp',
		width: 800,
		height: 600
	});
	await db.insert(schema.albums).values({
		id: 'al_1',
		title: 'Summer 94',
		description: 'Porch days',
		coverItemId: null,
		createdBy: OWNER_ID,
		createdAt: now,
		deletedAt: null
	});
	await db.insert(schema.albumItems).values({ albumId: 'al_1', itemId: 'it_1', position: 0 });
});

describe('load', () => {
	it('404s an unknown token', async () => {
		await expect(load(baseEvent('missing-token-abcdefghijk'))).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 404
		);
	});

	it('returns expired state', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			expiresAt: new Date('2000-01-01')
		});
		expect(await load(baseEvent(share.token))).toMatchObject({ state: 'expired' });
	});

	it('returns password state without a valid cookie', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			password: 'pw'
		});
		expect(await load(baseEvent(share.token))).toMatchObject({ state: 'password' });
	});

	it('serves album content when the cookie token is present, and refreshes the cookie', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			password: 'pw'
		});
		const ev = baseEvent(share.token, [share.token]);
		const data = (await load(ev)) as OkShareData;
		expect(data.state).toBe('ok');
		expect(data.album?.title).toBe('Summer 94');
		expect(data.items).toHaveLength(1);
		expect(data.share.allowDownload).toBe(false);
		expect((ev as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies.set).toHaveBeenCalledWith(
			`sb_share_${share.token}`,
			expect.stringMatching(/^[0-9a-f]{64}$/),
			expect.objectContaining({
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: SHARE_COOKIE_MAX_AGE
			})
		);
	});

	it('serves passwordless shares immediately and sets the cookie', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			createdBy: OWNER_ID
		});
		const ev = baseEvent(share.token);
		const data = (await load(ev)) as OkShareData;
		expect(data.state).toBe('ok');
		expect(data.album).toBeNull();
		expect(data.items[0].id).toBe('it_1');
		expect((ev as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies.set).toHaveBeenCalled();
	});
});

describe('unlock action', () => {
	function actionEvent(token: string, password: string) {
		const ev = baseEvent(token) as { request?: Request };
		ev.request = new Request(`http://localhost/share/${token}`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ password })
		});
		return ev as never;
	}

	it('sets the cookie and redirects on the right password', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			password: 'cranberry'
		});
		await expect(actions.unlock(actionEvent(share.token, 'cranberry'))).rejects.toSatisfy(
			(err: unknown) =>
				isRedirect(err) && err.status === 303 && err.location === `/share/${share.token}`
		);
	});

	it('fails 400 on a wrong password and 429 when rate limited', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID,
			password: 'cranberry'
		});
		for (let i = 0; i < 5; i += 1) {
			const result = (await actions.unlock(actionEvent(share.token, 'nope'))) as { status: number };
			expect(result.status).toBe(400);
		}
		const limited = (await actions.unlock(actionEvent(share.token, 'nope'))) as { status: number };
		expect(limited.status).toBe(429);
	});
});
