import { isHttpError } from '@sveltejs/kit';
import { ACCENTS } from '$lib/ui/tokens';
import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { users } from './db/schema';
import {
	createInvite,
	getInviteByToken,
	inviteState,
	listInvites,
	redeemInvite,
	revokeInvite
} from './invites';
import { openNodeDb } from './platform/db-node';

async function seedAdmin(db: Db): Promise<string> {
	const id = nanoid(12);
	await db.insert(users).values({
		id,
		username: `admin-${id}`,
		passwordHash: 'unused',
		role: 'admin',
		accentColor: ACCENTS[0].hex,
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});
	return id;
}

async function seedOwner(db: Db): Promise<string> {
	const id = nanoid(12);
	await db.insert(users).values({
		id,
		username: `owner-${id}`,
		passwordHash: 'unused',
		role: 'owner',
		accentColor: ACCENTS[0].hex,
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});
	return id;
}

describe('createInvite / listInvites / revokeInvite', () => {
	it('creates an invite with a 24-char token, preset role, defaults', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const invite = await createInvite(db, { role: 'user', createdBy: adminId });
		expect(invite.token).toHaveLength(24);
		expect(invite.role).toBe('user');
		expect(invite.maxUses).toBe(1);
		expect(invite.useCount).toBe(0);
		expect(invite.expiresAt).toBeNull();
		expect(await listInvites(db)).toHaveLength(1);
	});

	it('revoke removes the invite', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const invite = await createInvite(db, { role: 'editor', createdBy: adminId });
		await revokeInvite(db, invite.id);
		expect(await listInvites(db)).toHaveLength(0);
		expect(await getInviteByToken(db, invite.token)).toBeNull();
	});
});

describe('inviteState', () => {
	it('classifies valid/expired/exhausted/invalid', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const fresh = await createInvite(db, { role: 'user', createdBy: adminId });
		expect(inviteState(fresh)).toBe('valid');
		expect(inviteState(null)).toBe('invalid');
		const expired = await createInvite(db, {
			role: 'user',
			createdBy: adminId,
			expiresAt: new Date(Date.now() - 1000)
		});
		expect(inviteState(expired)).toBe('expired');
		expect(inviteState({ ...fresh, useCount: 1 })).toBe('exhausted');
	});
});

describe('redeemInvite', () => {
	it('creates a user with the preset role, next accent, and bumps useCount', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const invite = await createInvite(db, { role: 'uploader', createdBy: adminId, maxUses: 2 });
		const result = await redeemInvite(db, invite.token, {
			username: 'cousin',
			password: 'long-enough-pw'
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.user.role).toBe('uploader');
		expect(result.user.accentColor).toBe(ACCENTS[1].hex);
		const after = await getInviteByToken(db, invite.token);
		expect(after!.useCount).toBe(1);
	});

	it('rejects expired, exhausted, unknown tokens, and bad input', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const expired = await createInvite(db, {
			role: 'user',
			createdBy: adminId,
			expiresAt: new Date(Date.now() - 1000)
		});
		expect(
			await redeemInvite(db, expired.token, { username: 'aunt', password: 'long-enough-pw' })
		).toEqual({ ok: false, reason: 'expired' });
		expect(
			await redeemInvite(db, 'no-such-token-aaaaaaaaaaaa', {
				username: 'aunt',
				password: 'long-enough-pw'
			})
		).toEqual({ ok: false, reason: 'invalid' });
		const single = await createInvite(db, { role: 'user', createdBy: adminId });
		await redeemInvite(db, single.token, { username: 'first', password: 'long-enough-pw' });
		expect(
			await redeemInvite(db, single.token, { username: 'second', password: 'long-enough-pw' })
		).toEqual({ ok: false, reason: 'exhausted' });
		const open = await createInvite(db, { role: 'user', createdBy: adminId, maxUses: 5 });
		expect(
			await redeemInvite(db, open.token, { username: 'x', password: 'long-enough-pw' })
		).toEqual({ ok: false, reason: 'bad_username' });
		expect(
			await redeemInvite(db, open.token, { username: 'valid-name', password: 'short' })
		).toEqual({ ok: false, reason: 'bad_password' });
		expect(
			await redeemInvite(db, open.token, { username: 'first', password: 'long-enough-pw' })
		).toEqual({ ok: false, reason: 'username_taken' });
	});

	it('prevents double-redemption of a single-use invite under concurrency', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const invite = await createInvite(db, { role: 'user', createdBy: adminId });
		const results = await Promise.all([
			redeemInvite(db, invite.token, { username: 'cousin-a', password: 'long-enough-pw' }),
			redeemInvite(db, invite.token, { username: 'cousin-b', password: 'long-enough-pw' })
		]);
		const oks = results.filter((r) => r.ok);
		expect(oks).toHaveLength(1);
		expect(results.some((r) => !r.ok && r.reason === 'exhausted')).toBe(true);
		const after = await getInviteByToken(db, invite.token);
		expect(after!.useCount).toBe(1);
	});
});

describe('createInvite admin guard', () => {
	it('rejects an admin invitation created by a non-owner (403)', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		await expect(createInvite(db, { role: 'admin', createdBy: adminId })).rejects.toSatisfy(
			(err: unknown) => isHttpError(err) && err.status === 403
		);
		const remaining = await listInvites(db);
		expect(remaining).toHaveLength(0);
	});

	it('allows an admin invitation created by the owner', async () => {
		const db = openNodeDb(':memory:');
		const ownerId = await seedOwner(db);
		const invite = await createInvite(db, { role: 'admin', createdBy: ownerId });
		expect(invite.role).toBe('admin');
	});

	it('still lets any admin mint non-admin invitations', async () => {
		const db = openNodeDb(':memory:');
		const adminId = await seedAdmin(db);
		const invite = await createInvite(db, { role: 'editor', createdBy: adminId });
		expect(invite.role).toBe('editor');
	});
});
