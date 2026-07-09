/** Window-scoped keyboard map for the item room. */
export type PlayerAction =
	| { type: 'toggle-play' }
	| { type: 'shuttle'; key: 'J' | 'K' | 'L' }
	| { type: 'seek-by'; seconds: number }
	| { type: 'step'; direction: -1 | 1 }
	| { type: 'prev-item' }
	| { type: 'next-item' }
	| { type: 'fullscreen' }
	| { type: 'mute' }
	| { type: 'clip-toggle' }
	| { type: 'clip-set-in' }
	| { type: 'clip-set-out' }
	| { type: 'close' };

export const FRAME_STEP = 1 / 30;

/** True when key events must be ignored because the user is typing. */
export function isTypingTag(tagName: string, isContentEditable: boolean): boolean {
	if (isContentEditable) return true;
	return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function mapPlayerKey(
	key: string,
	ctx: { paused: boolean; isVideo: boolean }
): PlayerAction | null {
	switch (key) {
		case ' ':
			return ctx.isVideo ? { type: 'toggle-play' } : null;
		case 'j':
		case 'J':
			return ctx.isVideo ? { type: 'shuttle', key: 'J' } : null;
		case 'k':
		case 'K':
			return ctx.isVideo ? { type: 'shuttle', key: 'K' } : null;
		case 'l':
		case 'L':
			return ctx.isVideo ? { type: 'shuttle', key: 'L' } : null;
		case 'ArrowLeft':
			if (!ctx.isVideo) return null;
			return ctx.paused ? { type: 'step', direction: -1 } : { type: 'seek-by', seconds: -5 };
		case 'ArrowRight':
			if (!ctx.isVideo) return null;
			return ctx.paused ? { type: 'step', direction: 1 } : { type: 'seek-by', seconds: 5 };
		case 'ArrowUp':
			return { type: 'prev-item' };
		case 'ArrowDown':
			return { type: 'next-item' };
		case 'f':
		case 'F':
			return ctx.isVideo ? { type: 'fullscreen' } : null;
		case 'm':
		case 'M':
			return ctx.isVideo ? { type: 'mute' } : null;
		case 'c':
		case 'C':
			return ctx.isVideo ? { type: 'clip-toggle' } : null;
		case '[':
			return ctx.isVideo ? { type: 'clip-set-in' } : null;
		case ']':
			return ctx.isVideo ? { type: 'clip-set-out' } : null;
		case 'Escape':
			return { type: 'close' };
		default:
			return null;
	}
}
