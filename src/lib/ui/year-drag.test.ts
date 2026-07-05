import { describe, expect, it } from 'vitest';
import { momentumYears, yearsFromDrag } from './year-drag';

describe('yearsFromDrag', () => {
	it('converts drag distance into whole years', () => {
		expect(yearsFromDrag(0)).toBe(0);
		expect(yearsFromDrag(89)).toBe(1);
		expect(yearsFromDrag(-91)).toBe(-1);
	});
});

describe('momentumYears', () => {
	it('projects velocity and clamps extremes', () => {
		expect(momentumYears(0.5)).toBe(1);
		expect(momentumYears(10)).toBe(8);
		expect(momentumYears(-10)).toBe(-8);
	});
});
