function isoToUTC(iso: string): Date {
	return new Date(`${iso}T00:00:00Z`);
}

function toISO(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
	const date = isoToUTC(iso);
	return toISO(
		new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()))
	);
}

function addDays(iso: string, days: number): string {
	const date = isoToUTC(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return toISO(date);
}

export function ageAt(birthdate: string, onDate: string, deathDate?: string | null): number | null {
	if (onDate < birthdate) return null;
	if (deathDate && onDate > deathDate) return null;

	const birth = isoToUTC(birthdate);
	const on = isoToUTC(onDate);
	let age = on.getUTCFullYear() - birth.getUTCFullYear();
	const beforeBirthday =
		on.getUTCMonth() < birth.getUTCMonth() ||
		(on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate());
	if (beforeBirthday) age -= 1;
	return age;
}

export function dateWindowForAge(
	birthdate: string,
	age: { min: number; max: number }
): { start: string; end: string } {
	return {
		start: addYears(birthdate, age.min),
		end: addDays(addYears(birthdate, age.max + 1), -1)
	};
}
