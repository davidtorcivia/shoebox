export function yearsFromDrag(deltaX: number, pxPerYear = 90): number {
	return Math.round(deltaX / pxPerYear);
}

export function momentumYears(velocityX: number, pxPerYear = 90, maxYears = 8): number {
	const projectedPx = velocityX * 180;
	const years = Math.round(projectedPx / pxPerYear);
	return Math.max(-maxYears, Math.min(maxYears, years));
}

