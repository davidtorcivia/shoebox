import { and, eq } from 'drizzle-orm';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_JPG, generateFixtures } from '../../e2e/fixtures/generate';
import * as schema from '../lib/server/db/schema';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { derivativesHandler } from './derivatives';
import type { WorkerContext } from './jobs';
import { createTestDb, seedItem, seedOwner } from './test-helpers';

beforeAll(async () => {
	await generateFixtures();
});

async function setupPhoto(): Promise<{ ctx: WorkerContext; itemId: string }> {
	const db = createTestDb();
	const owner = seedOwner(db);
	const itemId = seedItem(db, owner, { type: 'photo', width: 1, height: 1 });
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	const key = `media/${itemId}/original.jpg`;
	await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
	await copyFile(FIXTURE_JPG, join(mediaPath, key));
	db.insert(schema.itemFiles)
		.values({
			id: 'orig1',
			itemId,
			kind: 'original',
			storageKey: key,
			mime: 'image/jpeg',
			width: 640,
			height: 480
		})
		.run();
	return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('derivativesHandler for photos', () => {
	it('writes thumb_400/800/1600 webp under contract keys and records item_files rows', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);

		for (const width of [400, 800, 1600]) {
			const abs = join(ctx.mediaPath, `media/${itemId}/thumb_${width}.webp`);
			expect((await stat(abs)).size).toBeGreaterThan(0);
			const meta = await sharp(abs).metadata();
			expect(meta.format).toBe('webp');
		}

		const rows = ctx.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
		const kinds = rows.map((row) => row.kind).sort();
		expect(kinds).toEqual(['original', 'thumb_1600', 'thumb_400', 'thumb_800']);

		const rowWidth = (kind: string): number | null =>
			rows.find((row) => row.kind === kind)?.width ?? null;
		expect(rowWidth('thumb_400')).toBe(400);
		expect(rowWidth('thumb_800')).toBe(640);
		expect(rowWidth('thumb_1600')).toBe(640);
	});

	it('corrects items width and height from the real pixels', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);

		const item = ctx.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.width).toBe(640);
		expect(item.height).toBe(480);
	});

	it('is idempotent and replaces rows instead of duplicating them', async () => {
		const { ctx, itemId } = await setupPhoto();
		await derivativesHandler({ itemId }, ctx);
		await derivativesHandler({ itemId }, ctx);

		const thumbs = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'thumb_400')))
			.all();
		expect(thumbs).toHaveLength(1);
	});

	it('throws so the job retries when the item does not exist', async () => {
		const { ctx } = await setupPhoto();
		await expect(derivativesHandler({ itemId: 'nope' }, ctx)).rejects.toThrow(/item nope not found/);
	});
});
