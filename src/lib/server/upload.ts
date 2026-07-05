import { error } from '@sveltejs/kit';
import { findDuplicate } from '$lib/server/dedupe';
import type { StorageAdapter } from '$lib/server/platform/types';

type Db = App.Locals['db'];

export const CHUNK_SIZE = 8 * 1024 * 1024;

export const ALLOWED_MIME: Record<string, { ext: string; type: 'video' | 'photo' }> = {
	'video/mp4': { ext: 'mp4', type: 'video' },
	'video/webm': { ext: 'webm', type: 'video' },
	'image/jpeg': { ext: 'jpg', type: 'photo' },
	'image/png': { ext: 'png', type: 'photo' },
	'image/webp': { ext: 'webp', type: 'photo' },
	'image/avif': { ext: 'avif', type: 'photo' }
};

export interface UploadManifest {
	sha256: string;
	sizeBytes: number;
	mime: string;
	filename: string;
	chunkSize: number;
	totalChunks: number;
	createdBy: string;
	createdAt: string;
}

export interface InitUploadInput {
	sha256: string;
	sizeBytes: number;
	mime: string;
	filename: string;
}

export interface InitUploadResult {
	uploadId: string;
	chunkSize: number;
	totalChunks: number;
	receivedChunks: number[];
	duplicateItemId: string | null;
}

const SHA_RE = /^[0-9a-f]{64}$/;

export function chunkKey(uploadId: string, index: number): string {
	return `tmp/${uploadId}/${index}`;
}

function manifestKey(uploadId: string): string {
	return `tmp/${uploadId}/manifest.json`;
}

export function expectedChunkSize(sizeBytes: number, index: number, chunkSize: number): number {
	return Math.min(chunkSize, sizeBytes - index * chunkSize);
}

async function writeManifest(storage: StorageAdapter, manifest: UploadManifest): Promise<void> {
	await storage.put(
		manifestKey(manifest.sha256),
		new TextEncoder().encode(JSON.stringify(manifest)),
		{ contentType: 'application/json' }
	);
}

export async function readManifest(
	storage: StorageAdapter,
	uploadId: string
): Promise<UploadManifest> {
	const got = await storage.get(manifestKey(uploadId));
	if (!got) throw error(404, 'unknown uploadId');
	return JSON.parse(await new Response(got.stream).text()) as UploadManifest;
}

export async function initUpload(
	db: Db,
	storage: StorageAdapter,
	userId: string,
	input: InitUploadInput
): Promise<InitUploadResult> {
	if (typeof input.sha256 !== 'string' || !SHA_RE.test(input.sha256)) {
		throw error(400, 'invalid sha256');
	}
	if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
		throw error(400, 'invalid sizeBytes');
	}
	if (!ALLOWED_MIME[input.mime]) {
		throw error(400, `unsupported mime: ${input.mime}`);
	}
	if (typeof input.filename !== 'string' || input.filename.length === 0) {
		throw error(400, 'missing filename');
	}

	const uploadId = input.sha256;
	const totalChunks = Math.ceil(input.sizeBytes / CHUNK_SIZE);
	const duplicate = await findDuplicate(db, input.sha256);
	const existing = await storage.head(manifestKey(uploadId));

	if (!existing) {
		await writeManifest(storage, {
			sha256: input.sha256,
			sizeBytes: input.sizeBytes,
			mime: input.mime,
			filename: input.filename,
			chunkSize: CHUNK_SIZE,
			totalChunks,
			createdBy: userId,
			createdAt: new Date().toISOString()
		});
	} else {
		const manifest = await readManifest(storage, uploadId);
		if (
			manifest.sizeBytes !== input.sizeBytes ||
			manifest.mime !== input.mime ||
			manifest.chunkSize !== CHUNK_SIZE
		) {
			await writeManifest(storage, {
				...manifest,
				...input,
				chunkSize: CHUNK_SIZE,
				totalChunks
			});
		}
	}

	const receivedChunks: number[] = [];
	for (let index = 0; index < totalChunks; index += 1) {
		const head = await storage.head(chunkKey(uploadId, index));
		if (head && head.size === expectedChunkSize(input.sizeBytes, index, CHUNK_SIZE)) {
			receivedChunks.push(index);
		}
	}

	return {
		uploadId,
		chunkSize: CHUNK_SIZE,
		totalChunks,
		receivedChunks,
		duplicateItemId: duplicate?.itemId ?? null
	};
}

export async function saveChunk(
	storage: StorageAdapter,
	uploadId: string,
	index: number,
	data: Uint8Array
): Promise<{ received: true }> {
	const manifest = await readManifest(storage, uploadId);
	if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
		throw error(400, `chunk index ${index} out of range`);
	}

	const expected = expectedChunkSize(manifest.sizeBytes, index, manifest.chunkSize);
	if (data.byteLength !== expected) {
		throw error(400, `chunk ${index}: expected ${expected} bytes, got ${data.byteLength}`);
	}

	await storage.put(chunkKey(uploadId, index), data, {
		contentType: 'application/octet-stream',
		sizeHint: data.byteLength
	});

	return { received: true };
}

