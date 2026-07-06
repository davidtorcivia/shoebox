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
		stops: ['#1B2326', '#8E6F4D', '#E6D0A6'],
		pools: [
			{ color: '#E6D0A666', pos: '88% 18%', size: '76% 58%' },
			{ color: '#5A6A6650', pos: '4% 92%', size: '68% 50%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1910,
		stops: ['#20281D', '#5F6D43', '#D6A24F'],
		pools: [
			{ color: '#A447355A', pos: '8% -6%', size: '74% 56%' },
			{ color: '#D6A24F66', pos: '96% 82%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1920,
		stops: ['#0B1620', '#006E78', '#F2BE49'],
		pools: [
			{ color: '#F2BE4977', pos: '88% 12%', size: '74% 56%' },
			{ color: '#B7435A58', pos: '4% 86%', size: '70% 52%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1930,
		stops: ['#2B2920', '#7B765C', '#CDB985'],
		pools: [
			{ color: '#8AA09A4F', pos: '92% 8%', size: '74% 54%' },
			{ color: '#B6533F50', pos: '10% 90%', size: '66% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1940,
		stops: ['#151C26', '#4D5F50', '#C3473D'],
		pools: [
			{ color: '#D6BA7A5C', pos: '88% 18%', size: '76% 58%' },
			{ color: '#2A4B6858', pos: '4% 92%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1950,
		stops: ['#073143', '#167C8D', '#D86F72'],
		pools: [
			{ color: '#F6C85B55', pos: '90% 16%', size: '72% 56%' },
			{ color: '#91D7D05A', pos: '6% 88%', size: '68% 50%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1960,
		stops: ['#160B43', '#A51768', '#E74C2E'],
		pools: [
			{ color: '#FFE60055', pos: '88% 12%', size: '74% 54%' },
			{ color: '#16A37B5A', pos: '6% 92%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1970,
		stops: ['#20100A', '#6A3D17', '#A66A22'],
		pools: [
			{ color: '#C04E2E5F', pos: '8% 90%', size: '68% 48%' },
			{ color: '#7C7A2F66', pos: '92% 8%', size: '74% 56%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1980,
		stops: ['#08061B', '#5525D9', '#FF2BA6'],
		pools: [
			{ color: '#00D2FF78', pos: '92% 10%', size: '78% 58%' },
			{ color: '#FFB0005C', pos: '6% 90%', size: '70% 50%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 1990,
		stops: ['#1D1A1D', '#3F837B', '#C7B45A'],
		pools: [
			{ color: '#8D496E5C', pos: '8% -6%', size: '80% 58%' },
			{ color: '#6D7E3555', pos: '96% 86%', size: '72% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2000,
		stops: ['#06121F', '#00639A', '#5C53B8'],
		pools: [
			{ color: '#75E8FF66', pos: '86% 10%', size: '76% 56%' },
			{ color: '#B6FF5A4D', pos: '6% 90%', size: '70% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2010,
		stops: ['#1C1520', '#D7504F', '#F4C9B8'],
		pools: [
			{ color: '#65C6BD58', pos: '92% 14%', size: '74% 56%' },
			{ color: '#F5D96B4F', pos: '8% 90%', size: '66% 48%' }
		],
		chromeOn: 'cream'
	},
	{
		decade: 2020,
		stops: ['#0E1018', '#6147A8', '#F3A5B8'],
		pools: [
			{ color: '#7DE1C366', pos: '90% 10%', size: '76% 56%' },
			{ color: '#F05A4E50', pos: '6% 92%', size: '70% 50%' }
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
