import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CenturyRail from './CenturyRail.svelte';

describe('CenturyRail', () => {
	it('renders decade labels and active year ticks', () => {
		const { body } = render(CenturyRail, {
			props: {
				years: [
					{ year: 1993, count: 1, people: 1 },
					{ year: 1994, count: 4, people: 2 }
				],
				earliest: 1993,
				activeYear: 1994,
				now: 2026
			}
		});
		expect(body).toContain('Timeline years');
		expect(body).toContain("'90");
		expect(body).toContain('2000');
	});
});
