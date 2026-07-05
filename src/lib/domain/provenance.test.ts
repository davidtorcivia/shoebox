import { describe, expect, it } from 'vitest';
import type { ItemDate } from './dates';
import { eyebrowFor, weekdayOf } from './provenance';

const day = (iso: string): ItemDate => ({ dateStart: iso, dateEnd: iso, precision: 'day' });

describe('weekdayOf', () => {
	it('June 14, 1994 is a Tuesday', () => {
		expect(weekdayOf(day('1994-06-14'))).toBe('Tuesday');
	});

	it('returns null for non-day precision and unknown dates', () => {
		expect(
			weekdayOf({ dateStart: '1994-06-01', dateEnd: '1994-06-30', precision: 'month' })
		).toBeNull();
		expect(weekdayOf({ dateStart: null, dateEnd: null, precision: 'unknown' })).toBeNull();
	});
});

describe('eyebrowFor', () => {
	it('renders full provenance', () => {
		expect(eyebrowFor(day('1994-06-14'), 'ingest', 'Tape 04')).toBe(
			'Tuesday · Ingest · Tape 04'
		);
	});

	it('drops empty segments', () => {
		expect(
			eyebrowFor(
				{ dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
				'upload',
				null
			)
		).toBe('Upload');
		expect(eyebrowFor(day('1994-06-14'), 'upload', null)).toBe('Tuesday · Upload');
	});
});

