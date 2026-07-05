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
});
