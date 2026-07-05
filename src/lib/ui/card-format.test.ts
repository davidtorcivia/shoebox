import { describe, expect, it } from 'vitest';
import { captionRight, formatDuration, spriteStyle, thumbSrcset } from './card-format';
import type { ItemDTO } from '$lib/types';

const item: ItemDTO = {
	id: 'i1',
	type: 'video',
	title: 'Lake',
	description: null,
	date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
	displayDate: 'June 14, 1994',
	shortDate: 'Jun 14',
	duration: 62.4,
	width: 192,
	height: 108,
	status: 'ready',
	urls: {
		poster: '/poster.webp',
		thumb400: '/400.webp',
		thumb800: '/800.webp',
		thumb1600: '/1600.webp',
		sprite: '/sprite.webp'
	},
	blurhash: null,
	people: [{ id: 'p1', name: 'Dad', accentColor: '#FA7B62' }],
	tags: [{ id: 't1', name: 'summer', kind: 'topic' }],
	albums: [],
	uploadedBy: 'u1',
	tapeLabel: null
};

describe('formatDuration', () => {
	it('formats rounded mm:ss durations', () => {
		expect(formatDuration(62.4)).toBe('1:02');
		expect(formatDuration(4)).toBe('0:04');
		expect(formatDuration(null)).toBeNull();
	});
});

describe('thumbSrcset', () => {
	it('returns the three responsive widths', () => {
		expect(thumbSrcset(item)).toBe('/400.webp 400w, /800.webp 800w, /1600.webp 1600w');
	});
});

describe('captionRight', () => {
	it('prefers people, then tags, then title', () => {
		expect(captionRight(item)).toBe('Dad');
		expect(captionRight({ ...item, people: [] })).toBe('summer');
		expect(captionRight({ ...item, people: [], tags: [] })).toBe('Lake');
	});
});

describe('spriteStyle', () => {
	it('returns a background declaration for sprite frames', () => {
		expect(spriteStyle(item, 2)).toContain('/sprite.webp');
		expect(spriteStyle(item, 2)).toContain('-200%');
		expect(spriteStyle({ ...item, urls: { ...item.urls, sprite: undefined } })).toBe('');
	});
});

