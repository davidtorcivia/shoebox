import { ACCENTS } from '$lib/ui/tokens';
import { and, eq, ne } from 'drizzle-orm';
import { hashPassword, verifyPassword } from './auth';
import { users } from './db/schema';
import type { Db } from './db';

type Result = { ok: true } | { ok: false; error: string };
const THEMES = ['system', 'dark', 'light'] as const;

async function reauth(db: Db, userId: string, currentPassword: string): Promise<Result> {
	const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
	if (!row) return { ok: false, error: 'Account not found.' };
	if (!(await verifyPassword(currentPassword, row.passwordHash))) {
		return { ok: false, error: 'Current password is incorrect' };
	}
	return { ok: true };
}

export async function changeUsername(
	db: Db,
	userId: string,
	currentPassword: string,
	newUsername: string
): Promise<Result> {
	const auth = await reauth(db, userId, currentPassword);
	if (!auth.ok) return auth;

	const username = newUsername.trim();
	if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
		return { ok: false, error: 'Username must be 3-32 letters, numbers, dots, or dashes.' };
	}

	const clash = (
		await db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.username, username), ne(users.id, userId)))
			.limit(1)
	)[0];
	if (clash) return { ok: false, error: 'That username is taken' };

	await db.update(users).set({ username }).where(eq(users.id, userId));
	return { ok: true };
}

export async function changePassword(
	db: Db,
	userId: string,
	currentPassword: string,
	newPassword: string
): Promise<Result> {
	const auth = await reauth(db, userId, currentPassword);
	if (!auth.ok) return auth;
	if (newPassword.length < 8) {
		return { ok: false, error: 'New password must be at least 8 characters' };
	}
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(newPassword) })
		.where(eq(users.id, userId));
	return { ok: true };
}

export async function updateAppearance(
	db: Db,
	userId: string,
	prefs: {
		accentColor?: string;
		theme?: 'system' | 'dark' | 'light';
		comfortMode?: boolean;
	}
): Promise<void> {
	const patch: Partial<typeof users.$inferInsert> = {};

	if (prefs.accentColor !== undefined) {
		if (!ACCENTS.some((accent) => accent.hex === prefs.accentColor)) {
			throw new Error('Pick one of the accent swatches');
		}
		patch.accentColor = prefs.accentColor;
	}

	if (prefs.theme !== undefined) {
		if (!THEMES.includes(prefs.theme)) throw new Error('Invalid theme');
		patch.theme = prefs.theme;
	}

	if (prefs.comfortMode !== undefined) patch.comfortMode = prefs.comfortMode;

	if (Object.keys(patch).length > 0) {
		await db.update(users).set(patch).where(eq(users.id, userId));
	}
}
