import type { ItemDTO } from '$lib/types';

export type GridEntry =
	| { id: string; kind: 'month'; monthKey: string; label: string; year: number; height: number }
	| { id: string; kind: 'item'; item: ItemDTO; year: number; height: number };

export interface LayoutEntry {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	entry: GridEntry;
}

export function columnCount(width: number): number {
	if (width < 560) return 2;
	if (width < 920) return 3;
	return 4;
}

export function buildGridEntries(items: ItemDTO[], columnWidth = 220): GridEntry[] {
	const entries: GridEntry[] = [];
	let lastMonth: string | null = null;

	for (const item of items) {
		const year = item.date.dateStart
			? Number(item.date.dateStart.slice(0, 4))
			: new Date().getFullYear();
		const monthKey = monthBreakKey(item);
		if (monthKey && monthKey !== lastMonth) {
			entries.push({
				id: `month-${monthKey}`,
				kind: 'month',
				monthKey,
				label: monthLabel(item.date.dateStart!),
				year,
				height: 68
			});
			lastMonth = monthKey;
		}
		entries.push({
			id: item.id,
			kind: 'item',
			item,
			year,
			height: itemHeight(item, columnWidth)
		});
	}

	return entries;
}

export function layoutMasonry(
	entries: GridEntry[],
	columns: number,
	columnWidth: number,
	gap = 12
): { entries: LayoutEntry[]; height: number } {
	const heights = Array.from({ length: columns }, () => 0);
	const out: LayoutEntry[] = [];

	for (const entry of entries) {
		const column = entry.kind === 'month' ? 0 : shortestColumn(heights);
		const y = entry.kind === 'month' ? Math.max(...heights) : heights[column];
		if (entry.kind === 'month') {
			for (let index = 0; index < columns; index += 1) heights[index] = y + entry.height + gap;
		} else {
			heights[column] = y + entry.height + gap;
		}
		out.push({
			id: entry.id,
			x: column * (columnWidth + gap),
			y,
			width: entry.kind === 'month' ? columns * columnWidth + (columns - 1) * gap : columnWidth,
			height: entry.height,
			entry
		});
	}

	return { entries: out, height: Math.max(0, ...heights) };
}

export function visibleEntryIds(
	entries: LayoutEntry[],
	scrollY: number,
	viewportHeight: number,
	overscan = 400
): string[] {
	const top = scrollY - overscan;
	const bottom = scrollY + viewportHeight + overscan;
	return entries
		.filter((entry) => entry.y + entry.height >= top && entry.y <= bottom)
		.map((entry) => entry.id);
}

export function activeYearFromSentinels(
	sentinels: { year: number; top: number }[],
	scrollY: number
): number | null {
	const passed = sentinels
		.filter((sentinel) => sentinel.top <= scrollY + 120)
		.sort((a, b) => b.top - a.top);
	return passed[0]?.year ?? null;
}

function shortestColumn(heights: number[]): number {
	let best = 0;
	for (let index = 1; index < heights.length; index += 1) {
		if (heights[index] < heights[best]) best = index;
	}
	return best;
}

function itemHeight(item: ItemDTO, width: number): number {
	const mediaHeight = Math.round((item.height / item.width) * width);
	return Math.max(100, mediaHeight) + 26;
}

function monthBreakKey(item: ItemDTO): string | null {
	if (!item.date.dateStart || !['day', 'month'].includes(item.date.precision)) return null;
	return item.date.dateStart.slice(0, 7);
}

function monthLabel(dateStart: string): string {
	const date = new Date(`${dateStart}T00:00:00Z`);
	return new Intl.DateTimeFormat('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}
