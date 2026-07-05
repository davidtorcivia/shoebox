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

export function holidaysFor(isoDate: string): string[] {
	const match = ISO_RE.exec(isoDate);
	if (!match) return [];
	const fixed = FIXED[`${match[2]}-${match[3]}`];
	return fixed ? [fixed] : [];
}
