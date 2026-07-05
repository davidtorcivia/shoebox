export function relativeTime(iso: string, now: Date = new Date()): string {
	const then = new Date(iso);
	const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
	return then.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
