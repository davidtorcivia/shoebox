import { describe, expect, it } from 'vitest';
import {
	decadeLabelText,
	mobileRailLabels,
	mobileRailTicks,
	nearestYearWithContent,
	railDecades,
	railSpan,
	thumbFraction,
	type YearCount
} from './rail-math';

const YEARS: YearCount[] = [
	{ year: 1993, count: 1, people: 1 },
	{ year: 1994, count: 4, people: 12 }
];

describe('railSpan', () => {
	it('spans from the previous content decade through next current decade', () => {
		expect(railSpan(1972, 2026)).toEqual({ start: 1960, end: 2039 });
		expect(railSpan(1993, 2026)).toEqual({ start: 1980, end: 2039 });
	});

	it('falls back to the current decade when there is no content', () => {
		expect(railSpan(null, 2026)).toEqual({ start: 2010, end: 2039 });
	});
});

describe('decadeLabelText', () => {
	it('century marks render in full, other decades abbreviate', () => {
		expect(decadeLabelText(1900)).toBe('1900');
		expect(decadeLabelText(2000)).toBe('2000');
		expect(decadeLabelText(1910)).toBe("'10");
		expect(decadeLabelText(2030)).toBe("'30");
	});
});

describe('railDecades', () => {
	const decades = railDecades(YEARS, 1993, 1994, 2026, 44);

	it('covers 1980 through 2030 inclusive, ten ticks each', () => {
		expect(decades.map((d) => d.decade)).toEqual([1980, 1990, 2000, 2010, 2020, 2030]);
		expect(decades.every((d) => d.ticks.length === 10)).toBe(true);
	});

	it('scales tick height by sqrt(count) with the max at maxTickPx', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.ticks.find((t) => t.year === 1994)!.height).toBe(44);
		expect(d90.ticks.find((t) => t.year === 1993)!.height).toBe(22);
	});

	it('marks empty years, active year, century marks, active + future decades/years', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1994)!.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.empty).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.height).toBe(0);
		expect(decades.find((d) => d.decade === 2000)!.centuryMark).toBe(true);
		expect(decades.find((d) => d.decade === 1980)!.centuryMark).toBe(false);
		expect(decades.find((d) => d.decade === 2030)!.future).toBe(true);
		expect(decades.find((d) => d.decade === 2020)!.future).toBe(false);
		expect(decades.find((d) => d.decade === 2020)!.ticks.find((t) => t.year === 2027)!.future).toBe(
			true
		);
	});
});

describe('nearestYearWithContent', () => {
	it('returns the closest year that has items, with ties going earlier', () => {
		expect(
			nearestYearWithContent(1960, [
				{ year: 1955, count: 2, people: 0 },
				{ year: 1980, count: 9, people: 0 }
			])
		).toBe(1955);
		expect(
			nearestYearWithContent(1990, [
				{ year: 1985, count: 1, people: 0 },
				{ year: 1995, count: 1, people: 0 }
			])
		).toBe(1985);
		expect(nearestYearWithContent(1994, YEARS)).toBe(1994);
	});

	it('returns null when nothing has content', () => {
		expect(nearestYearWithContent(1990, [])).toBeNull();
		expect(nearestYearWithContent(1990, [{ year: 1980, count: 0, people: 0 }])).toBeNull();
	});
});

describe('mobileRailTicks', () => {
	const ticks = mobileRailTicks(YEARS, 1993, 1994, 2026);

	it('buckets the span into 5-year ticks', () => {
		expect(ticks.length).toBe(12);
		expect(ticks[0].startYear).toBe(1980);
		expect(ticks.at(-1)!.startYear).toBe(2035);
	});

	it('warms only buckets overlapping the active decade; marks empties and futures', () => {
		expect(ticks.filter((t) => t.warm).map((t) => t.startYear)).toEqual([1990, 1995]);
		expect(ticks.find((t) => t.startYear === 1980)!.empty).toBe(true);
		expect(ticks.find((t) => t.startYear === 1990)!.empty).toBe(false);
		expect(ticks.find((t) => t.startYear === 2030)!.future).toBe(true);
	});

	it('gives the fullest bucket 30px', () => {
		expect(ticks.find((t) => t.startYear === 1990)!.height).toBe(30);
	});
});

describe('mobileRailLabels', () => {
	it('marks every 20 years plus the active decade', () => {
		const labels = mobileRailLabels(1912, 1994, 2026);
		expect(labels.map((l) => l.text)).toEqual([
			'1900',
			"'20",
			"'40",
			"'60",
			"'80",
			"'90",
			'2000',
			"'20"
		]);
		expect(labels.filter((l) => l.active).map((l) => l.decade)).toEqual([1990]);
		expect(labels[0].frac).toBe(0);
	});
});

describe('thumbFraction', () => {
	it('interpolates the year across the span, clamped', () => {
		expect(thumbFraction(1900, { start: 1900, end: 2039 })).toBe(0);
		expect(thumbFraction(2039, { start: 1900, end: 2039 })).toBe(1);
		expect(thumbFraction(1994, { start: 1900, end: 2039 })).toBeCloseTo(0.6763, 4);
		expect(thumbFraction(1850, { start: 1900, end: 2039 })).toBe(0);
	});
});
