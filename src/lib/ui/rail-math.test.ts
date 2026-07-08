import { describe, expect, it } from 'vitest';
import {
	decadeLabelText,
	mobileRailLabels,
	mobileRailYearTicks,
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
	it('spans from the previous content decade through the current year', () => {
		expect(railSpan(1972, 2026)).toEqual({ start: 1960, end: 2026 });
		expect(railSpan(1993, 2026)).toEqual({ start: 1980, end: 2026 });
	});

	it('falls back to the current decade when there is no content', () => {
		expect(railSpan(null, 2026)).toEqual({ start: 2010, end: 2026 });
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

	it('covers 1980 through the current decade and clips future years', () => {
		expect(decades.map((d) => d.decade)).toEqual([1980, 1990, 2000, 2010, 2020]);
		expect(decades.slice(0, -1).every((d) => d.ticks.length === 10)).toBe(true);
		expect(decades.at(-1)!.ticks.map((tick) => tick.year)).toEqual([
			2020, 2021, 2022, 2023, 2024, 2025, 2026
		]);
	});

	it('scales tick height by sqrt(count) with the max at maxTickPx', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.ticks.find((t) => t.year === 1994)!.height).toBe(44);
		expect(d90.ticks.find((t) => t.year === 1993)!.height).toBe(22);
	});

	it('marks empty years, active year, century marks, and active decade', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1994)!.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.empty).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.height).toBe(0);
		expect(decades.find((d) => d.decade === 2000)!.centuryMark).toBe(true);
		expect(decades.find((d) => d.decade === 1980)!.centuryMark).toBe(false);
		expect(decades.find((d) => d.decade === 2020)!.future).toBe(false);
		expect(decades.find((d) => d.decade === 2020)!.ticks.some((t) => t.year > 2026)).toBe(false);
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

describe('mobileRailYearTicks', () => {
	const ticks = mobileRailYearTicks(YEARS, 1993, 1994, 2026);

	it('emits one tick per year that has media, in order', () => {
		expect(ticks.map((t) => t.year)).toEqual([1993, 1994]);
	});

	it('positions each tick by its fraction across the span', () => {
		// span is 1980..2026
		expect(ticks.find((t) => t.year === 1993)!.frac).toBeCloseTo((1993 - 1980) / (2026 - 1980), 4);
	});

	it('scales height by sqrt(count) with the busiest year tallest, and marks active', () => {
		expect(ticks.find((t) => t.year === 1994)!.height).toBe(28);
		expect(ticks.find((t) => t.year === 1994)!.active).toBe(true);
		expect(ticks.find((t) => t.year === 1993)!.active).toBe(false);
		expect(ticks.find((t) => t.year === 1993)!.height).toBeLessThan(28);
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
