import { describe, expect, it } from 'vitest';
import { formatTimecode } from './timecode';

describe('formatTimecode', () => {
	it('formats zero', () => expect(formatTimecode(0)).toBe('00:00'));
	it('formats sub-minute values', () => expect(formatTimecode(12)).toBe('00:12'));
	it('formats player mockup values', () => {
		expect(formatTimecode(12)).toBe('00:12');
		expect(formatTimecode(42)).toBe('00:42');
	});
	it('floors fractional seconds', () => expect(formatTimecode(61.94)).toBe('01:01'));
	it('formats hours without zero-padding the hour', () => {
		expect(formatTimecode(3661)).toBe('1:01:01');
	});
	it('clamps invalid values to zero', () => {
		expect(formatTimecode(-5)).toBe('00:00');
		expect(formatTimecode(Number.NaN)).toBe('00:00');
		expect(formatTimecode(Infinity)).toBe('00:00');
	});
});

