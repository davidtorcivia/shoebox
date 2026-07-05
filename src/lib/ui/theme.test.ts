import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { comfortMode, reducedMotion, resolvedTheme, systemPrefersDark, themePref } from './theme';

describe('resolvedTheme', () => {
	beforeEach(() => {
		themePref.set('system');
		systemPrefersDark.set(true);
	});

	it('uses the high-contrast dark treatment when pref is system', () => {
		systemPrefersDark.set(true);
		expect(get(resolvedTheme)).toBe('dark');
		systemPrefersDark.set(false);
		expect(get(resolvedTheme)).toBe('dark');
	});

	it('keeps the high-contrast dark treatment for manual prefs', () => {
		systemPrefersDark.set(false);
		themePref.set('dark');
		expect(get(resolvedTheme)).toBe('dark');
		systemPrefersDark.set(true);
		themePref.set('light');
		expect(get(resolvedTheme)).toBe('dark');
	});
});

describe('comfort + reduced motion stores', () => {
	it('default to off', () => {
		expect(get(comfortMode)).toBe(false);
		expect(get(reducedMotion)).toBe(false);
	});
});
