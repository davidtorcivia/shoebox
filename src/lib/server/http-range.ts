export interface ParsedRange {
	start: number;
	end: number;
}

export function parseRange(header: string | null, size: number): ParsedRange | null {
	if (!header) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || size <= 0) return null;

	const [, startRaw, endRaw] = match;
	if (!startRaw && !endRaw) return null;

	if (!startRaw) {
		const suffixLength = Number(endRaw);
		if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
		return { start: Math.max(size - suffixLength, 0), end: size - 1 };
	}

	const start = Number(startRaw);
	const end = endRaw ? Number(endRaw) : size - 1;
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
		return null;
	}

	return { start, end: Math.min(end, size - 1) };
}

