// Pure helpers for video clip selection, shared by the clip endpoint (validation),
// the player UI (button gating), and the share flow. No node/ffmpeg here.

export type ClipFormat = 'mp4' | 'gif';

// Inline ffmpeg runs during the request, so segments are capped to keep encodes
// fast and responses snappy. GIFs are far heavier per second, so they cap lower.
export const CLIP_MAX_MP4_SECONDS = 60;
export const CLIP_MAX_GIF_SECONDS = 20;
export const CLIP_MIN_SECONDS = 0.2;

// GIF render settings — a good quality/size balance for reaction-length clips.
export const GIF_FPS = 15;
export const GIF_MAX_WIDTH = 480;

export function clipCapFor(format: ClipFormat): number {
	return format === 'gif' ? CLIP_MAX_GIF_SECONDS : CLIP_MAX_MP4_SECONDS;
}

export interface ClipValidation {
	ok: boolean;
	start: number;
	end: number;
	error?: string;
}

/**
 * Clamp and validate a requested [start,end] against the video duration and the
 * per-format length cap. Returns the sanitized range or an error message.
 */
export function validateClip(
	start: number,
	end: number,
	duration: number | null,
	format: ClipFormat
): ClipValidation {
	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		return { ok: false, start: 0, end: 0, error: 'start and end must be numbers' };
	}
	const limit = duration && duration > 0 ? duration : end;
	let s = Math.max(0, Math.min(start, limit));
	let e = Math.max(0, Math.min(end, limit));
	if (e < s) [s, e] = [e, s];
	const length = e - s;
	if (length < CLIP_MIN_SECONDS) {
		return { ok: false, start: s, end: e, error: 'Selection is too short' };
	}
	const cap = clipCapFor(format);
	if (length > cap + 0.05) {
		return { ok: false, start: s, end: e, error: `Clips are limited to ${cap} seconds` };
	}
	return { ok: true, start: s, end: e };
}

/** Compact, filename-safe timecode like `1m05s` or `12s`. */
export function clipStamp(seconds: number): string {
	const whole = Math.max(0, Math.round(seconds));
	const m = Math.floor(whole / 60);
	const s = whole % 60;
	return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** A friendly download filename base from an optional title + the time range. */
export function clipStem(title: string | null | undefined, start: number, end: number): string {
	const slug = (title ?? 'clip')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const base = slug || 'clip';
	return `${base}_${clipStamp(start)}-${clipStamp(end)}`;
}
