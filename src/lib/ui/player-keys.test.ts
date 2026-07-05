import { describe, expect, it } from 'vitest';
import { FRAME_STEP, isTypingTag, mapPlayerKey } from './player-keys';

const video = { paused: false, isVideo: true };
const videoPaused = { paused: true, isVideo: true };
const photo = { paused: true, isVideo: false };

describe('mapPlayerKey - video actions', () => {
	it('space toggles play', () => expect(mapPlayerKey(' ', video)).toEqual({ type: 'toggle-play' }));

	it('J/K/L shuttle case-insensitively', () => {
		expect(mapPlayerKey('j', video)).toEqual({ type: 'shuttle', key: 'J' });
		expect(mapPlayerKey('K', video)).toEqual({ type: 'shuttle', key: 'K' });
		expect(mapPlayerKey('l', video)).toEqual({ type: 'shuttle', key: 'L' });
	});

	it('arrows seek by five seconds while playing', () => {
		expect(mapPlayerKey('ArrowLeft', video)).toEqual({ type: 'seek-by', seconds: -5 });
		expect(mapPlayerKey('ArrowRight', video)).toEqual({ type: 'seek-by', seconds: 5 });
	});

	it('arrows frame-step while paused', () => {
		expect(mapPlayerKey('ArrowLeft', videoPaused)).toEqual({ type: 'step', direction: -1 });
		expect(mapPlayerKey('ArrowRight', videoPaused)).toEqual({ type: 'step', direction: 1 });
		expect(FRAME_STEP).toBeCloseTo(1 / 30);
	});

	it('maps fullscreen and mute', () => {
		expect(mapPlayerKey('f', video)).toEqual({ type: 'fullscreen' });
		expect(mapPlayerKey('m', video)).toEqual({ type: 'mute' });
	});
});

describe('mapPlayerKey - room actions', () => {
	it('up and down navigate items', () => {
		expect(mapPlayerKey('ArrowUp', photo)).toEqual({ type: 'prev-item' });
		expect(mapPlayerKey('ArrowDown', photo)).toEqual({ type: 'next-item' });
	});

	it('Escape closes', () => expect(mapPlayerKey('Escape', photo)).toEqual({ type: 'close' }));

	it('keeps video-only keys inert for photos', () => {
		expect(mapPlayerKey(' ', photo)).toBeNull();
		expect(mapPlayerKey('j', photo)).toBeNull();
		expect(mapPlayerKey('f', photo)).toBeNull();
		expect(mapPlayerKey('m', photo)).toBeNull();
		expect(mapPlayerKey('ArrowLeft', photo)).toBeNull();
	});

	it('returns null for unmapped keys', () => expect(mapPlayerKey('x', video)).toBeNull());
});

describe('isTypingTag', () => {
	it('treats inputs, textareas, selects, and contenteditable nodes as typing targets', () => {
		expect(isTypingTag('INPUT', false)).toBe(true);
		expect(isTypingTag('TEXTAREA', false)).toBe(true);
		expect(isTypingTag('SELECT', false)).toBe(true);
		expect(isTypingTag('DIV', true)).toBe(true);
	});

	it('does not treat other elements as typing targets', () => {
		expect(isTypingTag('DIV', false)).toBe(false);
		expect(isTypingTag('BUTTON', false)).toBe(false);
	});
});
