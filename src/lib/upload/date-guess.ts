import {
	daysInMonth,
	itemDateFrom,
	MONTHS_LONG,
	MONTHS_SHORT,
	type ItemDate
} from '$lib/domain/dates';

const MIN_YEAR = 1900;
function maxYear(): number {
	return new Date().getFullYear() + 1;
}

// Full ISO-ish date: 1972-12-25, 1972_12_25, 1972.12.25
const ISO_IN_NAME = /(?:^|[^\d])(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/;
// Compact 8-digit date: 19721225
const COMPACT_IN_NAME = /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/;
// Numeric year-then-month: 1972-12 / 1972.12 (but not a full 1972-12-25).
const YEAR_MONTH = /(?:^|[^\d])(19\d{2}|20\d{2})[-_.](0[1-9]|1[0-2])(?![-_.]?\d)/;
// A bare four-digit year, not glued to other digits or an 'x' (so "1920x1080"
// and sequence numbers like "00123456" don't read as years).
const YEAR_ONLY = /(?<![\dx])(19\d{2}|20\d{2})(?![\dx])/gi;

const MONTH_ALT = [...MONTHS_LONG, ...MONTHS_SHORT].join('|');
const MONTH_INDEX = new Map<string, number>();
for (let i = 0; i < MONTHS_LONG.length; i++) {
	MONTH_INDEX.set(MONTHS_LONG[i].toLowerCase(), i + 1);
	MONTH_INDEX.set(MONTHS_SHORT[i].toLowerCase(), i + 1);
}
// "July 1978", "Jul 1978", "Dec. 1972"
const MONTH_YEAR = new RegExp(`\\b(${MONTH_ALT})\\.?[\\s._-]+(19\\d{2}|20\\d{2})\\b`, 'i');
// "1978 July"
const YEAR_MONTH_NAME = new RegExp(`\\b(19\\d{2}|20\\d{2})[\\s._-]+(${MONTH_ALT})\\b`, 'i');

/**
 * Best-effort date from a file's title/name. Old family-film scans usually carry
 * the real date in the name ("Christmas 1972", "July 1978", "1963-07-04"), so
 * this parses, most-specific first: a full day, then year-month, then a month
 * name with a year, then a bare year — returning the matching precision.
 */
export function dateFromTitle(name: string): ItemDate | null {
	const base = stripExtension(name);
	return fullDate(base) ?? yearMonthNumeric(base) ?? monthNameYear(base) ?? yearOnly(base);
}

export function guessDateFromFile(file: File): ItemDate | null {
	return dateFromTitle(file.name) ?? dateFromModified(file);
}

function fullDate(base: string): ItemDate | null {
	const match = base.match(ISO_IN_NAME) ?? base.match(COMPACT_IN_NAME);
	if (!match) return null;
	return dayDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function yearMonthNumeric(base: string): ItemDate | null {
	const match = base.match(YEAR_MONTH);
	if (!match) return null;
	return monthDate(Number(match[1]), Number(match[2]));
}

function monthNameYear(base: string): ItemDate | null {
	const match = base.match(MONTH_YEAR) ?? base.match(YEAR_MONTH_NAME);
	if (!match) return null;
	const yearFirst = /^\d/.test(match[1]);
	const month = MONTH_INDEX.get((yearFirst ? match[2] : match[1]).toLowerCase());
	if (!month) return null;
	return monthDate(Number(yearFirst ? match[1] : match[2]), month);
}

function yearOnly(base: string): ItemDate | null {
	const matches = base.match(YEAR_ONLY);
	if (!matches) return null;
	for (const raw of matches) {
		const year = Number(raw);
		if (year >= MIN_YEAR && year <= maxYear()) {
			try {
				return itemDateFrom({ precision: 'year', year });
			} catch {
				/* keep scanning */
			}
		}
	}
	return null;
}

function dateFromModified(file: File): ItemDate | null {
	if (!Number.isFinite(file.lastModified) || file.lastModified <= 0) return null;
	const modified = new Date(file.lastModified);
	const now = Date.now();
	if (
		modified.getFullYear() >= MIN_YEAR &&
		modified.getFullYear() <= new Date(now).getFullYear() + 1 &&
		Math.abs(now - modified.getTime()) > 60_000
	) {
		return dayDate(modified.getFullYear(), modified.getMonth() + 1, modified.getDate());
	}
	return null;
}

function dayDate(year: number, month: number, day: number): ItemDate | null {
	if (year < MIN_YEAR || year > maxYear() || month < 1 || month > 12) return null;
	try {
		if (day < 1 || day > daysInMonth(year, month)) return null;
		return itemDateFrom({ precision: 'day', day: `${year}-${pad(month)}-${pad(day)}` });
	} catch {
		return null;
	}
}

function monthDate(year: number, month: number): ItemDate | null {
	if (year < MIN_YEAR || year > maxYear() || month < 1 || month > 12) return null;
	try {
		return itemDateFrom({ precision: 'month', year, month });
	} catch {
		return null;
	}
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

// Strip a real file extension (starts with a letter, e.g. ".mp4") but never a
// trailing number like ".1972" that is actually part of the date.
function stripExtension(name: string): string {
	return name.replace(/\.[a-z][a-z0-9]{0,4}$/i, '');
}
