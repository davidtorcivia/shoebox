import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate';
import * as schema from '../lib/server/db/schema';
import { createFsStorage } from '../lib/server/platform/storage-fs';
import { processIngestFile, sha256File, type IngestDeps } from './ingest-watcher';
import { createTestDb, seedOwner } from './test-helpers';

beforeAll(async () => {
	await generateFixtures();
});

interface Env {
	deps: IngestDeps;
	enqueued: { kind: string; payload: Record<string, unknown> }[];
	ingestPath: string;
}

function makeEnv(): Env {
	const db = createTestDb();
	const ownerId = seedOwner(db);
	const ingestPath = mkdtempSync(join(tmpdir(), 'shoebox-ingest-'));
	const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
	const enqueued: Env['enqueued'] = [];

	return {
		enqueued,
		ingestPath,
		deps: {
			db,
			storage: createFsStorage(mediaPath),
			ingestPath,
			mediaPath,
			ownerId,
			enqueue: async (kind, payload) => {
				enqueued.push({ kind, payload });
			}
		}
	};
}

async function drop(env: Env, relPath: string, fixture: string): Promise<string> {
	const abs = join(env.ingestPath, relPath);
	await mkdir(dirname(abs), { recursive: true });
	await copyFile(fixture, abs);
	return abs;
}

describe('sha256File', () => {
	it('hashes a file to stable 64-character hex', async () => {
		const env = makeEnv();
		const abs = await drop(env, 'clip.mp4', FIXTURE_MP4);
		const first = await sha256File(abs);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(await sha256File(abs)).toBe(first);
	});
});

describe('processIngestFile for video with year and tag hints', () => {
	it('creates a needs_review ingest item, moves the original, attaches hints, and enqueues jobs', async () => {
		const env = makeEnv();
		const abs = await drop(env, '1994/christmas/clip.mp4', FIXTURE_MP4);
		const result = await processIngestFile(env.deps, abs);
		expect(result.status).toBe('ingested');
		if (result.status !== 'ingested') throw new Error('expected ingested result');
		const itemId = result.itemId;

		const item = env.deps.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.type).toBe('video');
		expect(item.status).toBe('needs_review');
		expect(item.source).toBe('ingest');
		expect(item.uploadedBy).toBe(env.deps.ownerId);
		expect(item.title).toBe('clip');
		expect(item.dateStart).toBe('1994-01-01');
		expect(item.dateEnd).toBe('1994-12-31');
		expect(item.datePrecision).toBe('year');
		expect(item.width).toBe(320);
		expect(item.height).toBe(180);
		expect(Math.abs((item.duration ?? 0) - 2)).toBeLessThan(0.5);

		expect(existsSync(abs)).toBe(false);
		expect(existsSync(join(env.deps.mediaPath, `media/${itemId}/original.mp4`))).toBe(true);
		const files = env.deps.db
			.select()
			.from(schema.itemFiles)
			.where(eq(schema.itemFiles.itemId, itemId))
			.all();
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe('original');
		expect(files[0].mime).toBe('video/mp4');

		const tagNames = env.deps.db
			.select({ name: schema.tags.name, kind: schema.tags.kind })
			.from(schema.itemTags)
			.innerJoin(schema.tags, eq(schema.itemTags.tagId, schema.tags.id))
			.where(eq(schema.itemTags.itemId, itemId))
			.all();
		expect(tagNames.map((tag) => tag.name)).toContain('christmas');

		expect(env.enqueued.map((entry) => entry.kind).sort()).toEqual(['derivatives', 'sprite']);
		expect(env.enqueued[0].payload).toEqual({ itemId });
	});
});

describe('processIngestFile for photo with EXIF date', () => {
	it('uses EXIF day precision over the year hint and applies holiday tags', async () => {
		const env = makeEnv();
		const abs = await drop(env, '1990/photo.jpg', FIXTURE_JPG);
		const result = await processIngestFile(env.deps, abs);
		expect(result.status).toBe('ingested');
		if (result.status !== 'ingested') throw new Error('expected ingested result');
		const itemId = result.itemId;

		const item = env.deps.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
		expect(item.type).toBe('photo');
		expect(item.dateStart).toBe('1994-12-25');
		expect(item.datePrecision).toBe('day');
		expect(item.sortDate).toBe('1994-12-25');
		expect(item.width).toBe(640);
		expect(item.height).toBe(480);

		const tagNames = env.deps.db
			.select({ name: schema.tags.name })
			.from(schema.itemTags)
			.innerJoin(schema.tags, eq(schema.itemTags.tagId, schema.tags.id))
			.where(eq(schema.itemTags.itemId, itemId))
			.all()
			.map((tag) => tag.name);
		expect(tagNames).toContain('christmas');
		expect(env.enqueued.map((entry) => entry.kind)).toEqual(['derivatives']);
	});
});
