import { describe, expect, it } from 'vitest';
import { HOLIDAYS, holidaysFor } from './holidays';

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
