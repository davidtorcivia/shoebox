/**
 * Coarse times of day for items whose exact clock time is unknowable (scanned
 * tapes, undated prints). Each period maps to a representative timestamp so it
 * slots into the same capture_time ordering as exact times; the edit form maps
 * the representative time back to the period label for display.
 */
export const DAY_PERIODS = [
	{ id: 'morning', label: 'Morning', time: '09:00:00' },
	{ id: 'midday', label: 'Midday', time: '12:00:00' },
	{ id: 'afternoon', label: 'Afternoon', time: '15:00:00' },
	{ id: 'evening', label: 'Evening', time: '19:00:00' },
	{ id: 'night', label: 'Night', time: '22:00:00' }
] as const;

export type DayPeriodId = (typeof DAY_PERIODS)[number]['id'];

export function periodTime(id: string): string | null {
	return DAY_PERIODS.find((period) => period.id === id)?.time ?? null;
}

/** The period whose representative time matches `time` ("HH:MM:SS"), if any. */
export function periodForTime(time: string): DayPeriodId | null {
	return DAY_PERIODS.find((period) => period.time === time)?.id ?? null;
}
