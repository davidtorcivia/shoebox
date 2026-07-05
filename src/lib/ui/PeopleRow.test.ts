import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PeopleRow from './PeopleRow.svelte';
import type { ItemDTO } from '$lib/dto';

const people: ItemDTO['people'] = [
	{ id: 'p1', name: 'Marta', accentColor: '#FA7B62', age: 38 },
	{ id: 'p2', name: 'Eric', accentColor: '#C3272B' }
];

describe('PeopleRow', () => {
	it('renders the fixed label, names, and age text', () => {
		const { body } = render(PeopleRow, { props: { people } });
		expect(body).toContain('People');
		expect(body).toContain('Marta');
		expect(body).toContain('Eric');
		expect(body).toContain('age 38');
		expect(body).toContain('/people?person=p1');
	});

	it('does not emit italic, radius, or media-border styling', () => {
		const { body } = render(PeopleRow, { props: { people } });
		expect(body).not.toContain('font-style: italic');
		expect(body).not.toContain('border-radius');
		expect(body).not.toContain('media-border');
	});
});
