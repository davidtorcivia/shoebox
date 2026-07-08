import { describe, expect, it } from 'vitest';
import { dateFromTitle, guessDateFromFile } from './date-guess';

describe('dateFromTitle', () => {
	it('reads a full ISO date at day precision', () => {
		expect(dateFromTitle('1963-07-04 fireworks.mp4')).toEqual({
			dateStart: '1963-07-04',
			dateEnd: '1963-07-04',
			precision: 'day'
		});
	});

	it('reads a compact YYYYMMDD date', () => {
		expect(dateFromTitle('VID_19721225_family.mov')).toMatchObject({
			dateStart: '1972-12-25',
			precision: 'day'
		});
	});

	it('reads a numeric year-month at month precision', () => {
		expect(dateFromTitle('reunion-1972-07.mp4')).toEqual({
			dateStart: '1972-07-01',
			dateEnd: '1972-07-31',
			precision: 'month'
		});
	});

	it('reads a month name with a year at month precision', () => {
		expect(dateFromTitle('July 1978 cookout.mov')).toMatchObject({
			dateStart: '1978-07-01',
			dateEnd: '1978-07-31',
			precision: 'month'
		});
		expect(dateFromTitle('Dec. 1972 - grandma.mp4')).toMatchObject({ precision: 'month' });
		expect(dateFromTitle('1978 August trip.mp4')).toMatchObject({
			dateStart: '1978-08-01',
			precision: 'month'
		});
	});

	it('reads a bare year at year precision (the common film-scan case)', () => {
		expect(dateFromTitle('Christmas 1972.mp4')).toEqual({
			dateStart: '1972-01-01',
			dateEnd: '1972-12-31',
			precision: 'year'
		});
		expect(dateFromTitle('1963 family reunion.mov')).toMatchObject({ precision: 'year' });
	});

	it('ignores resolutions and non-date numbers', () => {
		expect(dateFromTitle('home_movie_1920x1080.mp4')).toBeNull();
		expect(dateFromTitle('clip_1080p.mp4')).toBeNull();
		expect(dateFromTitle('IMG_00123456.mov')).toBeNull();
		expect(dateFromTitle('no date here.mp4')).toBeNull();
	});

	it('does not mistake a numeric extension for a stripped date', () => {
		expect(dateFromTitle('reel 1975')).toMatchObject({ precision: 'year' });
	});

	it('prefers the more specific match when several are present', () => {
		expect(dateFromTitle('1972-12-25 (scanned 2024).mp4')).toMatchObject({
			dateStart: '1972-12-25',
			precision: 'day'
		});
	});
});

describe('guessDateFromFile', () => {
	const fileWith = (name: string, lastModified: number): File => ({ name, lastModified }) as File;

	it('uses the title before the file mtime', () => {
		const f = fileWith('Summer 1985.mp4', Date.UTC(2024, 0, 1));
		expect(guessDateFromFile(f)).toMatchObject({ precision: 'year', dateStart: '1985-01-01' });
	});

	it('falls back to a plausible mtime when the title has no date', () => {
		const f = fileWith('holiday.jpg', new Date(2001, 5, 15, 12).getTime());
		expect(guessDateFromFile(f)).toMatchObject({ dateStart: '2001-06-15', precision: 'day' });
	});
});
