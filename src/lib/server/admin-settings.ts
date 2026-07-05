import { HOLIDAYS } from '$lib/domain/holidays';
import { eq } from 'drizzle-orm';
import { settings } from './db/schema';
import type { Db } from './db';

export const HOLIDAY_OPTIONS = HOLIDAYS.map(({ id, label }) => ({ id, label }));

export interface SiteSettings {
	siteName: string;
	holidaySet: string[];
}

const DEFAULTS: SiteSettings = {
	siteName: 'Shoebox',
	holidaySet: HOLIDAY_OPTIONS.map((holiday) => holiday.id)
};

async function readKey<T>(db: Db, key: string): Promise<T | undefined> {
	const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
	if (!rows[0]) return undefined;
	try {
		return JSON.parse(rows[0].value) as T;
	} catch {
		return undefined;
	}
}

async function writeKey(db: Db, key: string, value: unknown): Promise<void> {
	const encoded = JSON.stringify(value);
	await db
		.insert(settings)
		.values({ key, value: encoded })
		.onConflictDoUpdate({ target: settings.key, set: { value: encoded } });
}

function normalizeHolidaySet(value: unknown): string[] {
	const known = new Set(HOLIDAY_OPTIONS.map((holiday) => holiday.id));
	if (!Array.isArray(value)) return DEFAULTS.holidaySet;
	return value.filter((id): id is string => typeof id === 'string' && known.has(id));
}

export async function getSiteSettings(db: Db): Promise<SiteSettings> {
	const siteName = await readKey<unknown>(db, 'siteName');
	const holidaySet = await readKey<unknown>(db, 'holidaySet');
	return {
		siteName: typeof siteName === 'string' && siteName.trim() ? siteName.trim() : DEFAULTS.siteName,
		holidaySet: normalizeHolidaySet(holidaySet)
	};
}

export async function updateSiteSettings(
	db: Db,
	patch: Partial<SiteSettings>
): Promise<SiteSettings> {
	if (patch.siteName !== undefined) {
		const siteName = patch.siteName.trim();
		if (siteName.length === 0 || siteName.length > 80) {
			throw new Error('siteName must be 1-80 characters');
		}
		await writeKey(db, 'siteName', siteName);
	}

	if (patch.holidaySet !== undefined) {
		const known = new Set(HOLIDAY_OPTIONS.map((holiday) => holiday.id));
		for (const id of patch.holidaySet) {
			if (!known.has(id)) throw new Error(`Unknown holiday id: ${id}`);
		}
		await writeKey(db, 'holidaySet', patch.holidaySet);
	}

	return getSiteSettings(db);
}
