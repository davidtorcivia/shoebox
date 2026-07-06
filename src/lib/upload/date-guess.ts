import { itemDateFrom, type ItemDate } from '$lib/domain/dates';

const ISO_IN_NAME = /(?:^|[^\d])(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/;
const COMPACT_IN_NAME = /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/;

export function guessDateFromFile(file: File): ItemDate | null {
	const nameDate = dateFromName(file.name);
	if (nameDate) return nameDate;

	if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
		const modified = new Date(file.lastModified);
		const now = Date.now();
		if (
			modified.getFullYear() >= 1900 &&
			modified.getFullYear() <= new Date(now).getFullYear() + 1 &&
			Math.abs(now - modified.getTime()) > 60_000
		) {
			return dateFromParts(modified.getFullYear(), modified.getMonth() + 1, modified.getDate());
		}
	}

	return null;
}

function dateFromName(name: string): ItemDate | null {
	const match = name.match(ISO_IN_NAME) ?? name.match(COMPACT_IN_NAME);
	if (!match) return null;
	return dateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function dateFromParts(year: number, month: number, day: number): ItemDate | null {
	try {
		return itemDateFrom({
			precision: 'day',
			day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
		});
	} catch {
		return null;
	}
}
