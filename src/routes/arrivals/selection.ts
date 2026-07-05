export function moveFocus(count: number, focusIndex: number, delta: number): number {
	if (count <= 0) return 0;
	return Math.min(count - 1, Math.max(0, focusIndex + delta));
}

export function rangeSelect(ids: string[], anchorIndex: number, index: number): string[] {
	const start = Math.min(anchorIndex, index);
	const end = Math.max(anchorIndex, index);
	return ids.slice(start, end + 1);
}

export function parseTagsInput(input: string): string[] {
	return [
		...new Set(
			input
				.split(',')
				.map((tag) => tag.trim().toLowerCase())
				.filter((tag) => tag.length > 0)
		)
	];
}
