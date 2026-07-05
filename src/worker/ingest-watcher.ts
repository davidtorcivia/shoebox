import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import chokidar from 'chokidar';
import { eq } from 'drizzle-orm';
import exifr from 'exifr';
import { fileTypeFromFile } from 'file-type';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { sortDate } from '../lib/domain/dates';
import * as schema from '../lib/server/db/schema';
import { applyHolidayTags } from '../lib/server/items';
import type { StorageAdapter } from '../lib/server/platform/types';
import { parseConventions, resolveItemDate, titleFromFilename } from './conventions';
import { probeVideo } from './derivatives';
import { logIngestFailure, type WorkerDb } from './jobs';

export const SUPPORTED_EXTENSIONS: Record<string, 'video' | 'photo'> = {
	mp4: 'video',
	m4v: 'video',
	webm: 'video',
	mov: 'video',
	jpg: 'photo',
	jpeg: 'photo',
	png: 'photo',
	webp: 'photo',
	avif: 'photo',
	heic: 'photo'
};

export interface IngestDeps {
	db: WorkerDb;
	storage: StorageAdapter;
	ingestPath: string;
	mediaPath: string;
	ownerId: string;
	enqueue(kind: 'derivatives' | 'sprite', payload: Record<string, unknown>): Promise<void>;
}

export type IngestResult =
	| { status: 'ingested'; itemId: string }
	| { status: 'duplicate'; existingItemId: string }
	| { status: 'failed'; reason: string };

export function sha256File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		createReadStream(filePath)
			.on('error', reject)
			.on('data', (chunk) => hash.update(chunk))
			.on('end', () => resolve(hash.digest('hex')));
	});
}

async function moveFile(from: string, to: string): Promise<void> {
	await mkdir(dirname(to), { recursive: true });
	try {
		await rename(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		await copyFile(from, to);
		await unlink(from);
	}
}

async function moveAside(
	deps: IngestDeps,
	absPath: string,
	bucket: '_duplicates' | '_failed'
): Promise<void> {
	const name = basename(absPath);
	let target = join(deps.ingestPath, bucket, name);
	for (let index = 1; existsSync(target); index += 1) {
		target = join(deps.ingestPath, bucket, `${index}-${name}`);
	}
	await moveFile(absPath, target);
}

async function photoExifDate(absPath: string): Promise<string | null> {
	try {
		const exif = (await exifr.parse(absPath, ['DateTimeOriginal', 'CreateDate'])) as
			| { DateTimeOriginal?: Date; CreateDate?: Date }
			| undefined;
		const date = exif?.DateTimeOriginal ?? exif?.CreateDate;
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
		const year = date.getFullYear();
		if (year <= 1970 || year > 2100) return null;
		const pad = (value: number): string => String(value).padStart(2, '0');
		return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	} catch {
		return null;
	}
}

export async function processIngestFile(
	deps: IngestDeps,
	absPath: string
): Promise<IngestResult> {
	const relPath = relative(deps.ingestPath, absPath).split(sep).join('/');
	if (relPath.startsWith('_duplicates/') || relPath.startsWith('_failed/') || relPath.startsWith('..')) {
		return { status: 'failed', reason: 'outside ingest scope' };
	}

	const fail = async (reason: string): Promise<IngestResult> => {
		logIngestFailure(deps.db, relPath, reason);
		await moveAside(deps, absPath, '_failed');
		console.error(`[ingest] failed ${relPath}: ${reason}`);
		return { status: 'failed', reason };
	};

	const ext = extname(absPath).slice(1).toLowerCase();
	const type = SUPPORTED_EXTENSIONS[ext];
	if (!type) return fail(`unsupported extension .${ext}`);

	let sniffed: Awaited<ReturnType<typeof fileTypeFromFile>>;
	try {
		sniffed = await fileTypeFromFile(absPath);
	} catch (err) {
		return fail(`unreadable: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!sniffed) return fail('unrecognized file contents');
	const contentsMatch = type === 'video' ? sniffed.mime.startsWith('video/') : sniffed.mime.startsWith('image/');
	if (!contentsMatch) return fail(`contents (${sniffed.mime}) do not match extension .${ext}`);

	const sha256 = await sha256File(absPath);
	const existing = deps.db
		.select({ id: schema.items.id })
		.from(schema.items)
		.where(eq(schema.items.sha256, sha256))
		.get();
	if (existing) {
		await moveAside(deps, absPath, '_duplicates');
		console.log(`[ingest] duplicate of item ${existing.id}: ${relPath}`);
		return { status: 'duplicate', existingItemId: existing.id };
	}

	const hints = parseConventions(relPath);
	let width = 0;
	let height = 0;
	let duration: number | null = null;
	let mediaDate: string | null = null;

	try {
		if (type === 'video') {
			const probe = await probeVideo(absPath);
			width = probe.width;
			height = probe.height;
			duration = probe.duration;
			mediaDate = probe.creationTime;
		} else {
			const meta = await sharp(absPath).metadata();
			width = meta.width ?? 0;
			height = meta.height ?? 0;
			if ((meta.orientation ?? 1) >= 5) {
				[width, height] = [height, width];
			}
			mediaDate = await photoExifDate(absPath);
		}
	} catch (err) {
		return fail(`could not read media: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (width <= 0 || height <= 0) return fail('could not determine dimensions');

	const date = resolveItemDate(mediaDate, hints.year);
	const id = nanoid(12);
	const sizeBytes = (await stat(absPath)).size;
	const storageKey = `media/${id}/original.${ext}`;
	await moveFile(absPath, join(deps.mediaPath, storageKey));

	deps.db.transaction((tx) => {
		tx.insert(schema.items)
			.values({
				id,
				type,
				title: titleFromFilename(hints.filename) || null,
				dateStart: date.dateStart,
				dateEnd: date.dateEnd,
				datePrecision: date.precision,
				sortDate: sortDate({
					dateStart: date.dateStart,
					dateEnd: date.dateEnd,
					precision: date.precision
				}),
				duration,
				width,
				height,
				sizeBytes,
				sha256,
				source: 'ingest',
				status: 'needs_review',
				uploadedBy: deps.ownerId,
				createdAt: new Date()
			})
			.run();
		tx.insert(schema.itemFiles)
			.values({
				id: nanoid(12),
				itemId: id,
				kind: 'original',
				storageKey,
				mime: sniffed.mime,
				width,
				height
			})
			.run();

		for (const tagName of hints.tags) {
			tx.insert(schema.tags)
				.values({ id: nanoid(12), name: tagName, kind: 'topic' })
				.onConflictDoNothing()
				.run();
			const tag = tx
				.select({ id: schema.tags.id })
				.from(schema.tags)
				.where(eq(schema.tags.name, tagName))
				.get()!;
			tx.insert(schema.itemTags)
				.values({ itemId: id, tagId: tag.id })
				.onConflictDoNothing()
				.run();
		}
	});

	if (date.precision === 'day') await applyHolidayTags(deps.db, id);
	await deps.enqueue('derivatives', { itemId: id });
	if (type === 'video') await deps.enqueue('sprite', { itemId: id });
	console.log(`[ingest] created item ${id} from ${relPath}`);
	return { status: 'ingested', itemId: id };
}

export function startIngestWatcher(
	deps: IngestDeps,
	opts: { stabilityMs?: number; usePolling?: boolean } = {}
): { idle(): Promise<void>; close(): Promise<void> } {
	const stabilityMs = opts.stabilityMs ?? 2000;
	let queue: Promise<void> = Promise.resolve();
	const watcher = chokidar.watch(deps.ingestPath, {
		ignoreInitial: false,
		ignored: (path: string) =>
			path.includes(`${sep}_duplicates${sep}`) ||
			path.endsWith(`${sep}_duplicates`) ||
			path.includes(`${sep}_failed${sep}`) ||
			path.endsWith(`${sep}_failed`),
		awaitWriteFinish: {
			stabilityThreshold: stabilityMs,
			pollInterval: Math.min(200, stabilityMs)
		},
		usePolling: opts.usePolling ?? false
	});

	watcher.on('add', (absPath: string) => {
		queue = queue
			.then(() => processIngestFile(deps, absPath))
			.then(
				() => undefined,
				(err) => console.error(`[ingest] unexpected error for ${absPath}`, err)
			);
	});

	return {
		idle: () => queue.then(() => undefined),
		close: async () => {
			await watcher.close();
			await queue;
		}
	};
}
