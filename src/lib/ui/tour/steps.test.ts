import { describe, expect, it } from 'vitest';
import { ROLE_RANK } from '$lib/server/roles';
import { buildSteps, TOUR_ROLE_RANK, TOUR_VERSION } from './steps';

describe('buildSteps', () => {
	it('keeps the client role ranks in parity with the server', () => {
		expect(TOUR_ROLE_RANK).toEqual(ROLE_RANK);
	});

	it('starts with the welcome step and ends on the profile', () => {
		for (const role of ['user', 'uploader', 'editor', 'admin', 'owner'] as const) {
			const steps = buildSteps(role, 0);
			expect(steps[0].id).toBe('welcome');
			expect(steps.at(-1)?.id).toBe('profile');
		}
	});

	it('gives a plain user the ungated walk only', () => {
		const ids = buildSteps('user', 5).map((step) => step.id);
		expect(ids).toEqual(['welcome', 'timeline', 'people', 'albums', 'search', 'profile']);
	});

	it('adds upload for uploaders', () => {
		const ids = buildSteps('uploader', 0).map((step) => step.id);
		expect(ids).toContain('upload');
		expect(ids).not.toContain('arrivals');
		expect(ids).not.toContain('admin');
	});

	it('shows arrivals to editors only while the queue has items', () => {
		expect(buildSteps('editor', 0).map((s) => s.id)).not.toContain('arrivals');
		expect(buildSteps('editor', 3).map((s) => s.id)).toContain('arrivals');
		expect(buildSteps('uploader', 3).map((s) => s.id)).not.toContain('arrivals');
	});

	it('adds admin for admins and the owner', () => {
		expect(buildSteps('admin', 0).map((s) => s.id)).toContain('admin');
		expect(buildSteps('owner', 0).map((s) => s.id)).toContain('admin');
		expect(buildSteps('editor', 0).map((s) => s.id)).not.toContain('admin');
	});

	it('only the welcome step stays in place; every stop names a route', () => {
		const steps = buildSteps('owner', 1);
		expect(steps[0].route).toBeNull();
		for (const step of steps.slice(1)) expect(step.route).toBeTruthy();
	});

	it('exports a version the completion endpoint will accept', () => {
		expect(Number.isInteger(TOUR_VERSION)).toBe(true);
		expect(TOUR_VERSION).toBeGreaterThanOrEqual(1);
	});
});
