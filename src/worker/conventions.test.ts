import { describe, expect, it } from 'vitest';
import { parseConventions, resolveItemDate, titleFromFilename } from './conventions';

describe('parseConventions', () => {
	const cases: [string, { year?: number; tags: string[]; filename: string }][] = [
		['1994/christmas/clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }],
		['clip.mp4', { tags: [], filename: 'clip.mp4' }],
		['1994/clip.mp4', { year: 1994, tags: [], filename: 'clip.mp4' }],
		[
			'christmas/Family Dinner/clip.mp4',
			{ tags: ['christmas', 'family-dinner'], filename: 'clip.mp4' }
		],
		[
			'1994/Christmas Morning/Tape 04/clip.mp4',
			{ year: 1994, tags: ['christmas-morning', 'tape-04'], filename: 'clip.mp4' }
		],
		['summer/1994/clip.mp4', { tags: ['summer', '1994'], filename: 'clip.mp4' }],
		['1994/1995/clip.mp4', { year: 1994, tags: ['1995'], filename: 'clip.mp4' }],
		['1850/photos/scan.jpg', { year: 1850, tags: ['photos'], filename: 'scan.jpg' }],
		['1799/scan.jpg', { tags: ['1799'], filename: 'scan.jpg' }],
		['2150/scan.jpg', { tags: ['2150'], filename: 'scan.jpg' }],
		['1994\\christmas\\clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }],
		['1994/christmas/christmas/clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }]
	];

	for (const [input, expected] of cases) {
		it(`parses ${input}`, () => {
			expect(parseConventions(input)).toEqual(expected);
		});
	}
});

describe('titleFromFilename', () => {
	it('strips the extension and turns dashes and underscores into spaces', () => {
		expect(titleFromFilename('christmas-morning_01.mp4')).toBe('christmas morning 01');
		expect(titleFromFilename('clip.mp4')).toBe('clip');
		expect(titleFromFilename('IMG 4021.JPG')).toBe('IMG 4021');
	});
});

describe('resolveItemDate', () => {
	it('prefers the media-embedded date at day precision', () => {
		expect(resolveItemDate('1994-12-25', 1990)).toEqual({
			dateStart: '1994-12-25',
			dateEnd: '1994-12-25',
			precision: 'day'
		});
	});

	it('falls back to the year hint at year precision', () => {
		expect(resolveItemDate(null, 1994)).toEqual({
			dateStart: '1994-01-01',
			dateEnd: '1994-12-31',
			precision: 'year'
		});
	});

	it('is unknown when neither exists', () => {
		expect(resolveItemDate(null)).toEqual({
			dateStart: null,
			dateEnd: null,
			precision: 'unknown'
		});
	});
});
