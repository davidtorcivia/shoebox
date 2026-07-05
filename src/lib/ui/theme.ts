import { derived, writable, type Readable, type Writable } from 'svelte/store';

export type ThemePref = 'system' | 'dark' | 'light';

export const themePref: Writable<ThemePref> = writable('system');
export const systemPrefersDark: Writable<boolean> = writable(true);
export const comfortMode: Writable<boolean> = writable(false);
export const reducedMotion: Writable<boolean> = writable(false);

export const resolvedTheme: Readable<'dark' | 'light'> = derived(
	[themePref, systemPrefersDark],
	([pref, sysDark]) => (pref === 'system' ? (sysDark ? 'dark' : 'light') : pref)
);

export function initTheme(
	user: { theme: ThemePref; comfortMode: boolean } | null | undefined
): () => void {
	if (user) {
		themePref.set(user.theme);
		comfortMode.set(user.comfortMode);
	}

	const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
	const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
	systemPrefersDark.set(darkMq.matches);
	reducedMotion.set(motionMq.matches);

	const onDark = (event: MediaQueryListEvent) => systemPrefersDark.set(event.matches);
	const onMotion = (event: MediaQueryListEvent) => reducedMotion.set(event.matches);
	darkMq.addEventListener('change', onDark);
	motionMq.addEventListener('change', onMotion);

	const unsubTheme = resolvedTheme.subscribe((theme) => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		document.documentElement.classList.toggle('light', theme === 'light');
	});
	const unsubComfort = comfortMode.subscribe((comfort) => {
		document.documentElement.classList.toggle('comfort', comfort);
	});

	return () => {
		darkMq.removeEventListener('change', onDark);
		motionMq.removeEventListener('change', onMotion);
		unsubTheme();
		unsubComfort();
	};
}
