import { and, eq, inArray } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { nanoid } from 'nanoid';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import * as schema from '../lib/server/db/schema';
import type { JobHandler, WorkerDb } from './jobs';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const THUMB_WIDTHS = [400, 800, 1600] as const;
const WEBP_QUALITY = 82;

export interface VideoProbe {
	duration: number;
	width: number;
	height: number;
	creationTime: string | null;
}

type DerivedKind = 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite';

interface DerivedRow {
	kind: DerivedKind;
	storageKey: string;
	mime: string;
	width: number;
	height: number;
}

export function normalizeCreationTime(raw: string | null): string | null {
	if (!raw) return null;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	if (year <= 1970 || year > 2100) return null;
	return date.toISOString().slice(0, 10);
}

export function probeVideo(filePath: string): Promise<VideoProbe> {
	return new Promise((resolve, reject) => {
		ffmpeg.ffprobe(filePath, (err, data) => {
			if (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
				return;
			}

			const stream = data.streams.find((candidate) => candidate.codec_type === 'video');
			if (!stream) {
				reject(new Error(`no video stream in ${filePath}`));
				return;
			}

			resolve({
				duration: Number(data.format.duration ?? 0),
				width: stream.width ?? 0,
				height: stream.height ?? 0,
				creationTime: normalizeCreationTime(
					(data.format.tags?.creation_time as string | undefined) ?? null
				)
			});
		});
	});
}

function runFfmpeg(
	configure: (cmd: ffmpeg.FfmpegCommand) => ffmpeg.FfmpegCommand,
	input: string,
	output: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		configure(ffmpeg(input))
			.output(output)
			.on('end', () => resolve())
			.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
			.run();
	});
}

function replaceItemFiles(db: WorkerDb, itemId: string, rows: DerivedRow[]): void {
	db.transaction((tx) => {
		tx.delete(schema.itemFiles)
			.where(
				and(
					eq(schema.itemFiles.itemId, itemId),
					inArray(
						schema.itemFiles.kind,
						rows.map((row) => row.kind)
					)
				)
			)
			.run();

		for (const row of rows) {
			tx.insert(schema.itemFiles)
				.values({
					id: nanoid(12),
					itemId,
					...row
				})
				.run();
		}
	});
}

function loadItem(
	db: WorkerDb,
	itemId: string
): { item: typeof schema.items.$inferSelect; originalKey: string } {
	const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
	if (!item) throw new Error(`item ${itemId} not found`);

	const original = db
		.select()
		.from(schema.itemFiles)
		.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'original')))
		.get();
	if (!original) throw new Error(`item ${itemId} has no original file row`);

	return { item, originalKey: original.storageKey };
}

async function putWebp(
	ctx: Parameters<JobHandler>[1],
	itemId: string,
	kind: DerivedKind,
	source: Buffer,
	resizeWidth: number | null
): Promise<DerivedRow> {
	let pipeline = sharp(source).rotate();
	if (resizeWidth !== null) {
		pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
	}

	const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
	const storageKey = `media/${itemId}/${kind}.webp`;
	await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
	return {
		kind,
		storageKey,
		mime: 'image/webp',
		width: out.info.width,
		height: out.info.height
	};
}

export const derivativesHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	const originalAbs = join(ctx.mediaPath, originalKey);
	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-deriv-'));

	try {
		const rows: DerivedRow[] = [];
		let thumbSource: Buffer;

		if (item.type === 'video') {
			const probe = await probeVideo(originalAbs);
			const updates: Partial<typeof schema.items.$inferInsert> = {};
			if (probe.duration > 0 && (item.duration == null || Math.abs(item.duration - probe.duration) > 0.5)) {
				updates.duration = probe.duration;
			}
			if (
				probe.width > 0 &&
				probe.height > 0 &&
				(item.width !== probe.width || item.height !== probe.height)
			) {
				updates.width = probe.width;
				updates.height = probe.height;
			}
			if (Object.keys(updates).length > 0) {
				ctx.db.update(schema.items).set(updates).where(eq(schema.items.id, itemId)).run();
			}

			const framePng = join(tmp, 'poster.png');
			await runFfmpeg(
				(cmd) =>
					cmd
						.seekInput(Math.max(0, probe.duration * 0.1))
						.outputOptions(['-frames:v 1', "-vf scale='min(1600,iw)':-2"]),
				originalAbs,
				framePng
			);
			thumbSource = await readFile(framePng);
			rows.push(await putWebp(ctx, itemId, 'poster', thumbSource, null));
		} else {
			thumbSource = await readFile(originalAbs);
			const meta = await sharp(thumbSource).metadata();
			let width = meta.width ?? 0;
			let height = meta.height ?? 0;
			if ((meta.orientation ?? 1) >= 5) {
				[width, height] = [height, width];
			}
			if (width > 0 && height > 0 && (item.width !== width || item.height !== height)) {
				ctx.db
					.update(schema.items)
					.set({ width, height })
					.where(eq(schema.items.id, itemId))
					.run();
			}
		}

		for (const width of THUMB_WIDTHS) {
			rows.push(await putWebp(ctx, itemId, `thumb_${width}` as DerivedKind, thumbSource, width));
		}
		replaceItemFiles(ctx.db, itemId, rows);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};

export const spriteHandler: JobHandler = async (payload, ctx) => {
	const itemId = String(payload.itemId ?? '');
	const { item, originalKey } = loadItem(ctx.db, itemId);
	if (item.type !== 'video') return;

	const originalAbs = join(ctx.mediaPath, originalKey);
	const probe = await probeVideo(originalAbs);
	if (probe.duration <= 0) throw new Error(`item ${itemId} has zero duration; cannot build sprite`);

	const tmp = await mkdtemp(join(tmpdir(), 'shoebox-sprite-'));
	try {
		const tilePng = join(tmp, 'sprite.png');
		const fps = 100 / probe.duration;
		await runFfmpeg(
			(cmd) => cmd.outputOptions(['-frames:v 1', `-vf fps=${fps},scale=160:90,tile=10x10`]),
			originalAbs,
			tilePng
		);
		const out = await sharp(tilePng).webp({ quality: 70 }).toBuffer({ resolveWithObject: true });
		const storageKey = `media/${itemId}/sprite.webp`;
		await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
		replaceItemFiles(ctx.db, itemId, [
			{
				kind: 'sprite',
				storageKey,
				mime: 'image/webp',
				width: out.info.width,
				height: out.info.height
			}
		]);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
};
