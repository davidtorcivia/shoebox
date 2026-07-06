export const INK = '#171412';
export const CREAM = '#FFF5E8';
export const DAWN = '#FA7B62';
export const DAWN_PALE = '#FFD9A8';

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

export function accentOn(hex: string): typeof INK | typeof CREAM {
	const match = ACCENTS.find((accent) => accent.hex.toLowerCase() === hex.toLowerCase());
	return match?.on === 'cream' ? CREAM : INK;
}

export type DecadePalette = {
	decade: number;
	stops: [string, string, string];
	pools: { color: string; pos: string; size: string }[];
	chromeOn: 'ink' | 'cream';
};

export const DECADES: DecadePalette[] = [
	{
		decade: 1900,
		stops: ['#16202A', '#7E6E5A', '#D9C7A2'],
		pools: [
			{ color: '#B88F5C66', pos: '14% -8%', size: '78% 58%' },
			{ color: '#284C5F55', pos: '96% 18%', size: '70% 54%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1910,
		stops: ['#243322', '#87603F', '#E4C77F'],
		pools: [
			{ color: '#D0A04466', pos: '78% -8%', size: '76% 58%' },
			{ color: '#633A3D55', pos: '2% 92%', size: '68% 50%' }
		],
		chromeOn: 'ink'
	},
	{
		decade: 1920,
		stops: ['#101A24', '#1F6F78', '#F4C15D'],
		pools: [
			{ color: '#F4C15D66', pos: '92% 8%', size: '74% 54%' },
			{ color: '#C94B4B4f', pos: '5% 82%', size: '68% 52%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1930,
		stops: ['#202323', '#7B715E', '#C9B07D'],
		pools: [
			{ color: '#B9483F50', pos: '16% 0%', size: '76% 56%' },
			{ color: '#78908A44', pos: '92% 80%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1940,
		stops: ['#1E2424', '#596D63', '#C5A36F'],
		pools: [
			{ color: '#3C4E5266', pos: '8% -10%', size: '82% 60%' },
			{ color: '#C07A4D4c', pos: '92% 90%', size: '70% 46%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1950,
		stops: ['#224E64', '#A8D8EA', '#F7D774'],
		pools: [
			{ color: '#F7D77477', pos: '82% 30%', size: '72% 58%' },
			{ color: '#E46D6D55', pos: '0% 88%', size: '64% 48%' }
		],
		chromeOn: 'ink'
	},
	{
		decade: 1960,
		stops: ['#2B2D64', '#E7563D', '#FFD700'],
		pools: [
			{ color: '#FFD70077', pos: '84% 8%', size: '76% 52%' },
			{ color: '#35A77D55', pos: '4% 92%', size: '70% 48%' }
		],
		chromeOn: 'ink'
	},
	{
		decade: 1970,
		stops: ['#362014', '#B45F2A', '#E2B857'],
		pools: [
			{ color: '#6B6E2368', pos: '85% 10%', size: '72% 54%' },
			{ color: '#D3826E5c', pos: '0% 88%', size: '66% 48%' }
		],
		chromeOn: 'ink'
	},
	{
		decade: 1980,
		stops: ['#090A1F', '#2447B8', '#D02F8A'],
		pools: [
			{ color: '#00B7C777', pos: '86% 8%', size: '78% 58%' },
			{ color: '#D02F8A66', pos: '4% 90%', size: '70% 50%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1990,
		stops: ['#222126', '#6E9FA8', '#F0C36E'],
		pools: [
			{ color: '#9D4C7A66', pos: '10% -8%', size: '82% 60%' },
			{ color: '#A6C36F55', pos: '94% 84%', size: '72% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2000,
		stops: ['#111827', '#1F3A8A', '#A8B8C4'],
		pools: [
			{ color: '#71C7EC5c', pos: '84% 6%', size: '78% 56%' },
			{ color: '#C3272B4f', pos: '8% 92%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2010,
		stops: ['#171412', '#5E6F4D', '#D8CFC0'],
		pools: [
			{ color: '#8EB89755', pos: '82% 18%', size: '74% 56%' },
			{ color: '#E6A75A44', pos: '4% 92%', size: '66% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2020,
		stops: ['#09111F', '#243C8F', '#D7D7E0'],
		pools: [
			{ color: '#4D7CFE66', pos: '18% -8%', size: '82% 60%' },
			{ color: '#FA7B6250', pos: '98% 84%', size: '70% 50%' }
		],
		chromeOn: 'cream'
	}
];

export function paletteFor(year: number): DecadePalette {
	const decade = Math.floor(year / 10) * 10;
	const first = DECADES[0].decade;

	if (decade >= first) return DECADES[((decade - first) / 10) % DECADES.length];

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
