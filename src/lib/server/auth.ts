import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { sessions, users } from './db/schema';
import type { Role } from './roles';

export const SESSION_COOKIE = 'sb_session';
const PBKDF2_ITERATIONS = 310_000;
const SESSION_DAYS = 30;

export type SessionUser = {
	id: string;
	username: string;
	role: Role;
	accentColor: string;
	avatarStorageKey: string | null;
	personId: string | null;
	comfortMode: boolean;
	theme: 'system' | 'dark' | 'light';
	tourVersion: number;
};

function toB64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromB64(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
	return out;
}

function toHex(bytes: Uint8Array): string {
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations },
		keyMaterial,
		256
	);
	return new Uint8Array(bits);
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return toHex(new Uint8Array(digest));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
	return diff === 0;
}

export async function hashPassword(pw: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(pw, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
	try {
		const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
		if (scheme !== 'pbkdf2' || !iterStr || !saltB64 || !hashB64) return false;
		const iterations = Number.parseInt(iterStr, 10);
		if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10_000_000) {
			return false;
		}
		const expected = fromB64(hashB64);
		const actual = await pbkdf2(pw, fromB64(saltB64), iterations);
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}

export async function createSession(
	db: Db,
	userId: string
): Promise<{ token: string; expiresAt: Date }> {
	const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
	await db.insert(sessions).values({ id: await sha256Hex(token), userId, expiresAt });
	return { token, expiresAt };
}

export async function validateSession(db: Db, token: string): Promise<SessionUser | null> {
	const id = await sha256Hex(token);
	const rows = await db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	if (row.session.expiresAt.getTime() <= Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}
	const user = row.user;
	return {
		id: user.id,
		username: user.username,
		role: user.role,
		accentColor: user.accentColor,
		avatarStorageKey: user.avatarStorageKey,
		personId: user.personId,
		comfortMode: user.comfortMode,
		theme: user.theme,
		tourVersion: user.tourVersion
	};
}

export async function destroySession(db: Db, token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
}

export function setSessionCookie(
	cookies: Cookies,
	token: string,
	expiresAt: Date,
	secure: boolean
): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

const LOGIN_RATE_CAPACITY = 5;
const LOGIN_RATE_WINDOW_MS = 60_000;
type LoginBucket = { count: number; windowStart: number };
const loginBuckets = new Map<string, LoginBucket>();

/**
 * In-memory brute-force limiter for /login, keyed by the (lower-cased)
 * username being attempted. Mirrors the share-password limiter in shares.ts:
 * up to LOGIN_RATE_CAPACITY attempts per LOGIN_RATE_WINDOW_MS, then rejected.
 * Call resetLoginAttempts() after a successful sign-in so a legitimate user
 * is never left locked out.
 */
export function takeLoginAttempt(identifier: string, nowMs: number = Date.now()): boolean {
	const key = identifier.toLowerCase();
	const bucket = loginBuckets.get(key);
	if (!bucket || nowMs - bucket.windowStart >= LOGIN_RATE_WINDOW_MS) {
		loginBuckets.set(key, { count: 1, windowStart: nowMs });
		return true;
	}
	if (bucket.count >= LOGIN_RATE_CAPACITY) return false;
	bucket.count += 1;
	return true;
}

export function resetLoginAttempts(identifier: string): void {
	loginBuckets.delete(identifier.toLowerCase());
}

export function _resetLoginRateLimits(): void {
	loginBuckets.clear();
}
