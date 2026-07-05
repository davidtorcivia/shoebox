export interface HolidayDef {
	id: string;
	label: string;
}

export const HOLIDAYS: HolidayDef[] = [
	{ id: 'new-years-day', label: "New Year's Day" },
	{ id: 'valentines', label: "Valentine's Day" },
	{ id: 'st-patricks', label: "St. Patrick's Day" },
	{ id: 'easter', label: 'Easter' },
	{ id: 'mothers-day', label: "Mother's Day" },
	{ id: 'memorial-day', label: 'Memorial Day' },
	{ id: 'fathers-day', label: "Father's Day" },
	{ id: 'july-4th', label: 'July 4th' },
	{ id: 'labor-day', label: 'Labor Day' },
	{ id: 'halloween', label: 'Halloween' },
	{ id: 'veterans-day', label: 'Veterans Day' },
	{ id: 'thanksgiving', label: 'Thanksgiving' },
	{ id: 'christmas-eve', label: 'Christmas Eve' },
	{ id: 'christmas', label: 'Christmas' },
	{ id: 'new-years-eve', label: "New Year's Eve" }
];

const FIXED: Record<string, string> = {
	'01-01': 'new-years-day',
	'02-14': 'valentines',
	'03-17': 'st-patricks',
	'07-04': 'july-4th',
	'10-31': 'halloween',
	'11-11': 'veterans-day',
	'12-24': 'christmas-eve',
	'12-25': 'christmas',
	'12-31': 'new-years-eve'
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function dow(y: number, m: number, d: number): number {
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nthWeekday(y: number, m: number, weekday: number, n: number): number {
	const offset = (weekday - dow(y, m, 1) + 7) % 7;
	return 1 + offset + (n - 1) * 7;
}

function lastWeekday(y: number, m: number, weekday: number): number {
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return daysInMonth - ((dow(y, m, daysInMonth) - weekday + 7) % 7);
}

export function easterDate(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return iso(year, month, day);
}

export function holidaysFor(isoDate: string): string[] {
	const match = ISO_RE.exec(isoDate);
	if (!match) return [];
	const y = Number(match[1]);
	const mo = Number(match[2]);
	const d = Number(match[3]);
	if (
		!Number.isInteger(y) ||
		mo < 1 ||
		mo > 12 ||
		d < 1 ||
		d > new Date(Date.UTC(y, mo, 0)).getUTCDate()
	) {
		return [];
	}
	const out: string[] = [];
	const fixed = FIXED[`${match[2]}-${match[3]}`];
	if (fixed) out.push(fixed);
	if (mo === 11 && d === nthWeekday(y, 11, 4, 4)) out.push('thanksgiving');
	if (mo === 5 && d === nthWeekday(y, 5, 0, 2)) out.push('mothers-day');
	if (mo === 6 && d === nthWeekday(y, 6, 0, 3)) out.push('fathers-day');
	if (mo === 9 && d === nthWeekday(y, 9, 1, 1)) out.push('labor-day');
	if (mo === 5 && d === lastWeekday(y, 5, 1)) out.push('memorial-day');
	if (isoDate === easterDate(y)) out.push('easter');
	return out;
}
