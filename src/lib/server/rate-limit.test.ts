import { beforeEach, describe, expect, it } from 'vitest';
import { _clearRateLimits, rateLimit, resetRateLimit } from './rate-limit';

describe('rateLimit', () => {
	beforeEach(() => {
		_clearRateLimits();
	});

	it('allows requests up to the limit within the window', () => {
		const now = () => 1_000_000;
		const opts = { limit: 3, windowMs: 5_000, now };
		expect(rateLimit('k', opts)).toEqual({ ok: true, retryAfterMs: 0 });
		expect(rateLimit('k', opts)).toEqual({ ok: true, retryAfterMs: 0 });
		expect(rateLimit('k', opts)).toEqual({ ok: true, retryAfterMs: 0 });
	});

	it('blocks requests once the limit is exceeded, reporting retryAfterMs', () => {
		const now = () => 2_000_000;
		const opts = { limit: 2, windowMs: 5_000, now };
		expect(rateLimit('k', opts).ok).toBe(true);
		expect(rateLimit('k', opts).ok).toBe(true);
		const blocked = rateLimit('k', opts);
		expect(blocked.ok).toBe(false);
		expect(blocked.retryAfterMs).toBe(5_000);
	});

	it('opens a fresh window after windowMs elapses', () => {
		let t = 3_000_000;
		const opts = { limit: 1, windowMs: 5_000, now: () => t };
		expect(rateLimit('k', opts).ok).toBe(true);
		expect(rateLimit('k', opts).ok).toBe(false);
		// Advance past the window end.
		t += 5_000;
		expect(rateLimit('k', opts)).toEqual({ ok: true, retryAfterMs: 0 });
		// The new window enforces the limit again.
		expect(rateLimit('k', opts).ok).toBe(false);
	});

	it('tracks keys independently', () => {
		const now = () => 4_000_000;
		const opts = { limit: 1, windowMs: 5_000, now };
		expect(rateLimit('a', opts).ok).toBe(true);
		expect(rateLimit('a', opts).ok).toBe(false);
		// A different key has its own budget.
		expect(rateLimit('b', opts).ok).toBe(true);
	});

	it('resetRateLimit clears a key so its budget is restored', () => {
		const now = () => 5_000_000;
		const opts = { limit: 1, windowMs: 5_000, now };
		expect(rateLimit('k', opts).ok).toBe(true);
		expect(rateLimit('k', opts).ok).toBe(false);
		resetRateLimit('k');
		expect(rateLimit('k', opts).ok).toBe(true);
	});
});
