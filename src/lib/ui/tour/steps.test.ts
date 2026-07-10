import { describe, expect, it } from 'vitest';
import { ROLE_RANK } from '$lib/server/roles';
import { buildSteps, TOUR_ROLE_RANK, TOUR_VERSION } from './steps';

const VIDEO = { id: 'it_video', type: 'video' } as const;
const PHOTO = { id: 'it_photo', type: 'photo' } as const;

describe('buildSteps', () => {
	it('keeps the client role ranks in parity with the server', () => {
		expect(TOUR_ROLE_RANK).toEqual(ROLE_RANK);
	});

	it('starts with the welcome step and ends on the profile', () => {
		for (const role of ['user', 'uploader', 'editor', 'admin', 'owner'] as const) {
			for (const sample of [null, VIDEO, PHOTO]) {
				const steps = buildSteps(role, 0, sample);
				expect(steps[0].id).toBe('welcome');
				expect(steps.at(-1)?.id).toBe('profile');
			}
		}
	});

	it('drops the item stops entirely on an empty library', () => {
		const ids = buildSteps('owner', 0, null).map((step) => step.id);
		expect(ids).toEqual([
			'welcome',
			'timeline',
			'people',
			'albums',
			'saved',
			'search',
			'upload',
			'admin',
			'profile'
		]);
	});

	it('walks a plain user through the item demonstrations without gated stops', () => {
		const ids = buildSteps('user', 5, VIDEO).map((step) => step.id);
		expect(ids).toEqual([
			'welcome',
			'timeline',
			'item',
			'save',
			'react',
			'memories',
			'people-row',
			'clip',
			'people',
			'albums',
			'saved',
			'search',
			'profile'
		]);
	});

	it('teaches Saved on the albums page, right after the albums stop', () => {
		const steps = buildSteps('user', 0, null);
		const albumsIndex = steps.findIndex((s) => s.id === 'albums');
		const saved = steps[albumsIndex + 1];
		expect(saved.id).toBe('saved');
		expect(saved.route).toBe('/albums');
		expect(saved.spot).toEqual(['[data-tour="saved-card"]']);
	});

	it('opens the edit metadata form while its step is showing', () => {
		const edit = buildSteps('editor', 0, PHOTO).find((s) => s.id === 'edit');
		expect(edit?.expand).toBe('[data-tour="edit"]');
	});

	it('shows the clip stop only for a video sample', () => {
		expect(buildSteps('user', 0, PHOTO).map((s) => s.id)).not.toContain('clip');
		expect(buildSteps('user', 0, VIDEO).map((s) => s.id)).toContain('clip');
	});

	it('adds edit and upload for uploaders, share for editors', () => {
		const uploaderIds = buildSteps('uploader', 0, PHOTO).map((s) => s.id);
		expect(uploaderIds).toContain('edit');
		expect(uploaderIds).toContain('upload');
		expect(uploaderIds).not.toContain('share');

		const editorIds = buildSteps('editor', 0, PHOTO).map((s) => s.id);
		expect(editorIds).toContain('share');
		expect(editorIds).not.toContain('admin');
	});

	it('shows arrivals to admins only, and only while the queue has items', () => {
		expect(buildSteps('editor', 3, null).map((s) => s.id)).not.toContain('arrivals');
		expect(buildSteps('admin', 0, null).map((s) => s.id)).not.toContain('arrivals');
		expect(buildSteps('admin', 3, null).map((s) => s.id)).toContain('arrivals');
		expect(buildSteps('owner', 3, null).map((s) => s.id)).toContain('arrivals');
	});

	it('routes every item stop at the sample memory', () => {
		const itemSteps = buildSteps('owner', 0, VIDEO).filter((s) => s.route === '/item/[id]');
		expect(itemSteps.length).toBeGreaterThanOrEqual(6);
		for (const step of itemSteps) expect(step.params).toEqual({ id: VIDEO.id });
	});

	it('only the welcome step stays in place; every stop names a route', () => {
		const steps = buildSteps('owner', 1, VIDEO);
		expect(steps[0].route).toBeNull();
		for (const step of steps.slice(1)) expect(step.route).toBeTruthy();
	});

	it('exports a version the completion endpoint will accept', () => {
		expect(Number.isInteger(TOUR_VERSION)).toBe(true);
		expect(TOUR_VERSION).toBeGreaterThanOrEqual(1);
	});
});
