import { writable } from 'svelte/store';

/**
 * How many masonry columns the timeline uses on a desktop-width viewport.
 * A display preference, not an account preference: it belongs to the screen
 * you are sitting at, so it lives in localStorage rather than the database.
 * Narrow viewports keep their own responsive column counts regardless.
 */
const KEY = 'shoebox:desktop-columns';
export const MIN_COLUMNS = 3;
export const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = 4;

function initial(): number {
	if (typeof localStorage === 'undefined') return DEFAULT_COLUMNS;
	const stored = Number(localStorage.getItem(KEY));
	return Number.isInteger(stored) && stored >= MIN_COLUMNS && stored <= MAX_COLUMNS
		? stored
		: DEFAULT_COLUMNS;
}

export const desktopColumns = writable(initial());

if (typeof localStorage !== 'undefined') {
	desktopColumns.subscribe((value) => {
		try {
			localStorage.setItem(KEY, String(value));
		} catch {
			// Storage full or blocked: the preference simply resets next visit.
		}
	});
}
