import { describe, expect, it } from 'vitest';
import { parseOmnibox, serializeQuery } from './search-query';

describe('parseOmnibox basics', () => {
	it('parses empty input', () => {
		expect(parseOmnibox('')).toEqual({ text: '', people: [], tags: [], warnings: [] });
	});

	it('keeps plain words as text', () => {
		expect(parseOmnibox('lake watermelon').text).toBe('lake watermelon');
	});

	it('preserves quoted phrases in text', () => {
		expect(parseOmnibox('"birthday party" lake').text).toBe('"birthday party" lake');
	});

	it('keeps unknown key:value tokens as text', () => {
		expect(parseOmnibox('re:union').text).toBe('re:union');
	});
});

describe('parseOmnibox person filters', () => {
	it('parses a single person', () => {
		expect(parseOmnibox('person:Mom').people).toEqual(['Mom']);
	});

	it('parses a quoted person', () => {
		expect(parseOmnibox('person:"Grandpa Joe"').people).toEqual(['Grandpa Joe']);
	});

	it('keeps repeat people as an AND list', () => {
		expect(parseOmnibox('person:Mom person:"Grandpa Joe"').people).toEqual(['Mom', 'Grandpa Joe']);
	});

	it('matches keys case-insensitively while preserving value case', () => {
		expect(parseOmnibox('PERSON:Mom').people).toEqual(['Mom']);
	});

	it('dedupes people case-insensitively with first spelling kept', () => {
		expect(parseOmnibox('person:mom person:Mom').people).toEqual(['mom']);
	});
});

describe('parseOmnibox tag, type, album, and uploader filters', () => {
	it('lowercases and dedupes tags', () => {
		expect(parseOmnibox('tag:Christmas tag:christmas tag:lake').tags).toEqual(['christmas', 'lake']);
	});

	it('parses type video', () => {
		expect(parseOmnibox('type:video').type).toBe('video');
	});

	it('parses type photo case-insensitively', () => {
		expect(parseOmnibox('type:PHOTO').type).toBe('photo');
	});

	it('warns and drops invalid type values', () => {
		const q = parseOmnibox('type:gif');
		expect(q.type).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});

	it('warns on conflicting duplicate type values and keeps the first', () => {
		const q = parseOmnibox('type:video type:photo');
		expect(q.type).toBe('video');
		expect(q.warnings).toHaveLength(1);
	});

	it('parses a quoted album', () => {
		expect(parseOmnibox('album:"Summer 94"').album).toBe('Summer 94');
	});

	it('warns on duplicate album values and keeps the first', () => {
		const q = parseOmnibox('album:A album:B');
		expect(q.album).toBe('A');
		expect(q.warnings).toHaveLength(1);
	});

	it('parses uploader', () => {
		expect(parseOmnibox('uploader:david').uploader).toBe('david');
	});
});

describe('parseOmnibox year filters', () => {
	it('parses a year range', () => {
		const q = parseOmnibox('1988..1999');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
	});

	it('parses a bare year as a single-year range', () => {
		const q = parseOmnibox('1994');
		expect(q.yearFrom).toBe(1994);
		expect(q.yearTo).toBe(1994);
	});

	it('swaps inverted ranges', () => {
		const q = parseOmnibox('1999..1988');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
	});

	it('warns and drops a second year token', () => {
		const q = parseOmnibox('1994 1996');
		expect(q.yearFrom).toBe(1994);
		expect(q.yearTo).toBe(1994);
		expect(q.warnings).toHaveLength(1);
	});

	it('keeps implausible four-digit numbers as text', () => {
		const q = parseOmnibox('0042');
		expect(q.yearFrom).toBeUndefined();
		expect(q.text).toBe('0042');
	});

	it('keeps malformed ranges as text', () => {
		expect(parseOmnibox('1988..99').text).toBe('1988..99');
	});
});

describe('parseOmnibox age filters', () => {
	it('parses an age range with exactly one person', () => {
		expect(parseOmnibox('person:Mom age:5-7').age).toEqual({ person: 'Mom', min: 5, max: 7 });
	});

	it('parses a single age as min and max', () => {
		expect(parseOmnibox('person:Mom age:5').age).toEqual({ person: 'Mom', min: 5, max: 5 });
	});

	it('swaps inverted age ranges', () => {
		expect(parseOmnibox('person:Mom age:7-5').age).toEqual({ person: 'Mom', min: 5, max: 7 });
	});

	it('warns and drops age with zero people', () => {
		const q = parseOmnibox('age:5-7');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});

	it('warns and drops age with two people', () => {
		const q = parseOmnibox('person:Mom person:Dad age:5-7');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});

	it('warns and drops malformed age', () => {
		const q = parseOmnibox('person:Mom age:abc');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});

	it('warns on duplicate age tokens and keeps the first', () => {
		const q = parseOmnibox('person:Mom age:5 age:9');
		expect(q.age).toEqual({ person: 'Mom', min: 5, max: 5 });
		expect(q.warnings).toHaveLength(1);
	});
});

describe('parseOmnibox kitchen sink', () => {
	it('parses the master query shape', () => {
		const q = parseOmnibox(
			'person:Mom age:5-7 tag:christmas type:video 1988..1999 lake "birthday party"'
		);
		expect(q.people).toEqual(['Mom']);
		expect(q.age).toEqual({ person: 'Mom', min: 5, max: 7 });
		expect(q.tags).toEqual(['christmas']);
		expect(q.type).toBe('video');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
		expect(q.text).toBe('lake "birthday party"');
		expect(q.warnings).toEqual([]);
	});
});

describe('serializeQuery', () => {
	it('round-trips the kitchen sink in canonical order', () => {
		const input = 'person:Mom age:5-7 tag:christmas type:video 1988..1999 lake "birthday party"';
		const q = parseOmnibox(input);
		const serialized = serializeQuery(q);
		expect(parseOmnibox(serialized)).toEqual(q);
	});

	it('quotes multi-word values', () => {
		expect(serializeQuery({ text: '', people: ['Grandpa Joe'], tags: [] })).toBe('person:"Grandpa Joe"');
	});

	it('serializes a single year bare', () => {
		expect(serializeQuery({ text: '', people: [], tags: [], yearFrom: 1994, yearTo: 1994 })).toBe(
			'1994'
		);
	});
});
