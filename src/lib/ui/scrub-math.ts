export function fractionOf(time: number, duration: number): number {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	return Math.min(1, Math.max(0, time / duration));
}

export function timeFromClientX(
	clientX: number,
	rect: { left: number; width: number },
	duration: number
): number {
	if (!Number.isFinite(duration) || duration <= 0 || rect.width <= 0) return 0;
	const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
	return fraction * duration;
}
