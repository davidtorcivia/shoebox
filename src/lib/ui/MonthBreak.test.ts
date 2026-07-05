import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MonthBreak from './MonthBreak.svelte';

describe('MonthBreak', () => {
	it('renders the eyebrow and large month label', () => {
		const { body } = render(MonthBreak, { props: { label: 'June 1994' } });
		expect(body).toContain('June 1994');
		expect(body).toContain('JUNE');
	});
});
