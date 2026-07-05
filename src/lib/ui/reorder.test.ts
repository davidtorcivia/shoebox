import { describe, expect, it } from 'vitest';
import { moveItem, positionsFrom } from './reorder';

describe('moveItem', () => {
	it('moves forward', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
	});

	it('moves backward', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
	});

	it('is identity for same index and does not mutate', () => {
		const source = ['a', 'b'];
		expect(moveItem(source, 1, 1)).toEqual(['a', 'b']);
		expect(source).toEqual(['a', 'b']);
	});

	it('ignores out-of-range indexes', () => {
		expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
		expect(moveItem(['a', 'b'], 0, 4)).toEqual(['a', 'b']);
	});
});

describe('positionsFrom', () => {
	it('maps ids to sequential positions', () => {
		expect(positionsFrom(['x', 'y'])).toEqual([
			{ itemId: 'x', position: 0 },
			{ itemId: 'y', position: 1 }
		]);
	});
});
