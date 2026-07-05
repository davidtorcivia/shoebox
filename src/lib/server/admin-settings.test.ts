import { beforeEach, describe, expect, it } from 'vitest';
import { HOLIDAYS } from '$lib/domain/holidays';
import { createTestDb } from './db/test-db';
import { settings } from './db/schema';
import { getSiteSettings, HOLIDAY_OPTIONS, updateSiteSettings } from './admin-settings';
import type { Db } from './db';

let db: Db;

beforeEach(() => {
	db = createTestDb();
});

describe('site settings', () => {
	it('returns defaults on a fresh db', async () => {
		const current = await getSiteSettings(db);
		expect(current.siteName).toBe('Shoebox');
		expect(current.holidaySet).toEqual(HOLIDAY_OPTIONS.map((holiday) => holiday.id));
		expect(HOLIDAY_OPTIONS).toEqual(HOLIDAYS.map(({ id, label }) => ({ id, label })));
	});

	it('persists partial updates', async () => {
		await updateSiteSettings(db, { siteName: 'The Torcivia Archive' });
		await updateSiteSettings(db, { holidaySet: ['christmas', 'halloween'] });
		const current = await getSiteSettings(db);
		expect(current.siteName).toBe('The Torcivia Archive');
		expect(current.holidaySet).toEqual(['christmas', 'halloween']);
	});

	it('rejects unknown holiday ids and blank names', async () => {
		await expect(updateSiteSettings(db, { holidaySet: ['festivus'] })).rejects.toThrow(
			'Unknown holiday id'
		);
		await expect(updateSiteSettings(db, { siteName: ' ' })).rejects.toThrow('siteName must be');
	});

	it('falls back when stored JSON is malformed', async () => {
		await db.insert(settings).values({ key: 'holidaySet', value: 'not json' });
		const current = await getSiteSettings(db);
		expect(current.holidaySet).toEqual(HOLIDAY_OPTIONS.map((holiday) => holiday.id));
	});
});
