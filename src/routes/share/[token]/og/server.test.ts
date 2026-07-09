import { beforeEach, describe, expect, it } from 'vitest';
import { createShare } from '$lib/server/shares';
import { makeItem, makeTestDb, makeUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { GET } from './+server';

let db: TestDb;
let ownerId: string;

beforeEach(async () => {
	db = makeTestDb();
	ownerId = (await makeUser(db, { role: 'owner', username: 'gran' })).id;
	await makeItem(db, { id: 'it_1', uploadedBy: ownerId });
});

function event(token: string) {
	return {
		locals: { db, user: null, platform: { storage: stubStorage }, shareTokens: [] },
		params: { token }
	} as never;
}

// The og image endpoint redirects (302 → /og.png) instead of returning bytes when
// it must not reveal the media. We assert on the thrown Redirect.
async function redirectOf(token: string): Promise<string | null> {
	try {
		await GET(event(token));
		return null;
	} catch (err) {
		const e = err as { status?: number; location?: string };
		return e.status === 302 ? (e.location ?? '') : null;
	}
}

describe('GET /share/[token]/og', () => {
	it('falls back to the branded card for an unknown token', async () => {
		expect(await redirectOf('nope'.repeat(6))).toBe('/og.png');
	});

	it('never reveals media behind a password', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			password: 'secret',
			createdBy: ownerId
		});
		expect(await redirectOf(share.token)).toBe('/og.png');
	});

	it('falls back for an expired share', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			expiresAt: new Date('2000-01-01'),
			createdBy: ownerId
		});
		expect(await redirectOf(share.token)).toBe('/og.png');
	});

	it('falls back when the shared item has no thumbnail', async () => {
		// it_1 has no item_files rows, so there is no representative image to serve.
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			createdBy: ownerId
		});
		expect(await redirectOf(share.token)).toBe('/og.png');
	});
});
