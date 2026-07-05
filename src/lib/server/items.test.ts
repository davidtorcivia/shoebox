import { beforeEach, describe, expect, it } from 'vitest';
import { items as itemsTable, tags, yearCounts } from '$lib/server/db/schema';
import { createItem, getItemDTO, normalizeTagName, type CreateItemInput } from './items';
import { memoryDb, seedPerson, seedUser } from './testing/memory-db';
import { MemoryQueue, MemoryStorage } from './testing/memory-platform';

type Db = App.Locals['db'];

let db: Db;
let storage: MemoryStorage;
let queue: MemoryQueue;
let userId: string;

export function baseInput(over: Partial<CreateItemInput> = {}): CreateItemInput {
	const id = over.id ?? 'itm000000001';
	return {
		id,
		type: 'video',
		title: 'Backyard sprinkler',
		description: null,
		tapeLabel: 'Tape 04',
		date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
		duration: 12.4,
		width: 1440,
		height: 1080,
		sizeBytes: 1000,
		sha256: 'c'.repeat(64),
		source: 'upload',
		blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
		files: [
			{
				kind: 'original',
				storageKey: `media/${id}/original.mp4`,
				mime: 'video/mp4',
				width: 1440,
				height: 1080
			},
			{
				kind: 'poster',
				storageKey: `media/${id}/poster.webp`,
				mime: 'image/webp',
				width: 1440,
				height: 1080
			},
			{
				kind: 'thumb_400',
				storageKey: `media/${id}/thumb_400.webp`,
				mime: 'image/webp',
				width: 400,
				height: 300
			},
			{
				kind: 'thumb_800',
				storageKey: `media/${id}/thumb_800.webp`,
				mime: 'image/webp',
				width: 800,
				height: 600
			},
			{
				kind: 'thumb_1600',
				storageKey: `media/${id}/thumb_1600.webp`,
				mime: 'image/webp',
				width: 1440,
				height: 1080
			}
		],
		people: [],
		tags: [],
		uploadedBy: userId,
		...over
	};
}

beforeEach(async () => {
	db = memoryDb();
	storage = new MemoryStorage();
	queue = new MemoryQueue();
	userId = (await seedUser(db)).id;
});

describe('createItem', () => {
	it('creates a ready item with the full master DTO shape', async () => {
		const dto = await createItem(db, storage, queue, baseInput());
		expect(dto).toMatchObject({
			id: 'itm000000001',
			type: 'video',
			title: 'Backyard sprinkler',
			description: null,
			date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
			displayDate: '1994',
			shortDate: 'c. 1994',
			duration: 12.4,
			width: 1440,
			height: 1080,
			status: 'ready',
			blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
			people: [],
			tags: [],
			albums: [],
			uploadedBy: userId,
			tapeLabel: 'Tape 04'
		});
		expect(dto.urls).toEqual({
			original: '/media/media/itm000000001/original.mp4',
			poster: '/media/media/itm000000001/poster.webp',
			thumb400: '/media/media/itm000000001/thumb_400.webp',
			thumb800: '/media/media/itm000000001/thumb_800.webp',
			thumb1600: '/media/media/itm000000001/thumb_1600.webp'
		});
	});

	it('undated items land in needs_review', async () => {
		const dto = await createItem(
			db,
			storage,
			queue,
			baseInput({ date: { dateStart: null, dateEnd: null, precision: 'unknown' } })
		);
		expect(dto.status).toBe('needs_review');
		expect(dto.displayDate).toBe('Undated');
		expect(await db.select().from(yearCounts)).toEqual([]);
	});

	it('rejects malformed dates with 400', async () => {
		await expect(
			createItem(
				db,
				storage,
				queue,
				baseInput({
					date: { dateStart: '1994-06-14', dateEnd: null, precision: 'day' }
				})
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('bumps year_counts and enqueues derivatives plus sprite for videos', async () => {
		await createItem(db, storage, queue, baseInput());
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 1 }]);
		expect(queue.enqueued).toEqual([
			{ kind: 'derivatives', payload: { itemId: 'itm000000001' } },
			{ kind: 'sprite', payload: { itemId: 'itm000000001' } }
		]);
	});

	it('photos enqueue derivatives only', async () => {
		await createItem(db, storage, queue, baseInput({ type: 'photo', duration: null }));
		expect(queue.enqueued.map((job) => job.kind)).toEqual(['derivatives']);
	});

	it('upserts topic tags case-insensitively and links people', async () => {
		const mom = await seedPerson(db, { name: 'Mom' });
		const dto = await createItem(
			db,
			storage,
			queue,
			baseInput({ tags: ['  Christmas ', 'sprinkler', 'christmas'], people: [mom.id] })
		);

		expect(dto.tags.map((tag) => tag.name).sort()).toEqual(['christmas', 'sprinkler']);
		expect(dto.tags.every((tag) => tag.kind === 'topic')).toBe(true);
		expect(dto.people).toEqual([{ id: mom.id, name: 'Mom', accentColor: '#A8D8EA' }]);

		await createItem(
			db,
			storage,
			queue,
			baseInput({ id: 'itm000000002', sha256: 'd'.repeat(64), tags: ['CHRISTMAS'] })
		);
		const tagRows = await db.select().from(tags);
		expect(tagRows.filter((tag) => tag.name === 'christmas')).toHaveLength(1);
	});

	it('rejects unknown person ids with 400', async () => {
		await expect(
			createItem(db, storage, queue, baseInput({ people: ['p_nope'] }))
		).rejects.toMatchObject({ status: 400 });
	});

	it('persists blurhash on the items row', async () => {
		await createItem(db, storage, queue, baseInput());
		const rows = await db.select().from(itemsTable);
		expect(rows).toHaveLength(1);
		expect(rows[0].blurhash).toBe('LKO2?U%2Tw=w]~RBVZRi};RPxuwH');
	});
});

describe('getItemDTO', () => {
	it('returns null for missing ids', async () => {
		expect(await getItemDTO(db, storage, 'nope')).toBeNull();
	});
});

describe('normalizeTagName', () => {
	it('lowercases and trims', () => {
		expect(normalizeTagName('  Christmas Morning ')).toBe('christmas morning');
	});
});

