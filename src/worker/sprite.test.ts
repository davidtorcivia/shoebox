import { and, eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate';
import * as schema from '../lib/server/db/schema';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { spriteHandler } from './derivatives';
import type { WorkerContext } from './jobs';
import { createTestDb, seedItem, seedOwner } from './test-helpers';

beforeAll(async () => {
	await generateFixtures();
});

async function setup(type: 'video' | 'photo'): Promise<{ ctx: WorkerContext; itemId: string }> {
	const db = createTestDb();
	const owner = seedOwner(db);
	const itemId = seedItem(db, owner, { type });
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	const ext = type === 'video' ? 'mp4' : 'jpg';
	const key = `media/${itemId}/original.${ext}`;
	await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
	await copyFile(type === 'video' ? FIXTURE_MP4 : FIXTURE_JPG, join(mediaPath, key));
	db.insert(schema.itemFiles)
		.values({
			id: 'orig1',
			itemId,
			kind: 'original',
			storageKey: key,
			mime: type === 'video' ? 'video/mp4' : 'image/jpeg'
		})
		.run();
	return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('spriteHandler', () => {
	it('renders a 1600x900 webp sprite and records the item_files row', async () => {
		const { ctx, itemId } = await setup('video');
		await spriteHandler({ itemId }, ctx);

		const abs = join(ctx.mediaPath, `media/${itemId}/sprite.webp`);
		const meta = await sharp(abs).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(1600);
		expect(meta.height).toBe(900);

		const row = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite')))
			.get();
		expect(row).toBeDefined();
		expect(row!.storageKey).toBe(`media/${itemId}/sprite.webp`);
		expect(row!.width).toBe(1600);
		expect(row!.height).toBe(900);
	}, 10_000);

	it('is a no-op for photos', async () => {
		const { ctx, itemId } = await setup('photo');
		await spriteHandler({ itemId }, ctx);

		const row = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite')))
			.get();
		expect(row).toBeUndefined();
	});

	it('replaces the sprite row on rerun instead of duplicating it', async () => {
		const { ctx, itemId } = await setup('video');
		await spriteHandler({ itemId }, ctx);
		await spriteHandler({ itemId }, ctx);

		const rows = ctx.db
			.select()
			.from(schema.itemFiles)
			.where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite')))
			.all();
		expect(rows).toHaveLength(1);
	}, 20_000);
});
