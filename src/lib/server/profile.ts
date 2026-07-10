import { ACCENTS } from '$lib/ui/tokens';
import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword } from './auth';
import { users } from './db/schema';
import type { Db } from './db';
import type { StorageAdapter } from './platform/types';

type Result = { ok: true } | { ok: false; error: string };
const THEMES = ['system', 'dark', 'light'] as const;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Map([
	['image/avif', 'avif'],
	['image/gif', 'gif'],
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp']
]);

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

/**
 * Mark the guided tour as done for this user (finishing and skipping are the
 * same signal: stop prompting). The version only ever moves forward, so a
 * stale tab posting an old version cannot re-arm the tour.
 */
export async function completeTour(db: Db, userId: string, version: number): Promise<void> {
	if (!Number.isInteger(version) || version < 1) throw new Error('Invalid tour version');
	const row = (
		await db
			.select({ tourVersion: users.tourVersion })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
	if (!row) throw new Error('Account not found.');
	await db
		.update(users)
		.set({ tourCompletedAt: new Date(), tourVersion: Math.max(version, row.tourVersion) })
		.where(eq(users.id, userId));
}

export async function updateAvatar(
	db: Db,
	storage: StorageAdapter,
	userId: string,
	input: { bytes: Uint8Array; contentType: string }
): Promise<{ key: string }> {
	const ext = AVATAR_TYPES.get(input.contentType);
	if (!ext) throw new Error('Avatar must be an image file');
	if (input.bytes.byteLength === 0) throw new Error('Choose an avatar image');
	if (input.bytes.byteLength > MAX_AVATAR_BYTES) throw new Error('Avatar must be 5 MB or smaller');

	const row = (
		await db
			.select({ avatarStorageKey: users.avatarStorageKey })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
	if (!row) throw new Error('Account not found.');

	const key = `avatars/users/${userId}/${nanoid(12)}.${ext}`;
	await storage.put(key, input.bytes, {
		contentType: input.contentType,
		sizeHint: input.bytes.byteLength
	});
	await db
		.update(users)
		.set({ avatarStorageKey: key, avatarMime: input.contentType })
		.where(eq(users.id, userId));
	if (row.avatarStorageKey && row.avatarStorageKey !== key) {
		await storage.delete(row.avatarStorageKey);
	}

	return { key };
}

export async function deleteAvatar(db: Db, storage: StorageAdapter, userId: string): Promise<void> {
	const row = (
		await db
			.select({ avatarStorageKey: users.avatarStorageKey })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
	if (!row) throw new Error('Account not found.');

	await db
		.update(users)
		.set({ avatarStorageKey: null, avatarMime: null })
		.where(eq(users.id, userId));
	if (row.avatarStorageKey) await storage.delete(row.avatarStorageKey);
}
