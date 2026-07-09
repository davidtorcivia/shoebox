import { ACCENTS } from '$lib/ui/tokens';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { createTestDb } from './db/test-db';
import { users } from './db/schema';
import {
	_resetShareRateLimits,
	SHARE_COOKIE_MAX_AGE,
	SHARE_COOKIE_PREFIX,
	createShare,
	getShareByToken,
	listShares,
	resolveShare,
	revokeShare,
	shareCookieValue
} from './shares';

let db: Db;
const OWNER_ID = 'u_owner000001';

beforeEach(async () => {
	db = createTestDb();
	_resetShareRateLimits();
	await db.insert(users).values({
		id: OWNER_ID,
		username: 'gran',
		passwordHash: 'x',
		role: 'owner',
		accentColor: ACCENTS[0].hex,
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});
});

describe('createShare', () => {
	it('creates a 24-char token, persists, hashes the password', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			password: 'cranberry',
			expiresAt: null,
			allowDownload: true,
			createdBy: OWNER_ID
		});

		expect(share.token).toHaveLength(24);
		expect(share.hasPassword).toBe(true);
		expect(share.allowDownload).toBe(true);
		const back = await getShareByToken(db, share.token);
		expect(back?.id).toBe(share.id);
		expect(back?.targetType).toBe('album');
		expect(JSON.stringify(back)).not.toContain('pbkdf2$');
	});

	it('defaults: no password, no expiry, no download', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			createdBy: OWNER_ID
		});
		expect(share.hasPassword).toBe(false);
		expect(share.expiresAt).toBeNull();
		expect(share.allowDownload).toBe(false);
	});
});

describe('resolveShare', () => {
	it('not_found for unknown token', async () => {
		expect(await resolveShare(db, 'nope'.repeat(6))).toEqual({ ok: false, reason: 'not_found' });
	});

	it('expired when expiresAt is in the past', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			createdBy: OWNER_ID,
			expiresAt: new Date('2000-01-01T00:00:00Z')
		});
		expect(await resolveShare(db, share.token)).toEqual({ ok: false, reason: 'expired' });
	});

	it('password_required when protected and no password given', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			password: 'pw',
			createdBy: OWNER_ID
		});
		expect(await resolveShare(db, share.token)).toEqual({
			ok: false,
			reason: 'password_required'
		});
	});

	it('wrong_password then ok with correct password', async () => {
		const share = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			password: 'cranberry',
			createdBy: OWNER_ID
		});
		expect(await resolveShare(db, share.token, 'wrong')).toEqual({
			ok: false,
			reason: 'wrong_password'
		});
		const res = await resolveShare(db, share.token, 'cranberry');
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.share.targetType).toBe('album');
			expect(res.share.targetId).toBe('al_1');
		}
	});

	it('ok immediately when share has no password', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_9',
			createdBy: OWNER_ID
		});
		const res = await resolveShare(db, share.token);
		expect(res.ok).toBe(true);
	});

	it('rate-limits password attempts to 5/min per share', async () => {
		const share = await createShare(db, {
			targetType: 'item',
			targetId: 'it_1',
			password: 'pw',
			createdBy: OWNER_ID
		});
		for (let i = 0; i < 5; i += 1) {
			expect(await resolveShare(db, share.token, 'bad')).toEqual({
				ok: false,
				reason: 'wrong_password'
			});
		}
		expect(await resolveShare(db, share.token, 'bad')).toEqual({
			ok: false,
			reason: 'rate_limited'
		});
		expect(await resolveShare(db, share.token, 'pw')).toEqual({
			ok: false,
			reason: 'rate_limited'
		});

		const nextShare = await createShare(db, {
			targetType: 'item',
			targetId: 'it_2',
			password: 'pw',
			createdBy: OWNER_ID
		});
		expect((await resolveShare(db, nextShare.token, 'pw')).ok).toBe(true);
	});
});

describe('list/revoke', () => {
	it('lists by target and revokes', async () => {
		const albumShare = await createShare(db, {
			targetType: 'album',
			targetId: 'al_1',
			createdBy: OWNER_ID
		});
		await createShare(db, { targetType: 'item', targetId: 'it_1', createdBy: OWNER_ID });
		expect(await listShares(db)).toHaveLength(2);
		expect(await listShares(db, { targetType: 'album', targetId: 'al_1' })).toHaveLength(1);
		await revokeShare(db, albumShare.id);
		expect(await getShareByToken(db, albumShare.token)).toBeNull();
		expect(await listShares(db)).toHaveLength(1);
	});
});

describe('share cookie', () => {
	it('is a stable hex value that cannot be forged from the public token', async () => {
		const v1 = await shareCookieValue('abc');
		const v2 = await shareCookieValue('abc');
		expect(v1).toBe(v2);
		expect(v1).toMatch(/^[0-9a-f]{64}$/);
		expect(v1).not.toBe(await shareCookieValue('abd'));
		expect(SHARE_COOKIE_PREFIX).toBe('sb_share_');
		expect(SHARE_COOKIE_MAX_AGE).toBe(60 * 60 * 24);

		// The cookie must be an HMAC keyed by a server secret, NOT a bare hash
		// of the token: the token is the public share URL, so a plain SHA-256
		// would let any link-holder forge the cookie and bypass password gates.
		const bare = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
		const bareHex = [...new Uint8Array(bare)].map((b) => b.toString(16).padStart(2, '0')).join('');
		expect(v1).not.toBe(bareHex);
	});
});
