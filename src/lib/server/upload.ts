import { error } from '@sveltejs/kit';
import { fileTypeFromBuffer } from 'file-type';
import { nanoid } from 'nanoid';
import { fitWithin } from '$lib/domain/dims';
import { isValidItemDate, type ItemDate } from '$lib/domain/dates';
import { findDuplicate } from '$lib/server/dedupe';
import { ROLE_RANK } from '$lib/server/roles';
import { createItem, type ItemFileInput } from '$lib/server/items';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO, UploadMeta } from '$lib/types';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;

export const CHUNK_SIZE = 8 * 1024 * 1024;
/** Per-upload total byte cap; keep aligned with the BODY_LIMIT_MB operator default. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
/** Per-derivative byte cap — derivatives are webp thumbnails; anything larger is abuse. */
export const MAX_DERIVATIVE_BYTES = 5 * 1024 * 1024;

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
	'image/avif': { ext: 'avif', type: 'photo' },
	// Camera RAW: stored as-is for download; the worker extracts an embedded
	// preview (exiftool) to build web derivatives. The browser never sees these.
	'image/x-canon-cr2': { ext: 'cr2', type: 'photo' },
	'image/x-canon-cr3': { ext: 'cr3', type: 'photo' },
	'image/x-nikon-nef': { ext: 'nef', type: 'photo' },
	'image/x-sony-arw': { ext: 'arw', type: 'photo' },
	'image/x-adobe-dng': { ext: 'dng', type: 'photo' },
	'image/x-panasonic-rw2': { ext: 'rw2', type: 'photo' },
	'image/x-fujifilm-raf': { ext: 'raf', type: 'photo' },
	'image/x-olympus-orf': { ext: 'orf', type: 'photo' }
};

/** Image MIME types a browser can display directly. Photos in any other format
 * (HEIC/HEIF, camera RAW) are shown via their server-built webp derivative and
 * only offered as-is on the download link. */
const WEB_DISPLAYABLE_IMAGE_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif'
]);

export function isWebDisplayableImage(mime: string): boolean {
	return WEB_DISPLAYABLE_IMAGE_MIME.has(mime);
}

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

export type MediaSniffer = (sample: Uint8Array) => Promise<{ mime: string } | null>;

/**
 * Default media sniffer: detects the real type from file content via file-type.
 * The sniffed type is authoritative — the client-declared MIME only hints at it.
 */
export const sniffMediaType: MediaSniffer = async (sample) => {
	const detected = await fileTypeFromBuffer(sample);
	return detected ? { mime: detected.mime } : null;
};

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
	if (input.sizeBytes > MAX_UPLOAD_BYTES) {
		throw error(400, 'file exceeds maximum upload size');
	}
	if (!ALLOWED_MIME[input.mime]) {
		throw error(400, `unsupported mime: ${input.mime}`);
	}
	if (typeof input.filename !== 'string' || input.filename.length === 0) {
		throw error(400, 'missing filename');
	}
	if (input.filename.length > 255) {
		throw error(400, 'filename too long');
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

export type DerivativeField = 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600';

export interface CompleteUploadInput {
	uploadId: string;
	allowDuplicate: boolean;
	meta: UploadMeta;
	blurhash: string | null;
	/**
	 * Client-rendered webp derivatives. Empty when the browser could not decode
	 * the original (HEIC, camera RAW) — in that case the worker's derivatives job
	 * is the sole source of thumbnails, dimensions and blurhash.
	 */
	derivatives: Partial<Record<DerivativeField, DerivativeBlob>>;
}

export function concatChunks(
	storage: StorageAdapter,
	uploadId: string,
	totalChunks: number,
	startIndex = 0
): ReadableStream<Uint8Array> {
	let index = startIndex;
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

/**
 * Emit `prefix` then pipe `tail` (if any) into one stream, so the assembled
 * original is never fully buffered: the first chunk (already read for sniffing)
 * is replayed from memory and the rest streams off storage.
 */
function prefixedStream(
	prefix: Uint8Array,
	tail: ReadableStream<Uint8Array> | null
): ReadableStream<Uint8Array> {
	const reader = tail?.getReader();
	let sentPrefix = false;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (!sentPrefix) {
				sentPrefix = true;
				if (prefix.byteLength > 0) controller.enqueue(prefix);
				if (!reader) {
					controller.close();
					return;
				}
				return;
			}
			if (!reader) {
				controller.close();
				return;
			}
			const result = await reader.read();
			if (result.done) {
				controller.close();
				return;
			}
			controller.enqueue(result.value);
		},
		cancel() {
			reader?.cancel().catch(() => {});
		}
	});
}

/**
 * Per-sha in-process mutex. Serializes the check-then-insert critical section of
 * completeUpload so two concurrent commits of the same sha256 cannot both pass
 * the duplicate check: the second waits for the first's createItem commit, then
 * its own check observes the inserted row -> 409. Single-process (primary node
 * deploy); the platform Db contract is unchanged.
 */
const uploadLocks = new Map<string, Promise<void>>();

async function withShaLock<T>(sha: string, fn: () => Promise<T>): Promise<T> {
	const prev = uploadLocks.get(sha) ?? Promise.resolve();
	const run = prev.then(() => fn());
	const slot: Promise<void> = run.then(
		() => undefined,
		() => undefined
	);
	uploadLocks.set(sha, slot);
	slot.finally(() => {
		if (uploadLocks.get(sha) === slot) uploadLocks.delete(sha);
	});
	return run;
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
	input: CompleteUploadInput,
	sniff: MediaSniffer = sniffMediaType
): Promise<ItemDTO> {
	const manifest = await readManifest(storage, input.uploadId);
	if (
		!Number.isInteger(manifest.totalChunks) ||
		manifest.totalChunks <= 0 ||
		!Number.isInteger(manifest.sizeBytes) ||
		manifest.sizeBytes <= 0 ||
		manifest.sizeBytes > MAX_UPLOAD_BYTES
	) {
		throw error(400, 'corrupt upload manifest');
	}
	// Only the user who started the upload (or an admin+) may complete it.
	if (manifest.createdBy !== user.id && ROLE_RANK[user.role] < ROLE_RANK.admin) {
		throw error(403, 'not the owner of this upload');
	}

	const missing: number[] = [];
	for (let index = 0; index < manifest.totalChunks; index += 1) {
		const head = await storage.head(chunkKey(input.uploadId, index));
		if (!head || head.size !== expectedChunkSize(manifest.sizeBytes, index, manifest.chunkSize)) {
			missing.push(index);
		}
	}
	if (missing.length > 0) throw error(409, `missing chunks: ${missing.join(',')}`);

	// Serialize same-sha commits: the second caller awaits the first's createItem
	// commit, then its duplicate check sees the inserted row -> 409. This closes
	// the dedupe race for the single-process node deploy (the primary target).
	const dto = await withShaLock(manifest.sha256, () =>
		commitUpload(db, storage, queue, user, input, manifest, sniff)
	);

	for (let index = 0; index < manifest.totalChunks; index += 1) {
		await storage.delete(chunkKey(input.uploadId, index));
	}
	await storage.delete(manifestKey(input.uploadId));

	return dto;
}

/**
 * Duplicate check + media store + item insert, executed under the per-sha lock.
 * Split out so the lock scope is exactly the non-atomic check-then-insert region.
 */
async function commitUpload(
	db: Db,
	storage: StorageAdapter,
	queue: JobQueueAdapter,
	user: SessionUser,
	input: CompleteUploadInput,
	manifest: UploadManifest,
	sniff: MediaSniffer
): Promise<ItemDTO> {
	const duplicate = await findDuplicate(db, manifest.sha256);
	if (duplicate && !input.allowDuplicate) {
		throw error(409, `duplicate of item ${duplicate.itemId}`);
	}

	// Sniff the real media type from the first chunk's content (≤ CHUNK_SIZE).
	// The client-declared MIME is not trusted: the sniffed type picks the storage
	// extension and stored content-type, so a mislabeled or non-media payload
	// cannot be stored as a real media object.
	const firstGot = await storage.get(chunkKey(input.uploadId, 0));
	if (!firstGot) throw error(409, 'missing chunk 0');
	const firstBytes = new Uint8Array(await new Response(firstGot.stream).arrayBuffer());
	const sniffed = await sniff(firstBytes);
	if (!sniffed) throw error(400, 'could not detect media type from upload content');
	const kind = ALLOWED_MIME[sniffed.mime];
	if (!kind) throw error(400, `unsupported media type: ${sniffed.mime}`);
	if (input.meta.type !== kind.type) {
		throw error(
			400,
			`meta.type '${input.meta.type}' does not match detected media '${sniffed.mime}'`
		);
	}

	// Bound derivatives before storing anything so an abusive payload is rejected
	// before the original is written.
	for (const field of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600'] as const) {
		const derivative = input.derivatives[field];
		if (derivative && derivative.data.byteLength > MAX_DERIVATIVE_BYTES) {
			throw error(400, `${field} exceeds maximum derivative size`);
		}
	}

	const itemId = nanoid(12);
	const originalKey = `media/${itemId}/original.${kind.ext}`;
	const tail =
		manifest.totalChunks === 1
			? null
			: concatChunks(storage, input.uploadId, manifest.totalChunks, 1);
	await storage.put(originalKey, prefixedStream(firstBytes, tail), {
		contentType: sniffed.mime,
		sizeHint: manifest.sizeBytes
	});

	// Video date priority: the title (parsed client-side) wins; if it found
	// nothing we fall back to the container's embedded creation_time here.
	let date = input.meta.date;
	if (input.meta.type === 'video' && date.precision === 'unknown') {
		try {
			const { probeVideoCreationDate } = await import('$lib/server/media/probe');
			const guessed = await probeVideoCreationDate({
				mediaPath: process.env.MEDIA_PATH ?? './data/media',
				originalKey
			});
			if (guessed) date = guessed;
		} catch {
			/* leave the date unknown; the item lands in arrivals for review */
		}
	}

	const files: ItemFileInput[] = [
		{
			kind: 'original',
			storageKey: originalKey,
			mime: sniffed.mime,
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

	// When the client could not decode the original (HEIC/RAW) it uploads no
	// derivatives; the worker's derivatives job builds them from the stored
	// original instead. Only persist the thumbnails the client actually sent.
	for (const spec of derivativeSpecs) {
		const derivative = input.derivatives[spec.field];
		if (!derivative) continue;
		const key = `media/${itemId}/${spec.field}.webp`;
		// Derivatives are webp by contract; ignore the client-declared MIME so a
		// spoofed content-type cannot turn a thumbnail into served HTML/SVG.
		await storage.put(key, derivative.data, {
			contentType: 'image/webp',
			sizeHint: derivative.data.byteLength
		});
		const dims =
			spec.maxWidth === null
				? { width: input.meta.width, height: input.meta.height }
				: fitWithin(input.meta.width, input.meta.height, spec.maxWidth);
		files.push({
			kind: spec.field,
			storageKey: key,
			mime: 'image/webp',
			width: dims.width,
			height: dims.height
		});
	}

	return await createItem(db, storage, queue, {
		id: itemId,
		type: input.meta.type,
		title: input.meta.title,
		description: input.meta.description,
		tapeLabel: input.meta.tapeLabel,
		date,
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
}

function stringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}
