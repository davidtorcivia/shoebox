import { describe, expect, it } from 'vitest';
import { ageAt, dateWindowForAge } from './ages';

describe('ageAt', () => {
	it('counts full years only', () => {
		expect(ageAt('1941-03-15', '1994-03-14')).toBe(52);
		expect(ageAt('1941-03-15', '1994-03-15')).toBe(53);
		expect(ageAt('1941-03-15', '1994-06-14')).toBe(53);
	});

	it('returns null before birth', () => {
		expect(ageAt('1941-03-15', '1941-03-14')).toBeNull();
		expect(ageAt('1941-03-15', '1930-01-01')).toBeNull();
	});

	it('returns null strictly after deathDate', () => {
		expect(ageAt('1941-03-15', '2019-06-02', '2019-06-01')).toBeNull();
		expect(ageAt('1941-03-15', '2020-12-25', '2019-06-01')).toBeNull();
	});

	it('still returns the age on the death date itself', () => {
		expect(ageAt('1941-03-15', '2019-06-01', '2019-06-01')).toBe(78);
	});

	it('ignores a null deathDate', () => {
		expect(ageAt('1941-03-15', '2020-01-01', null)).toBe(78);
	});

	it('handles a Feb 29 birthdate by rolling to Mar 1 off-leap', () => {
		expect(ageAt('2000-02-29', '2001-02-28')).toBe(0);
		expect(ageAt('2000-02-29', '2001-03-01')).toBe(1);
	});
});

describe('dateWindowForAge', () => {
	it('computes the inclusive window for an age range', () => {
		expect(dateWindowForAge('1941-03-15', { min: 5, max: 7 })).toEqual({
			start: '1946-03-15',
			end: '1949-03-14'
		});
	});

	it('starts at the birthdate for min zero', () => {
		expect(dateWindowForAge('1941-03-15', { min: 0, max: 0 })).toEqual({
			start: '1941-03-15',
			end: '1942-03-14'
		});
	});

	it('handles Feb 29 birthdates', () => {
		expect(dateWindowForAge('2000-02-29', { min: 1, max: 1 })).toEqual({
			start: '2001-03-01',
			end: '2002-02-28'
		});
	});
});
