import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStorageContract } from './storage-contract';
import { createFsStorage } from './storage-fs';

runStorageContract('storage-fs', async () =>
	createFsStorage(await mkdtemp(join(tmpdir(), 'shoebox-storage-')))
);

describe('storage-fs key safety', () => {
	it('rejects path-traversal keys', async () => {
		const storage = createFsStorage(await mkdtemp(join(tmpdir(), 'shoebox-esc-')));
		await expect(
			storage.put('../escape.bin', new Uint8Array([1]), { contentType: 'application/octet-stream' })
		).rejects.toThrow(/Invalid storage key/);
	});

	it('node mediaUrl is /media/<key>', async () => {
		const storage = createFsStorage(await mkdtemp(join(tmpdir(), 'shoebox-url-')));
		expect(await storage.mediaUrl('media/abc/original.mp4')).toBe('/media/media/abc/original.mp4');
	});
});
