export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
	if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return [...arr];
	const out = [...arr];
	const [moved] = out.splice(from, 1);
	out.splice(to, 0, moved);
	return out;
}

export function positionsFrom(ids: readonly string[]): { itemId: string; position: number }[] {
	return ids.map((itemId, position) => ({ itemId, position }));
}
