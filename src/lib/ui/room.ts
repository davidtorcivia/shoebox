import type { DecadePalette } from '$lib/ui/tokens';

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const value = hex.replace('#', '');
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16)
	};
}

export function alpha(hex: string, opacity: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function chromeVars(palette: DecadePalette): Record<string, string> {
	const chrome = palette.chromeOn === 'cream' ? '#FFF5E8' : '#171412';
	const muted = palette.chromeOn === 'cream' ? alpha('#FFF5E8', 0.72) : alpha('#171412', 0.68);
	return {
		'--timeline-chrome': chrome,
		'--timeline-muted': muted,
		'--timeline-soft': alpha(chrome, 0.16),
		'--timeline-strong': alpha(chrome, 0.9)
	};
}
