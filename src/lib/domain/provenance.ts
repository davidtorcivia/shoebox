import type { ItemDate } from './dates';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayOf(d: ItemDate): string | null {
	if (d.precision !== 'day' || !d.dateStart) return null;
	const date = new Date(`${d.dateStart}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return null;
	return WEEKDAYS[date.getUTCDay()];
}

export function eyebrowFor(
	d: ItemDate,
	source: 'upload' | 'ingest',
	tapeLabel: string | null
): string {
	const parts = [weekdayOf(d), source === 'ingest' ? 'Ingest' : 'Upload', tapeLabel].filter(
		(value): value is string => Boolean(value)
	);
	return parts.join(' · ');
}

