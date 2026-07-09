// Node-only: read a video container's embedded creation_time. Loaded via dynamic
// import so it never enters the Cloudflare bundle. Used as the fallback video
// date when the title carries none.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffprobeStatic from 'ffprobe-static';
import { itemDateFrom, type ItemDate } from '$lib/domain/dates';

const execFileAsync = promisify(execFile);
const FFPROBE_TIMEOUT_MS = 15_000;
const MIN_YEAR = 1900;

/**
 * Day-precision date from the container's `creation_time` metadata, or null if
 * absent/implausible (many files carry an epoch-zero or clearly-bogus stamp).
 */
export async function probeVideoCreationDate(opts: {
	mediaPath: string;
	originalKey: string;
}): Promise<ItemDate | null> {
	const originalAbs = join(opts.mediaPath, opts.originalKey);
	if (!existsSync(originalAbs)) return null;

	let stdout: string;
	try {
		({ stdout } = await execFileAsync(
			ffprobeStatic.path,
			['-v', 'quiet', '-print_format', 'json', '-show_format', originalAbs],
			{ timeout: FFPROBE_TIMEOUT_MS }
		));
	} catch {
		return null;
	}

	let raw: string | undefined;
	try {
		const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
		const tags = parsed.format?.tags ?? {};
		raw = tags.creation_time ?? tags.creationdate ?? tags['com.apple.quicktime.creationdate'];
	} catch {
		return null;
	}
	if (!raw) return null;

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	if (year < MIN_YEAR || year > new Date().getUTCFullYear() + 1) return null;

	try {
		return itemDateFrom({ precision: 'day', day: date.toISOString().slice(0, 10) });
	} catch {
		return null;
	}
}
