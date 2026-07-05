import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { requireFaces } from './faces-gate';

const platform = (faces: boolean) =>
	({
		name: 'node',
		storage: undefined,
		queue: undefined,
		features: { ingestion: true, faces, serverDerivatives: true }
	}) as never;

describe('requireFaces', () => {
	it('allows enabled platforms', () => {
		expect(() => requireFaces(platform(true))).not.toThrow();
	});

	it('404s disabled platforms', () => {
		expect.assertions(2);
		try {
			requireFaces(platform(false));
		} catch (err) {
			expect(isHttpError(err)).toBe(true);
			expect(err).toMatchObject({ status: 404 });
		}
	});
});
