import { describe, expect, it } from 'vitest';
import {
	CLIP_MAX_GIF_SECONDS,
	CLIP_MAX_MP4_SECONDS,
	clipStamp,
	clipStem,
	validateClip
} from './clip';

describe('validateClip', () => {
	it('accepts an in-bounds selection', () => {
		expect(validateClip(3, 12, 24, 'mp4')).toEqual({ ok: true, start: 3, end: 12 });
	});

	it('clamps to the video duration', () => {
		const res = validateClip(-2, 40, 24, 'mp4');
		expect(res.ok).toBe(true);
		expect(res.start).toBe(0);
		expect(res.end).toBe(24);
	});

	it('swaps reversed bounds', () => {
		expect(validateClip(12, 3, 24, 'mp4')).toMatchObject({ ok: true, start: 3, end: 12 });
	});

	it('rejects a too-short selection', () => {
		expect(validateClip(5, 5.05, 24, 'mp4').ok).toBe(false);
	});

	it('rejects a selection longer than the mp4 cap', () => {
		const res = validateClip(0, CLIP_MAX_MP4_SECONDS + 5, 200, 'mp4');
		expect(res.ok).toBe(false);
		expect(res.error).toContain(`${CLIP_MAX_MP4_SECONDS}`);
	});

	it('applies the lower gif cap', () => {
		expect(validateClip(0, CLIP_MAX_GIF_SECONDS - 1, 200, 'gif').ok).toBe(true);
		expect(validateClip(0, CLIP_MAX_GIF_SECONDS + 5, 200, 'gif').ok).toBe(false);
	});

	it('rejects non-finite input', () => {
		expect(validateClip(Number.NaN, 5, 24, 'mp4').ok).toBe(false);
	});
});

describe('clipStamp', () => {
	it('formats sub-minute and minute+ times compactly', () => {
		expect(clipStamp(9)).toBe('9s');
		expect(clipStamp(65)).toBe('1m05s');
		expect(clipStamp(0)).toBe('0s');
	});
});

describe('clipStem', () => {
	it('slugifies the title and appends the range', () => {
		expect(clipStem('Lake Day!', 3, 12)).toBe('lake-day_3s-12s');
	});

	it('falls back to "clip" for an empty or symbol-only title', () => {
		expect(clipStem(null, 0, 5)).toBe('clip_0s-5s');
		expect(clipStem('!!!', 0, 5)).toBe('clip_0s-5s');
	});
});
