import { env } from '$env/dynamic/private';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword } from './auth';
import type { Db } from './db';
import { shares } from './db/schema';

export const SHARE_COOKIE_PREFIX = 'sb_share_';
export const SHARE_COOKIE_MAX_AGE = 60 * 60 * 24;

const RATE_CAPACITY = 5;
const RATE_WINDOW_MS = 60_000;

type TargetType = 'album' | 'item' | 'favorites';
type ShareRow = typeof shares.$inferSelect;

type AttemptBucket = {
	count: number;
	windowStart: number;
};

const attemptBuckets = new Map<string, AttemptBucket>();

export interface CreateShareInput {
	targetType: TargetType;
	targetId: string;
	password?: string | null;
	expiresAt?: Date | null;
	allowDownload?: boolean;
	segmentStart?: number | null;
	segmentEnd?: number | null;
	createdBy: string;
}

export interface ShareRecord {
	id: string;
	token: string;
	targetType: TargetType;
	targetId: string;
	hasPassword: boolean;
	expiresAt: Date | null;
	allowDownload: boolean;
	segmentStart: number | null;
	segmentEnd: number | null;
	clipKey: string | null;
	createdBy: string;
}

export type ShareResolution =
	| { ok: true; share: ShareRecord }
	| {
			ok: false;
			reason: 'not_found' | 'expired' | 'password_required' | 'wrong_password' | 'rate_limited';
	  };

function toRecord(row: ShareRow): ShareRecord {
	return {
		id: row.id,
		token: row.token,
		targetType: row.targetType,
		targetId: row.targetId,
		hasPassword: row.passwordHash !== null,
		expiresAt: row.expiresAt ?? null,
		allowDownload: row.allowDownload,
		segmentStart: row.segmentStart ?? null,
		segmentEnd: row.segmentEnd ?? null,
		clipKey: row.clipKey ?? null,
		createdBy: row.createdBy
	};
}

function toHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function takePasswordAttempt(shareId: string, nowMs: number): boolean {
	const bucket = attemptBuckets.get(shareId);
	if (!bucket || nowMs - bucket.windowStart >= RATE_WINDOW_MS) {
		attemptBuckets.set(shareId, { count: 1, windowStart: nowMs });
		return true;
	}
	if (bucket.count >= RATE_CAPACITY) return false;
	bucket.count += 1;
	return true;
}

function resetPasswordAttempts(shareId: string): void {
	attemptBuckets.delete(shareId);
}

export function _resetShareRateLimits(): void {
	attemptBuckets.clear();
}

export async function createShare(db: Db, input: CreateShareInput): Promise<ShareRecord> {
	const password = input.password?.trim();
	const row: ShareRow = {
		id: nanoid(12),
		token: nanoid(24),
		targetType: input.targetType,
		targetId: input.targetId,
		passwordHash: password ? await hashPassword(password) : null,
		expiresAt: input.expiresAt ?? null,
		allowDownload: input.allowDownload ?? false,
		segmentStart: input.segmentStart ?? null,
		segmentEnd: input.segmentEnd ?? null,
		clipKey: null,
		createdBy: input.createdBy
	};
	await db.insert(shares).values(row);
	return toRecord(row);
}

/** Attach the rendered segment clip to a share once it's been cut. */
export async function setShareClip(db: Db, id: string, clipKey: string): Promise<void> {
	await db.update(shares).set({ clipKey }).where(eq(shares.id, id));
}

export async function getShareByToken(db: Db, token: string): Promise<ShareRecord | null> {
	const row = (await db.select().from(shares).where(eq(shares.token, token)).limit(1))[0];
	return row ? toRecord(row) : null;
}

export async function listShares(
	db: Db,
	target?: { targetType: TargetType; targetId: string }
): Promise<ShareRecord[]> {
	const query = db.select().from(shares);
	const rows = target
		? await query
				.where(and(eq(shares.targetType, target.targetType), eq(shares.targetId, target.targetId)))
				.orderBy(asc(shares.id))
		: await query.orderBy(asc(shares.id));
	return rows.map(toRecord);
}

export async function revokeShare(db: Db, id: string): Promise<void> {
	await db.delete(shares).where(eq(shares.id, id));
	resetPasswordAttempts(id);
}

export async function resolveShare(
	db: Db,
	token: string,
	password?: string,
	now: Date = new Date()
): Promise<ShareResolution> {
	const row = (await db.select().from(shares).where(eq(shares.token, token)).limit(1))[0];
	if (!row) return { ok: false, reason: 'not_found' };
	if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
		return { ok: false, reason: 'expired' };
	}
	if (!row.passwordHash) return { ok: true, share: toRecord(row) };
	if (!password) return { ok: false, reason: 'password_required' };

	if (!takePasswordAttempt(row.id, now.getTime())) {
		return { ok: false, reason: 'rate_limited' };
	}

	if (!(await verifyPassword(password, row.passwordHash))) {
		return { ok: false, reason: 'wrong_password' };
	}

	resetPasswordAttempts(row.id);
	return { ok: true, share: toRecord(row) };
}

/**
 * Secret keying the share-access cookie HMAC.
 *
 * Set `SECRET_KEY` in production so cookies survive restarts and are honored by
 * every replica. When unset we fall back to a random per-process key: still
 * unforgeable, but cookies then won't outlive a restart or span instances.
 */
let shareCookieKey: Uint8Array | null = null;
function getShareCookieKey(): Uint8Array {
	if (shareCookieKey) return shareCookieKey;
	const configured = env.SECRET_KEY?.trim();
	shareCookieKey = configured
		? new TextEncoder().encode(configured)
		: crypto.getRandomValues(new Uint8Array(32));
	return shareCookieKey;
}

/**
 * HMAC-SHA256 of the share token keyed by the server secret.
 *
 * This must NOT be a bare hash of the token: the token is the public share URL,
 * so a plain digest would be forgeable by any holder of the link and would
 * defeat password-protected shares (hooks.server.ts validates the cookie by
 * recomputing this value).
 */
export async function shareCookieValue(token: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		getShareCookieKey().buffer as ArrayBuffer,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
	return toHex(new Uint8Array(sig));
}
