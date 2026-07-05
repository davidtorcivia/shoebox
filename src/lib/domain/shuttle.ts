export type Shuttle =
	| { mode: 'pause' }
	| { mode: 'forward'; rate: 1 | 2 }
	| { mode: 'reverse'; rate: 2 };

export const SHUTTLE_PAUSED: Shuttle = { mode: 'pause' };

export function shuttleNext(s: Shuttle, key: 'J' | 'K' | 'L'): Shuttle {
	if (key === 'K') return { mode: 'pause' };
	if (key === 'J') return { mode: 'reverse', rate: 2 };
	if (s.mode === 'forward') return { mode: 'forward', rate: 2 };
	return { mode: 'forward', rate: 1 };
}

export function togglePlay(s: Shuttle): Shuttle {
	return s.mode === 'pause' ? { mode: 'forward', rate: 1 } : { mode: 'pause' };
}

export const RATES = [0.5, 1, 1.5, 2] as const;

export function nextRate(rate: number): number {
	const index = (RATES as readonly number[]).indexOf(rate);
	return index === -1 ? 1 : RATES[(index + 1) % RATES.length];
}

