import { describe, expect, it } from 'vitest';
import {
	ACCENTS,
	CREAM,
	DAWN,
	DAWN_PALE,
	DECADES,
	GRAIN_URI,
	INK,
	accentOn,
	paletteFor,
	personRoomFor,
	playerRoomFor
} from './tokens';

describe('token constants', () => {
	it('anchors match the locked design system', () => {
		expect(INK).toBe('#171412');
		expect(CREAM).toBe('#FFF5E8');
		expect(DAWN).toBe('#FA7B62');
		expect(DAWN_PALE).toBe('#FFD9A8');
	});

	it('has 12 unique AA-paired accents', () => {
		expect(ACCENTS).toHaveLength(12);
		expect(new Set(ACCENTS.map((a) => a.hex)).size).toBe(12);
		for (const a of ACCENTS) expect(['ink', 'cream']).toContain(a.on);
	});

	it('decade palettes run 1900..2020 in order', () => {
		expect(DECADES.map((d) => d.decade)).toEqual([
			1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020
		]);
	});

	it('keeps decade chrome on light text', () => {
		expect(DECADES.every((decade) => decade.chromeOn === 'cream')).toBe(true);
	});

	it('grain is an inline SVG data URI', () => {
		expect(GRAIN_URI.startsWith('data:image/svg+xml,')).toBe(true);
		expect(GRAIN_URI).toContain('feTurbulence');
	});

	it('maps accent colors to their paired foreground token', () => {
		expect(accentOn('#FA7B62')).toBe(INK);
		expect(accentOn('#C3272B')).toBe(CREAM);
		expect(accentOn('#c3272b')).toBe(CREAM);
		expect(accentOn('#FFFFFF')).toBe(INK);
	});
});

describe('paletteFor', () => {
	it('maps a year to its decade palette', () => {
		expect(paletteFor(1994).decade).toBe(1990);
		expect(paletteFor(1990).decade).toBe(1990);
		expect(paletteFor(1999).decade).toBe(1990);
		expect(paletteFor(1955).decade).toBe(1950);
	});

	it('cycles 2030s-and-later through the curated set', () => {
		expect(paletteFor(2024).decade).toBe(2020);
		expect(paletteFor(2031).decade).toBe(1900);
		expect(paletteFor(2041).decade).toBe(1910);
	});

	it('cycles pre-1900 decades backwards through the set', () => {
		expect(paletteFor(1895)).toBe(DECADES[12]);
		expect(paletteFor(1885)).toBe(DECADES[11]);
		expect(paletteFor(1850)).toBe(DECADES[8]);
	});
});

describe('playerRoomFor', () => {
	it('collapses the 1990s palette to a deep-end room', () => {
		expect(playerRoomFor(1994)).toEqual({
			stops: ['#171412', '#8D496E', '#1D1A1D'],
			pool: '#3F837B66'
		});
	});

	it('always starts at iron black', () => {
		for (const y of [1946, 1961, 1987, 2005, 2023]) {
			expect(playerRoomFor(y).stops[0]).toBe(INK);
		}
	});
});

describe('personRoomFor', () => {
	it('derives dark and pale stops around the accent', () => {
		const room = personRoomFor('#FA7B62');
		expect(room.stops).toEqual(['#492b24', '#FA7B62', '#fdbeac']);
		expect(room.pools.length).toBeGreaterThan(0);
		for (const p of room.pools) {
			expect(p.color).toMatch(/^#[0-9a-fA-F]{8}$/);
			expect(p.pos.length).toBeGreaterThan(0);
			expect(p.size.length).toBeGreaterThan(0);
		}
	});

	it('keeps the accent as the middle stop', () => {
		expect(personRoomFor('#446179').stops[1]).toBe('#446179');
	});
});
