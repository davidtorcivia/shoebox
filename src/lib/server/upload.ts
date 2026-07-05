import { error } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { fitWithin } from '$lib/domain/dims';
import { isValidItemDate, type ItemDate } from '$lib/domain/dates';
import { findDuplicate } from '$lib/server/dedupe';
import { createItem, type ItemFileInput } from '$lib/server/items';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO, UploadMeta } from '$lib/types';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;

export const CHUNK_SIZE = 512 * 1024;

export const ALLOWED_MIME: Record<string, { ext: string; type: 'video' | 'photo' }> = {
	'video/mp4': { ext: 'mp4', type: 'video' },
	'video/quicktime': { ext: 'mov', type: 'video' },
	'video/webm': { ext: 'webm', type: 'video' },
	'video/x-m4v': { ext: 'm4v', type: 'video' },
	'image/heic': { ext: 'heic', type: 'photo' },
	'image/heic-sequence': { ext: 'heic', type: 'photo' },
	'image/heif': { ext: 'heif', type: 'photo' },
	'image/heif-sequence': { ext: 'heif', type: 'photo' },
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

export interface DerivativeBlob {
	data: Uint8Array;
	mime: string;
}

export interface CompleteUploadInput {
	uploadId: string;
	allowDuplicate: boolean;
	meta: UploadMeta;
	blurhash: string | null;
	derivatives: Record<'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600', DerivativeBlob>;
}

export function concatChunks(
	storage: StorageAdapter,
	uploadId: string,
	totalChunks: number
): ReadableStream<Uint8Array> {
	let index = 0;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			for (;;) {
				if (!reader) {
					if (index >= totalChunks) {
						controller.close();
						return;
					}
					const got = await storage.get(chunkKey(uploadId, index));
					if (!got) throw new Error(`chunk ${index} disappeared during assembly`);
					reader = got.stream.getReader();
					index += 1;
				}

				const { done, value } = await reader.read();
				if (done) {
					reader = null;
					continue;
				}

				controller.enqueue(value);
				return;
			}
		}
	});
}

export function validateUploadMeta(raw: unknown): UploadMeta {
	if (typeof raw !== 'object' || raw === null) throw error(400, 'invalid meta');

	const value = raw as Record<string, unknown>;
	if (value.type !== 'video' && value.type !== 'photo') {
		throw error(400, 'meta.type must be video|photo');
	}
	if (!Number.isInteger(value.width) || (value.width as number) <= 0) {
		throw error(400, 'meta.width invalid');
	}
	if (!Number.isInteger(value.height) || (value.height as number) <= 0) {
		throw error(400, 'meta.height invalid');
	}

	const duration =
		value.duration === null || value.duration === undefined ? null : Number(value.duration);
	if (duration !== null && !(Number.isFinite(duration) && duration > 0)) {
		throw error(400, 'meta.duration invalid');
	}

	const date = value.date as ItemDate | undefined;
	if (!date || !isValidItemDate(date)) {
		throw error(400, 'meta.date invalid');
	}

	return {
		type: value.type,
		width: value.width as number,
		height: value.height as number,
		duration,
		title: stringOrNull(value.title),
		description: stringOrNull(value.description),
		tapeLabel: stringOrNull(value.tapeLabel),
		date: { dateStart: date.dateStart, dateEnd: date.dateEnd, precision: date.precision },
		people: stringArray(value.people),
		tags: stringArray(value.tags)
	};
}

export async function completeUpload(
	db: Db,
	storage: StorageAdapter,
	queue: JobQueueAdapter,
	user: SessionUser,
	input: CompleteUploadInput
): Promise<ItemDTO> {
	const manifest = await readManifest(storage, input.uploadId);

	const missing: number[] = [];
	for (let index = 0; index < manifest.totalChunks; index += 1) {
		const head = await storage.head(chunkKey(input.uploadId, index));
		if (!head || head.size !== expectedChunkSize(manifest.sizeBytes, index, manifest.chunkSize)) {
			missing.push(index);
		}
	}
	if (missing.length > 0) throw error(409, `missing chunks: ${missing.join(',')}`);

	const duplicate = await findDuplicate(db, manifest.sha256);
	if (duplicate && !input.allowDuplicate) {
		throw error(409, `duplicate of item ${duplicate.itemId}`);
	}

	const kind = ALLOWED_MIME[manifest.mime];
	if (!kind) throw error(400, `unsupported mime: ${manifest.mime}`);
	if (input.meta.type !== kind.type) {
		throw error(
			400,
			`meta.type '${input.meta.type}' does not match uploaded mime '${manifest.mime}'`
		);
	}

	const itemId = nanoid(12);
	const originalKey = `media/${itemId}/original.${kind.ext}`;
	await storage.put(originalKey, concatChunks(storage, input.uploadId, manifest.totalChunks), {
		contentType: manifest.mime,
		sizeHint: manifest.sizeBytes
	});

	const files: ItemFileInput[] = [
		{
			kind: 'original',
			storageKey: originalKey,
			mime: manifest.mime,
			width: input.meta.width,
			height: input.meta.height
		}
	];

	const derivativeSpecs = [
		{ field: 'poster', maxWidth: null },
		{ field: 'thumb_400', maxWidth: 400 },
		{ field: 'thumb_800', maxWidth: 800 },
		{ field: 'thumb_1600', maxWidth: 1600 }
	] as const;

	for (const spec of derivativeSpecs) {
		const derivative = input.derivatives[spec.field];
		const key = `media/${itemId}/${spec.field}.webp`;
		await storage.put(key, derivative.data, {
			contentType: derivative.mime,
			sizeHint: derivative.data.byteLength
		});
		const dims =
			spec.maxWidth === null
				? { width: input.meta.width, height: input.meta.height }
				: fitWithin(input.meta.width, input.meta.height, spec.maxWidth);
		files.push({
			kind: spec.field,
			storageKey: key,
			mime: derivative.mime,
			width: dims.width,
			height: dims.height
		});
	}

	const dto = await createItem(db, storage, queue, {
		id: itemId,
		type: input.meta.type,
		title: input.meta.title,
		description: input.meta.description,
		tapeLabel: input.meta.tapeLabel,
		date: input.meta.date,
		duration: input.meta.duration,
		width: input.meta.width,
		height: input.meta.height,
		sizeBytes: manifest.sizeBytes,
		sha256: manifest.sha256,
		source: 'upload',
		blurhash: input.blurhash,
		files,
		people: input.meta.people,
		tags: input.meta.tags,
		uploadedBy: user.id
	});

	for (let index = 0; index < manifest.totalChunks; index += 1) {
		await storage.delete(chunkKey(input.uploadId, index));
	}
	await storage.delete(manifestKey(input.uploadId));

	return dto;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}
