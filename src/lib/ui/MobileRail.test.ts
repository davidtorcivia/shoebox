import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MobileRail from './MobileRail.svelte';

describe('MobileRail', () => {
	it('renders active year thumb and labels', () => {
		const { body } = render(MobileRail, {
			props: {
				years: [{ year: 1994, count: 4, people: 2 }],
				earliest: 1994,
				activeYear: 1994,
				now: 2026
			}
		});
		expect(body).toContain('Mobile timeline rail');
		expect(body).toContain('1994');
		expect(body).toContain("'90");
	});
});
