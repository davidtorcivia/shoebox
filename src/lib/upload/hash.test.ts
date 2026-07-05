import { describe, expect, it } from 'vitest';
import { sha256File } from './hash';

describe('sha256File', () => {
	it('hashes a blob', async () => {
		const hash = await sha256File(new Blob(['abc']));
		expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});
