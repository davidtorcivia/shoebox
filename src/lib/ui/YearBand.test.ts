import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import YearBand from './YearBand.svelte';

describe('YearBand', () => {
	it('renders active year, neighboring years, and counts', () => {
		const { body } = render(YearBand, {
			props: {
				activeYear: 1994,
				years: [{ year: 1994, count: 214, people: 12 }]
			}
		});
		expect(body).toContain('1994');
		expect(body).toContain('1993');
		expect(body).toContain('214 moments · 12 people');
	});
});

