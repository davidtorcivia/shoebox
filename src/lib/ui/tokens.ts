export const INK = '#171412';
export const CREAM = '#FFF5E8';
export const DAWN = '#FA7B62';

export const ACCENTS = [
	{ hex: '#FA7B62', on: 'ink' },
	{ hex: '#FFD9A8', on: 'ink' },
	{ hex: '#A8D8EA', on: 'ink' },
	{ hex: '#FFD700', on: 'ink' },
	{ hex: '#C3272B', on: 'cream' },
	{ hex: '#6B6E23', on: 'cream' },
	{ hex: '#446179', on: 'cream' },
	{ hex: '#D3826E', on: 'ink' },
	{ hex: '#FFB11B', on: 'ink' },
	{ hex: '#A8B8C4', on: 'ink' },
	{ hex: '#5E6F4D', on: 'cream' },
	{ hex: '#B8B0A8', on: 'ink' }
] as const;

export type DecadePalette = {
	decade: number;
	stops: [string, string, string];
	pools: { color: string; pos: string; size: string }[];
	chromeOn: 'ink' | 'cream';
};

export const DECADES: DecadePalette[] = [
	{
		decade: 1940,
		stops: ['#585850', '#A88868', '#C9B99F'],
		pools: [{ color: '#51515166', pos: '10% -10%', size: '80% 60%' }],
		chromeOn: 'ink'
	},
	{
		decade: 1950,
		stops: ['#A8D8EA', '#CFE3D8', '#F7E1A0'],
		pools: [{ color: '#F7E1A099', pos: '70% 40%', size: '70% 55%' }],
		chromeOn: 'ink'
	},
	{
		decade: 1960,
		stops: ['#FFD700', '#C9C25A', '#446179'],
		pools: [{ color: '#44617955', pos: '85% 5%', size: '70% 50%' }],
		chromeOn: 'ink'
	},
	{
		decade: 1970,
		stops: ['#FFB11B', '#D8D0C0', '#FFF1CF'],
		pools: [{ color: '#D3826E55', pos: '0% 80%', size: '60% 50%' }],
		chromeOn: 'ink'
	},
	{
		decade: 1980,
		stops: ['#0C0C0C', '#1F3A8A', '#AB5C57'],
		pools: [{ color: '#1F3A8A88', pos: '75% 15%', size: '80% 60%' }],
		chromeOn: 'cream'
	},
	{
		decade: 1990,
		stops: ['#F35336', '#FA7B62', '#FFD9A8'],
		pools: [
			{ color: '#9D2B22AA', pos: '8% -10%', size: '90% 70%' },
			{ color: '#FFD9A899', pos: '108% 38%', size: '70% 55%' }
		],
		chromeOn: 'ink'
	},
	{
		decade: 2000,
		stops: ['#672422', '#C3272B', '#A8B8C4'],
		pools: [{ color: '#67242288', pos: '15% -5%', size: '80% 55%' }],
		chromeOn: 'cream'
	},
	{
		decade: 2010,
		stops: ['#171412', '#5E6F4D', '#B8B0A8'],
		pools: [{ color: '#5E6F4D66', pos: '80% 20%', size: '75% 55%' }],
		chromeOn: 'cream'
	},
	{
		decade: 2020,
		stops: ['#1F3A8A', '#47484B', '#D6D6D6'],
		pools: [{ color: '#1F3A8A77', pos: '20% -10%', size: '80% 60%' }],
		chromeOn: 'cream'
	}
];

export function paletteFor(year: number): DecadePalette {
	const decade = Math.floor(year / 10) * 10;
	const first = DECADES[0].decade;
	const last = DECADES[DECADES.length - 1].decade;

	if (decade >= last) return DECADES[DECADES.length - 1];
	if (decade >= first) return DECADES[(decade - first) / 10];

	const stepsBack = (first - decade) / 10;
	const idx = (DECADES.length - (stepsBack % DECADES.length)) % DECADES.length;
	return DECADES[idx];
}

export function playerRoomFor(year: number): { stops: [string, string, string]; pool: string } {
	const palette = paletteFor(year);
	const deepPool = palette.pools[0].color.slice(0, 7);

	return { stops: [INK, deepPool, palette.stops[0]], pool: `${palette.stops[1]}66` };
}

function mixHex(a: string, b: string, t: number): string {
	const ah = a.replace('#', '');
	const bh = b.replace('#', '');
	let out = '#';

	for (let i = 0; i < 3; i += 1) {
		const ca = parseInt(ah.slice(i * 2, i * 2 + 2), 16);
		const cb = parseInt(bh.slice(i * 2, i * 2 + 2), 16);
		out += Math.round(ca + (cb - ca) * t)
			.toString(16)
			.padStart(2, '0');
	}

	return out;
}

export function personRoomFor(accentHex: string): {
	stops: [string, string, string];
	pools: DecadePalette['pools'];
} {
	return {
		stops: [mixHex(accentHex, INK, 0.78), accentHex, mixHex(accentHex, CREAM, 0.55)],
		pools: [
			{ color: `${accentHex}55`, pos: '82% 8%', size: '75% 55%' },
			{ color: `${mixHex(accentHex, INK, 0.5)}66`, pos: '5% 90%', size: '60% 50%' }
		]
	};
}

export const GRAIN_URI =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E";

export const FONT = {
	serif: "'Fraunces Variable', Georgia, serif",
	sans: "'Archivo Variable', 'Helvetica Neue', sans-serif"
};

export const MOTION = { fast: 200, slow: 300 };
