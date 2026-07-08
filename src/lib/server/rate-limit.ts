/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * The app runs as a single Node process (adapter-node), so a process-local
 * `Map` is a sufficient (and dependency-free) brute-force guard for auth and
 * share-password endpoints. It is NOT shared across replicas — if this ever
 * runs multi-instance, move this behind a shared store (Redis, etc.).
 *
 * Design notes:
 * - Fixed window per key: the first request opens a window of `windowMs`; up to
 *   `limit` requests are allowed within it, after which requests are rejected
 *   until the window rolls over. This is crisp to reason about and to test.
 * - The clock is injectable (`opts.now`) so tests need not touch wall time.
 *   This is app code, so `Date.now()` is a fine default (unlike workflow code).
 * - Growth is bounded: expired entries are pruned on access (throttled), and a
 *   hard cap evicts oldest entries so a flood of distinct keys can't leak memory.
 */

export interface RateLimitOptions {
	/** Max requests permitted per key within `windowMs`. */
	limit: number;
	/** Window length in milliseconds. */
	windowMs: number;
	/** Injectable clock for tests. Defaults to `Date.now`. */
	now?: () => number;
}

export interface RateLimitResult {
	/** True when the request is under the limit and may proceed. */
	ok: boolean;
	/** Milliseconds until the current window rolls over (0 when `ok`). */
	retryAfterMs: number;
}

interface Entry {
	count: number;
	/** Timestamp (ms) at which the current window ends. */
	expiresAt: number;
}

/** Prune scan runs at most this often (unless the cap forces it sooner). */
const PRUNE_INTERVAL_MS = 60_000;
/** Hard ceiling on tracked keys; oldest are evicted past this. */
const MAX_ENTRIES = 50_000;

const buckets = new Map<string, Entry>();
let lastPruneAt = 0;

function prune(nowMs: number): void {
	if (buckets.size < MAX_ENTRIES && nowMs - lastPruneAt < PRUNE_INTERVAL_MS) return;
	lastPruneAt = nowMs;
	for (const [key, entry] of buckets) {
		if (nowMs >= entry.expiresAt) buckets.delete(key);
	}
	// If a burst of live (unexpired) keys still exceeds the cap, evict oldest
	// first — Map iterates in insertion order — until we are back under it.
	if (buckets.size > MAX_ENTRIES) {
		const overflow = buckets.size - MAX_ENTRIES;
		let removed = 0;
		for (const key of buckets.keys()) {
			buckets.delete(key);
			removed += 1;
			if (removed >= overflow) break;
		}
	}
}

/**
 * Record one request against `key` and report whether it is allowed.
 *
 * A correct-credential path can avoid burning budget by calling
 * {@link resetRateLimit} after a success, so only failed attempts accumulate.
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
	const now = opts.now ?? Date.now;
	const nowMs = now();
	prune(nowMs);

	const entry = buckets.get(key);
	if (!entry || nowMs >= entry.expiresAt) {
		buckets.set(key, { count: 1, expiresAt: nowMs + opts.windowMs });
		return { ok: true, retryAfterMs: 0 };
	}
	if (entry.count >= opts.limit) {
		return { ok: false, retryAfterMs: entry.expiresAt - nowMs };
	}
	entry.count += 1;
	return { ok: true, retryAfterMs: 0 };
}

/** Clear the window for a key (e.g. after a successful sign-in). */
export function resetRateLimit(key: string): void {
	buckets.delete(key);
}

/** Test-only: drop all tracked windows. */
export function _clearRateLimits(): void {
	buckets.clear();
	lastPruneAt = 0;
}
