import { describe, expect, it } from 'vitest';
import {
	activeYearFromSentinels,
	buildGridEntries,
	columnCount,
	layoutMasonry,
	visibleEntryIds
} from './masonry';
import type { ItemDTO } from '$lib/types';

function item(
	id: string,
	dateStart: string | null,
	precision: ItemDTO['date']['precision'] = 'day'
): ItemDTO {
	return {
		id,
		type: 'photo',
		title: null,
		description: null,
		date: { dateStart, dateEnd: dateStart, precision },
		displayDate: 'June 1994',
		shortDate: 'Jun 14',
		duration: null,
		posterTime: null,
		width: 200,
		height: 100,
		status: 'ready',
		urls: { poster: '/p', thumb400: '/t400', thumb800: '/t800', thumb1600: '/t1600' },
		blurhash: null,
		people: [],
		tags: [],
		albums: [],
		uploadedBy: 'u1',
		tapeLabel: null,
		location: null
	};
}

describe('columnCount', () => {
	it('returns responsive masonry columns', () => {
		expect(columnCount(320)).toBe(2);
		expect(columnCount(700)).toBe(3);
		expect(columnCount(1200)).toBe(4);
	});
});

describe('buildGridEntries', () => {
	it('adds month breaks for day/month precision only', () => {
		const entries = buildGridEntries([
			item('a', '1994-06-14'),
			item('b', '1994-06-21'),
			item('c', '1994-07-01'),
			item('d', '1994-01-01', 'year')
		]);
		expect(entries.map((entry) => entry.id)).toEqual([
			'month-1994-06',
			'a',
			'b',
			'month-1994-07',
			'c',
			'd'
		]);
	});
});

describe('layoutMasonry', () => {
	it('lays entries into shortest columns and spans month breaks', () => {
		const layout = layoutMasonry(
			buildGridEntries([item('a', '1994-06-14'), item('b', '1994-06-21')]),
			2,
			100,
			10
		);
		expect(layout.entries[0]).toMatchObject({ id: 'month-1994-06', x: 0, width: 210 });
		expect(layout.height).toBeGreaterThan(0);
	});
});

describe('visibleEntryIds', () => {
	it('returns ids intersecting an overscanned viewport', () => {
		expect(
			visibleEntryIds(
				[
					{ id: 'a', x: 0, y: 0, width: 1, height: 10, entry: item('a', '1994-06-14') as never },
					{ id: 'b', x: 0, y: 2000, width: 1, height: 10, entry: item('b', '1994-06-14') as never }
				],
				0,
				100,
				0
			)
		).toEqual(['a']);
	});
});

describe('activeYearFromSentinels', () => {
	it('returns the latest year sentinel above the threshold', () => {
		expect(
			activeYearFromSentinels(
				[
					{ year: 1993, top: 0 },
					{ year: 1994, top: 500 }
				],
				420
			)
		).toBe(1994);
	});
});
