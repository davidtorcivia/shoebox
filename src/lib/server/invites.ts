import { nextAccent } from '$lib/domain/accents';
import { asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword } from './auth';
import type { Db } from './db';
import { invites, users } from './db/schema';
import type { Role } from './roles';

export type InviteRole = Exclude<Role, 'owner'>;
export type InviteRow = typeof invites.$inferSelect;

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export async function createInvite(
	db: Db,
	opts: { role: InviteRole; createdBy: string; expiresAt?: Date | null; maxUses?: number }
): Promise<InviteRow> {
	const row: InviteRow = {
		id: nanoid(12),
		token: nanoid(24),
		role: opts.role,
		expiresAt: opts.expiresAt ?? null,
		maxUses: opts.maxUses ?? 1,
		useCount: 0,
		createdBy: opts.createdBy
	};
	await db.insert(invites).values(row);
	return row;
}

export async function listInvites(db: Db): Promise<InviteRow[]> {
	return db.select().from(invites).orderBy(asc(invites.id));
}

export async function revokeInvite(db: Db, id: string): Promise<void> {
	await db.delete(invites).where(eq(invites.id, id));
}

export async function getInviteByToken(db: Db, token: string): Promise<InviteRow | null> {
	const rows = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
	return rows[0] ?? null;
}

export type InviteState = 'valid' | 'expired' | 'exhausted' | 'invalid';

export function inviteState(invite: InviteRow | null, now: Date = new Date()): InviteState {
	if (!invite) return 'invalid';
	if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) return 'expired';
	if (invite.useCount >= invite.maxUses) return 'exhausted';
	return 'valid';
}

export type RedeemResult =
	| { ok: true; user: typeof users.$inferSelect }
	| {
			ok: false;
			reason:
				'expired' | 'exhausted' | 'invalid' | 'username_taken' | 'bad_username' | 'bad_password';
	  };

export async function redeemInvite(
	db: Db,
	token: string,
	input: { username: string; password: string }
): Promise<RedeemResult> {
	const invite = await getInviteByToken(db, token);
	const state = inviteState(invite);
	if (state !== 'valid' || !invite) {
		return { ok: false, reason: state === 'valid' ? 'invalid' : state };
	}
	if (!USERNAME_RE.test(input.username)) return { ok: false, reason: 'bad_username' };
	if (input.password.length < 8) return { ok: false, reason: 'bad_password' };

	const taken = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, input.username))
		.limit(1);
	if (taken.length > 0) return { ok: false, reason: 'username_taken' };

	const accentRows = await db.select({ accentColor: users.accentColor }).from(users);
	const user: typeof users.$inferSelect = {
		id: nanoid(12),
		username: input.username,
		passwordHash: await hashPassword(input.password),
		role: invite.role,
		accentColor: nextAccent(accentRows.map((row) => row.accentColor)),
		personId: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	};
	await db.insert(users).values(user);
	await db
		.update(invites)
		.set({ useCount: invite.useCount + 1 })
		.where(eq(invites.id, invite.id));
	return { ok: true, user };
}
