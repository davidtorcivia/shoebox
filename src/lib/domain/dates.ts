export type DatePrecision = 'day' | 'month' | 'year' | 'range' | 'unknown';

export interface ItemDate {
	dateStart: string | null;
	dateEnd: string | null;
	precision: DatePrecision;
}

export const MONTHS_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

export const MONTHS_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type ItemDateInput =
	| { precision: 'day'; day?: string }
	| { precision: 'month'; year?: number; month?: number }
	| { precision: 'year'; year?: number }
	| { precision: 'range'; year?: number; yearEnd?: number; start?: string; end?: string }
	| { precision: 'unknown' };

export function daysInMonth(year: number, month: number): number {
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error('Invalid year or month');
	}

	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function sortDate(d: ItemDate): string | null {
	if (
		d.precision === 'unknown' ||
		!d.dateStart ||
		!d.dateEnd ||
		!isValidIsoDay(d.dateStart) ||
		!isValidIsoDay(d.dateEnd)
	) {
		return null;
	}

	const start = Date.parse(`${d.dateStart}T00:00:00.000Z`);
	const end = Date.parse(`${d.dateEnd}T00:00:00.000Z`);
	const midpoint = start + Math.floor((end - start) / 2);

	return formatUtcDate(new Date(midpoint));
}

export function displayDate(d: ItemDate): string {
	if (d.precision === 'unknown' || !d.dateStart) {
		return 'Undated';
	}

	const start = parts(d.dateStart);
	const end = d.dateEnd ? parts(d.dateEnd) : null;
	if (!start) {
		return 'Undated';
	}

	switch (d.precision) {
		case 'day':
			return `${MONTHS_LONG[start.month - 1]} ${start.day}, ${start.year}`;
		case 'month':
			return `c. ${MONTHS_LONG[start.month - 1]} ${start.year}`;
		case 'year':
			return `c. ${start.year}`;
		case 'range':
			return end ? displayRange(start, end) : `c. ${start.year}`;
	}
}

export function shortDate(d: ItemDate): string {
	if (d.precision === 'unknown' || !d.dateStart) {
		return '—';
	}

	const start = parts(d.dateStart);
	const end = d.dateEnd ? parts(d.dateEnd) : null;
	if (!start) {
		return '—';
	}

	switch (d.precision) {
		case 'day':
			return `${MONTHS_SHORT[start.month - 1]} ${start.day}`;
		case 'month':
			return `c. ${MONTHS_SHORT[start.month - 1]}`;
		case 'year':
			return `c. ${start.year}`;
		case 'range':
			return end ? shortRange(start, end) : `c. ${start.year}`;
	}
}

export function yearOf(d: ItemDate): number | null {
	const sorted = sortDate(d);
	return sorted ? Number(sorted.slice(0, 4)) : null;
}

export function isValidItemDate(d: ItemDate): boolean {
	if (d.precision === 'unknown') {
		return d.dateStart === null && d.dateEnd === null;
	}

	if (!d.dateStart || !d.dateEnd || !isValidIsoDay(d.dateStart) || !isValidIsoDay(d.dateEnd)) {
		return false;
	}

	const start = parts(d.dateStart);
	const end = parts(d.dateEnd);
	if (!start || !end) return false;

	switch (d.precision) {
		case 'day':
			return d.dateStart === d.dateEnd;
		case 'month':
			return (
				start.year === end.year &&
				start.month === end.month &&
				start.day === 1 &&
				end.day === daysInMonth(start.year, start.month)
			);
		case 'year':
			return (
				start.year === end.year &&
				start.month === 1 &&
				start.day === 1 &&
				end.month === 12 &&
				end.day === 31
			);
		case 'range':
			return Date.parse(`${d.dateEnd}T00:00:00.000Z`) > Date.parse(`${d.dateStart}T00:00:00.000Z`);
	}
}

export function itemDateFrom(input: ItemDateInput): ItemDate {
	switch (input.precision) {
		case 'day': {
			if (!input.day || !isValidIsoDay(input.day))
				throw new Error('Day precision requires a valid day');
			return { dateStart: input.day, dateEnd: input.day, precision: 'day' };
		}
		case 'month': {
			if (!input.year || !input.month) throw new Error('Month precision requires year and month');
			const endDay = daysInMonth(input.year, input.month);
			return {
				dateStart: `${input.year}-${pad(input.month)}-01`,
				dateEnd: `${input.year}-${pad(input.month)}-${pad(endDay)}`,
				precision: 'month'
			};
		}
		case 'year': {
			if (!input.year) throw new Error('Year precision requires year');
			return {
				dateStart: `${input.year}-01-01`,
				dateEnd: `${input.year}-12-31`,
				precision: 'year'
			};
		}
		case 'range': {
			if (input.start || input.end) {
				if (
					!input.start ||
					!input.end ||
					!isValidIsoDay(input.start) ||
					!isValidIsoDay(input.end)
				) {
					throw new Error('Range precision requires valid start and end dates');
				}
				if (
					Date.parse(`${input.end}T00:00:00.000Z`) <= Date.parse(`${input.start}T00:00:00.000Z`)
				) {
					throw new Error('Range precision requires the end date after the start date');
				}
				return { dateStart: input.start, dateEnd: input.end, precision: 'range' };
			}
			if (!input.year || !input.yearEnd || input.yearEnd <= input.year) {
				throw new Error('Range precision requires increasing start and end years');
			}
			return {
				dateStart: `${input.year}-01-01`,
				dateEnd: `${input.yearEnd}-12-31`,
				precision: 'range'
			};
		}
		case 'unknown':
			return { dateStart: null, dateEnd: null, precision: 'unknown' };
	}
}

function parts(value: string): { year: number; month: number; day: number } | null {
	if (!ISO_DAY.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	return { year, month, day };
}

function displayRangePart(
	part: { year: number; month: number; day: number },
	side: 'start' | 'end'
): string {
	if (side === 'start') {
		if (part.month === 1 && part.day === 1) return String(part.year);
		if (part.day === 1) return `${MONTHS_LONG[part.month - 1]} ${part.year}`;
	} else {
		if (part.month === 12 && part.day === 31) return String(part.year);
		if (part.day === daysInMonth(part.year, part.month)) {
			return `${MONTHS_LONG[part.month - 1]} ${part.year}`;
		}
	}
	return `${MONTHS_LONG[part.month - 1]} ${part.day}, ${part.year}`;
}

function displayRange(
	start: { year: number; month: number; day: number },
	end: { year: number; month: number; day: number }
): string {
	if (start.year === end.year) {
		if (isWholeYear(start, end)) return `c. ${start.year}`;
		if (isMonthBoundary(start, 'start') && isMonthBoundary(end, 'end')) {
			if (start.month === end.month) return `c. ${MONTHS_LONG[start.month - 1]} ${start.year}`;
			return `c. ${MONTHS_LONG[start.month - 1]}–${MONTHS_LONG[end.month - 1]} ${start.year}`;
		}
		return `c. ${displaySameYearRangePart(start)}–${displaySameYearRangePart(end)}, ${start.year}`;
	}

	if (isYearStart(start) && isYearEnd(end)) return `c. ${start.year}–${end.year}`;
	return `c. ${displayRangePart(start, 'start')}–${displayRangePart(end, 'end')}`;
}

function shortRange(
	start: { year: number; month: number; day: number },
	end: { year: number; month: number; day: number }
): string {
	if (start.year === end.year) {
		if (isWholeYear(start, end)) return `c. ${start.year}`;
		if (isMonthBoundary(start, 'start') && isMonthBoundary(end, 'end')) {
			if (start.month === end.month) return `c. ${MONTHS_SHORT[start.month - 1]}`;
			return `c. ${MONTHS_SHORT[start.month - 1]}–${MONTHS_SHORT[end.month - 1]}`;
		}
		return `c. ${MONTHS_SHORT[start.month - 1]} ${start.day}–${MONTHS_SHORT[end.month - 1]} ${end.day}`;
	}

	const sameCentury = Math.floor(start.year / 100) === Math.floor(end.year / 100);
	const endYear = sameCentury ? String(end.year).slice(2) : String(end.year);
	return `c. ${start.year}–${endYear}`;
}

function isWholeYear(
	start: { year: number; month: number; day: number },
	end: { year: number; month: number; day: number }
): boolean {
	return isYearStart(start) && isYearEnd(end);
}

function isYearStart(part: { month: number; day: number }): boolean {
	return part.month === 1 && part.day === 1;
}

function isYearEnd(part: { month: number; day: number }): boolean {
	return part.month === 12 && part.day === 31;
}

function isMonthBoundary(
	part: { year: number; month: number; day: number },
	side: 'start' | 'end'
): boolean {
	if (side === 'start') return part.day === 1;
	return part.day === daysInMonth(part.year, part.month);
}

function displaySameYearRangePart(part: { month: number; day: number }): string {
	return `${MONTHS_LONG[part.month - 1]} ${part.day}`;
}

function isValidIsoDay(value: string): boolean {
	const parsed = parts(value);
	if (!parsed) return false;

	const candidate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
	return (
		candidate.getUTCFullYear() === parsed.year &&
		candidate.getUTCMonth() === parsed.month - 1 &&
		candidate.getUTCDate() === parsed.day
	);
}

function formatUtcDate(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}
