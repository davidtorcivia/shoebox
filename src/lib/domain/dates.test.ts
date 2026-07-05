import { describe, expect, it } from 'vitest';
import {
	daysInMonth,
	displayDate,
	isValidItemDate,
	itemDateFrom,
	shortDate,
	sortDate,
	yearOf,
	type ItemDate
} from './dates';

const d = (
	dateStart: string | null,
	dateEnd: string | null,
	precision: ItemDate['precision']
): ItemDate => ({ dateStart, dateEnd, precision });

describe('sortDate', () => {
	it('day -> the day itself', () => {
		expect(sortDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('1994-06-14');
	});

	it('month -> midpoint of the month', () => {
		expect(sortDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('1994-06-15');
	});

	it('year -> midpoint of the year', () => {
		expect(sortDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('1994-07-02');
	});

	it('range -> midpoint across years', () => {
		expect(sortDate(d('1992-01-01', '1995-12-31', 'range'))).toBe('1993-12-31');
	});

	it('unknown -> null', () => {
		expect(sortDate(d(null, null, 'unknown'))).toBeNull();
	});
});

describe('displayDate', () => {
	it('day', () =>
		expect(displayDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('June 14, 1994'));

	it('month', () =>
		expect(displayDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('June 1994'));

	it('year', () => expect(displayDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('1994'));

	it('range', () =>
		expect(displayDate(d('1992-01-01', '1995-12-31', 'range'))).toBe(
			'Between 1992 and 1995'
		));

	it('unknown', () => expect(displayDate(d(null, null, 'unknown'))).toBe('Undated'));
});

describe('shortDate', () => {
	it('day', () => expect(shortDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('Jun 14'));

	it('month', () => expect(shortDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('Jun'));

	it('year -> circa', () =>
		expect(shortDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('c. 1994'));

	it('range, same century -> short circa with en dash', () =>
		expect(shortDate(d('1992-01-01', '1995-12-31', 'range'))).toBe('c. 1992–95'));

	it('range across a century -> full end year', () =>
		expect(shortDate(d('1998-01-01', '2003-12-31', 'range'))).toBe('c. 1998–2003'));

	it('unknown -> em dash', () => expect(shortDate(d(null, null, 'unknown'))).toBe('—'));
});

describe('yearOf', () => {
	it('year of the computed sort date', () =>
		expect(yearOf(d('1992-01-01', '1995-12-31', 'range'))).toBe(1993));

	it('plain year', () => expect(yearOf(d('1994-01-01', '1994-12-31', 'year'))).toBe(1994));

	it('null when unknown', () => expect(yearOf(d(null, null, 'unknown'))).toBeNull());
});

describe('isValidItemDate', () => {
	it('accepts each canonical shape', () => {
		expect(isValidItemDate(d('1994-06-14', '1994-06-14', 'day'))).toBe(true);
		expect(isValidItemDate(d('1994-06-01', '1994-06-30', 'month'))).toBe(true);
		expect(isValidItemDate(d('1992-02-01', '1992-02-29', 'month'))).toBe(true);
		expect(isValidItemDate(d('1994-01-01', '1994-12-31', 'year'))).toBe(true);
		expect(isValidItemDate(d('1992-01-01', '1995-12-31', 'range'))).toBe(true);
		expect(isValidItemDate(d(null, null, 'unknown'))).toBe(true);
	});

	it('rejects malformed shapes', () => {
		expect(isValidItemDate(d('1994-06-14', '1994-06-15', 'day'))).toBe(false);
		expect(isValidItemDate(d('1994-06-01', '1994-06-29', 'month'))).toBe(false);
		expect(isValidItemDate(d('1994-02-01', '1994-03-31', 'month'))).toBe(false);
		expect(isValidItemDate(d('1994-02-01', '1994-12-31', 'year'))).toBe(false);
		expect(isValidItemDate(d('1994-01-01', '1994-12-31', 'range'))).toBe(false);
		expect(isValidItemDate(d('1994-02-30', '1994-02-30', 'day'))).toBe(false);
		expect(isValidItemDate(d('junk', 'junk', 'day'))).toBe(false);
		expect(isValidItemDate(d('1994-06-14', null, 'day'))).toBe(false);
		expect(isValidItemDate(d('1994-06-14', '1994-06-14', 'unknown'))).toBe(false);
	});
});

describe('itemDateFrom', () => {
	it('day', () =>
		expect(itemDateFrom({ precision: 'day', day: '1994-06-14' })).toEqual(
			d('1994-06-14', '1994-06-14', 'day')
		));

	it('month expands to full month and is leap-aware', () =>
		expect(itemDateFrom({ precision: 'month', year: 1992, month: 2 })).toEqual(
			d('1992-02-01', '1992-02-29', 'month')
		));

	it('year expands to Jan 1 - Dec 31', () =>
		expect(itemDateFrom({ precision: 'year', year: 1994 })).toEqual(
			d('1994-01-01', '1994-12-31', 'year')
		));

	it('range expands both years', () =>
		expect(itemDateFrom({ precision: 'range', year: 1992, yearEnd: 1995 })).toEqual(
			d('1992-01-01', '1995-12-31', 'range')
		));

	it('unknown is all-null', () =>
		expect(itemDateFrom({ precision: 'unknown' })).toEqual(d(null, null, 'unknown')));

	it('throws on missing inputs', () => {
		expect(() => itemDateFrom({ precision: 'day' })).toThrow();
		expect(() => itemDateFrom({ precision: 'month', year: 1994 })).toThrow();
		expect(() => itemDateFrom({ precision: 'range', year: 1995, yearEnd: 1992 })).toThrow();
	});
});

describe('daysInMonth', () => {
	it('handles leap years', () => {
		expect(daysInMonth(1992, 2)).toBe(29);
		expect(daysInMonth(1994, 2)).toBe(28);
	});
});

