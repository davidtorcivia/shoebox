import { describe, expect, it } from 'vitest';
import { parseRange } from './http-range';

describe('parseRange', () => {
	it('parses closed, open-ended, and suffix byte ranges', () => {
		expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
		expect(parseRange('bytes=8-', 10)).toEqual({ start: 8, end: 9 });
		expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
	});

	it('returns null for invalid or unsatisfiable ranges', () => {
		expect(parseRange(null, 10)).toBeNull();
		expect(parseRange('items=0-1', 10)).toBeNull();
		expect(parseRange('bytes=12-13', 10)).toBeNull();
		expect(parseRange('bytes=5-4', 10)).toBeNull();
	});

	it('clamps suffix and single-byte ranges to the resource bounds', () => {
		// suffix larger than size → whole resource
		expect(parseRange('bytes=-100', 10)).toEqual({ start: 0, end: 9 });
		// single byte
		expect(parseRange('bytes=5-5', 10)).toEqual({ start: 5, end: 5 });
		// open-ended from zero
		expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
		// end past size is clamped
		expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
	});

	it('rejects start at/after size, empty range, and reversed bounds', () => {
		expect(parseRange('bytes=10-', 10)).toBeNull();
		expect(parseRange('bytes=20-30', 10)).toBeNull();
		expect(parseRange('bytes=-', 10)).toBeNull();
		expect(parseRange('bytes=5-4', 10)).toBeNull();
	});
});
