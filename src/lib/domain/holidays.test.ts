import { describe, expect, it } from 'vitest';
import { HOLIDAYS, easterDate, holidaysFor } from './holidays';

describe('holidaysFor fixed-date holidays', () => {
	it('tags christmas on 12-25', () => {
		expect(holidaysFor('1994-12-25')).toContain('christmas');
	});

	it('tags christmas-eve on 12-24', () => {
		expect(holidaysFor('1994-12-24')).toContain('christmas-eve');
	});

	it('tags new-years-day on 01-01', () => {
		expect(holidaysFor('1995-01-01')).toContain('new-years-day');
	});

	it('tags new-years-eve on 12-31', () => {
		expect(holidaysFor('1994-12-31')).toContain('new-years-eve');
	});

	it('tags july-4th on 07-04', () => {
		expect(holidaysFor('1994-07-04')).toContain('july-4th');
	});

	it('tags halloween on 10-31', () => {
		expect(holidaysFor('1994-10-31')).toContain('halloween');
	});

	it('tags valentines on 02-14', () => {
		expect(holidaysFor('1994-02-14')).toContain('valentines');
	});

	it('tags st-patricks on 03-17', () => {
		expect(holidaysFor('1994-03-17')).toContain('st-patricks');
	});

	it('tags veterans-day on 11-11', () => {
		expect(holidaysFor('1994-11-11')).toContain('veterans-day');
	});

	it('returns [] for a plain day', () => {
		expect(holidaysFor('1994-03-02')).toEqual([]);
	});

	it('returns [] for non-date input', () => {
		expect(holidaysFor('')).toEqual([]);
		expect(holidaysFor('1994-12')).toEqual([]);
		expect(holidaysFor('garbage')).toEqual([]);
	});

	it('registry contains every fixed id', () => {
		const ids = HOLIDAYS.map((holiday) => holiday.id);
		for (const id of [
			'christmas',
			'christmas-eve',
			'new-years-day',
			'new-years-eve',
			'july-4th',
			'halloween',
			'valentines',
			'st-patricks',
			'veterans-day'
		]) {
			expect(ids).toContain(id);
		}
	});
});

describe('holidaysFor rule-based holidays', () => {
	it('tags Thanksgiving as the fourth Thursday in November', () => {
		expect(holidaysFor('1994-11-24')).toContain('thanksgiving');
		expect(holidaysFor('1994-11-17')).not.toContain('thanksgiving');
		expect(holidaysFor('2023-11-23')).toContain('thanksgiving');
	});

	it("tags Mother's Day as the second Sunday in May", () => {
		expect(holidaysFor('1994-05-08')).toContain('mothers-day');
		expect(holidaysFor('1994-05-01')).not.toContain('mothers-day');
	});

	it("tags Father's Day as the third Sunday in June", () => {
		expect(holidaysFor('1994-06-19')).toContain('fathers-day');
	});

	it('tags Labor Day as the first Monday in September', () => {
		expect(holidaysFor('1994-09-05')).toContain('labor-day');
	});

	it('tags Memorial Day as the last Monday in May', () => {
		expect(holidaysFor('1994-05-30')).toContain('memorial-day');
		expect(holidaysFor('1994-05-23')).not.toContain('memorial-day');
	});
});

describe('easterDate', () => {
	it('uses known Anonymous Gregorian algorithm dates', () => {
		expect(easterDate(1994)).toBe('1994-04-03');
		expect(easterDate(2000)).toBe('2000-04-23');
		expect(easterDate(2016)).toBe('2016-03-27');
		expect(easterDate(1986)).toBe('1986-03-30');
		expect(easterDate(2024)).toBe('2024-03-31');
	});

	it('tags Easter Sunday and not the following Sunday', () => {
		expect(holidaysFor('1994-04-03')).toContain('easter');
		expect(holidaysFor('1994-04-10')).not.toContain('easter');
	});
});
