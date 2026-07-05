import { describe, expect, it } from 'vitest';
import { fractionOf, timeFromClientX } from './scrub-math';

const rect = { left: 100, width: 400 };

describe('timeFromClientX', () => {
	it('maps pointer position linearly', () => {
		expect(timeFromClientX(100, rect, 42)).toBe(0);
		expect(timeFromClientX(300, rect, 42)).toBe(21);
		expect(timeFromClientX(500, rect, 42)).toBe(42);
	});

	it('clamps outside the rail', () => {
		expect(timeFromClientX(0, rect, 42)).toBe(0);
		expect(timeFromClientX(900, rect, 42)).toBe(42);
	});

	it('returns zero for degenerate rails or durations', () => {
		expect(timeFromClientX(300, { left: 0, width: 0 }, 42)).toBe(0);
		expect(timeFromClientX(300, rect, 0)).toBe(0);
	});
});

describe('fractionOf', () => {
	it('maps 12 seconds of 42 seconds to about 29%', () => {
		expect(fractionOf(12, 42)).toBeCloseTo(0.2857, 3);
	});

	it('clamps to the playable range', () => {
		expect(fractionOf(-1, 42)).toBe(0);
		expect(fractionOf(99, 42)).toBe(1);
		expect(fractionOf(10, 0)).toBe(0);
	});
});
