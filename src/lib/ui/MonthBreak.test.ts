import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MonthBreak from './MonthBreak.svelte';

describe('MonthBreak', () => {
	it('renders the large month label without the redundant year eyebrow', () => {
		const { body } = render(MonthBreak, { props: { label: 'June 1994' } });
		expect(body).toContain('JUNE');
		// The month + year are already established by the timeline chrome, so the
		// eyebrow is intentionally gone.
		expect(body).not.toContain('June 1994');
	});
});
