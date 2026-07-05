import { describe, expect, it } from 'vitest';
import {
	ACCENTS,
	CREAM,
	DAWN,
	DECADES,
	GRAIN_URI,
	INK,
	paletteFor,
	personRoomFor,
	playerRoomFor
} from './tokens';

describe('token constants', () => {
	it('anchors match the locked design system', () => {
		expect(INK).toBe('#171412');
		expect(CREAM).toBe('#FFF5E8');
		expect(DAWN).toBe('#FA7B62');
	});

	it('has 12 unique AA-paired accents', () => {
		expect(ACCENTS).toHaveLength(12);
		expect(new Set(ACCENTS.map((a) => a.hex)).size).toBe(12);
		for (const a of ACCENTS) expect(['ink', 'cream']).toContain(a.on);
	});

	it('decade palettes run 1940..2020 in order', () => {
		expect(DECADES.map((d) => d.decade)).toEqual([
			1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020
		]);
	});

	it('grain is an inline SVG data URI', () => {
		expect(GRAIN_URI.startsWith('data:image/svg+xml,')).toBe(true);
		expect(GRAIN_URI).toContain('feTurbulence');
	});
});

describe('paletteFor', () => {
	it('maps a year to its decade palette', () => {
		expect(paletteFor(1994).decade).toBe(1990);
		expect(paletteFor(1990).decade).toBe(1990);
		expect(paletteFor(1999).decade).toBe(1990);
		expect(paletteFor(1955).decade).toBe(1950);
	});

	it('clamps 2020s-and-later to the 2020 palette', () => {
		expect(paletteFor(2024).decade).toBe(2020);
		expect(paletteFor(2031).decade).toBe(2020);
	});

	it('cycles pre-1940 decades backwards through the set', () => {
		expect(paletteFor(1935)).toBe(DECADES[8]);
		expect(paletteFor(1925)).toBe(DECADES[7]);
		expect(paletteFor(1901)).toBe(DECADES[5]);
		expect(paletteFor(1850)).toBe(DECADES[0]);
	});
});

describe('playerRoomFor', () => {
	it('collapses the 1990s palette to the locked deep-end room', () => {
		expect(playerRoomFor(1994)).toEqual({
			stops: ['#171412', '#9D2B22', '#F35336'],
			pool: '#FA7B6266'
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
