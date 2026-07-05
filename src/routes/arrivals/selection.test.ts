import { describe, expect, it } from 'vitest';
import { moveFocus, parseTagsInput, rangeSelect } from './selection';

describe('moveFocus', () => {
	it('moves down and up while clamping at both ends', () => {
		expect(moveFocus(3, 0, 1)).toBe(1);
		expect(moveFocus(3, 2, 1)).toBe(2);
		expect(moveFocus(3, 1, -1)).toBe(0);
		expect(moveFocus(3, 0, -1)).toBe(0);
	});

	it('returns 0 for an empty list', () => {
		expect(moveFocus(0, 0, 1)).toBe(0);
	});
});

describe('rangeSelect', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];

	it('selects the inclusive range in either direction', () => {
		expect(rangeSelect(ids, 1, 3)).toEqual(['b', 'c', 'd']);
		expect(rangeSelect(ids, 3, 1)).toEqual(['b', 'c', 'd']);
		expect(rangeSelect(ids, 2, 2)).toEqual(['c']);
	});
});

describe('parseTagsInput', () => {
	it('splits on commas, trims, lowercases, drops empties, and dedupes', () => {
		expect(parseTagsInput('Christmas, Tape 04 ,, tape 04 ')).toEqual(['christmas', 'tape 04']);
		expect(parseTagsInput('')).toEqual([]);
	});
});
