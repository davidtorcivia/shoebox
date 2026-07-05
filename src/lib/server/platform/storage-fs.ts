import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StorageAdapter } from './types';

const MIME_BY_EXT: Record<string, string> = {
	webp: 'image/webp',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	avif: 'image/avif',
	gif: 'image/gif',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	json: 'application/json'
};

export function mimeForKey(key: string): string {
	const ext = key.split('.').pop()?.toLowerCase() ?? '';
	return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function createFsStorage(root: string): StorageAdapter {
	const rootAbs = resolve(root);

	function pathFor(key: string): string {
		const abs = resolve(rootAbs, key);
		if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
			throw new Error(`Invalid storage key: ${key}`);
		}
		return abs;
	}

	return {
		async put(key, data) {
			const path = pathFor(key);
			await mkdir(dirname(path), { recursive: true });
			if (data instanceof Uint8Array) {
				await writeFile(path, data);
			} else {
				await pipeline(
					Readable.fromWeb(data as unknown as import('node:stream/web').ReadableStream<Uint8Array>),
					createWriteStream(path)
				);
			}
		},

		async get(key, range) {
			const path = pathFor(key);
			let size: number;
			try {
				size = (await stat(path)).size;
			} catch {
				return null;
			}
			const nodeStream = createReadStream(
				path,
				range ? { start: range.start, end: range.end ?? size - 1 } : undefined
			);
			return {
				stream: Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
				size,
				contentType: mimeForKey(key)
			};
		},

		async head(key) {
			try {
				const s = await stat(pathFor(key));
				return { size: s.size, contentType: mimeForKey(key) };
			} catch {
				return null;
			}
		},

		async delete(key) {
			await rm(pathFor(key), { force: true });
		},

		async mediaUrl(key) {
			return `/media/${key}`;
		}
	};
}
