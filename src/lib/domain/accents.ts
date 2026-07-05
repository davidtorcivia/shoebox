import { ACCENTS } from '$lib/ui/tokens';

export function nextAccent(used: string[]): string {
	const counts = new Map<string, number>(ACCENTS.map((accent) => [accent.hex, 0]));
	for (const hex of used) {
		const count = counts.get(hex);
		if (count !== undefined) counts.set(hex, count + 1);
	}

	let best: string = ACCENTS[0].hex;
	let bestCount = Number.POSITIVE_INFINITY;
	for (const accent of ACCENTS) {
		const count = counts.get(accent.hex)!;
		if (count < bestCount) {
			best = accent.hex;
			bestCount = count;
		}
	}
	return best;
}
