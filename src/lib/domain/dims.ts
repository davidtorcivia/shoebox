export function fitWithin(
	width: number,
	height: number,
	maxWidth: number
): { width: number; height: number } {
	if (width <= 0 || height <= 0 || maxWidth <= 0) {
		throw new Error('Dimensions must be positive numbers');
	}

	if (width <= maxWidth) {
		return { width: Math.round(width), height: Math.round(height) };
	}

	const scale = maxWidth / width;
	return { width: Math.round(maxWidth), height: Math.round(height * scale) };
}
