import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = new Date('1994-06-14T12:00:00Z');

describe('relativeTime', () => {
	it('says just now under a minute', () => {
		expect(relativeTime('1994-06-14T11:59:30Z', NOW)).toBe('just now');
	});

	it('formats minutes, hours, and days', () => {
		expect(relativeTime('1994-06-14T11:56:00Z', NOW)).toBe('4m ago');
		expect(relativeTime('1994-06-14T09:00:00Z', NOW)).toBe('3h ago');
		expect(relativeTime('1994-06-12T12:00:00Z', NOW)).toBe('2d ago');
	});

	it('falls back to a short date after 30 days', () => {
		expect(relativeTime('1994-01-02T12:00:00Z', NOW)).toBe('Jan 2, 1994');
	});
});
