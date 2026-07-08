import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	albumItems as albumItemsTable,
	albums as albumsTable,
	items as itemsTable,
	tags,
	yearCounts
} from '$lib/server/db/schema';
import {
	createItem,
	decodeCursor,
	deleteItem,
	encodeCursor,
	getItemDTO,
	getItemDTOsByIds,
	listItems,
	normalizeTagName,
	restoreItem,
	setItemPoster,
	updateItem,
	type CreateItemInput
} from './items';
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
			displayDate: 'c. 1994',
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

	it('bumps year_counts and enqueues derivatives, sprite, and transcode for videos', async () => {
		await createItem(db, storage, queue, baseInput());
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 1 }]);
		expect(queue.enqueued).toEqual([
			{ kind: 'derivatives', payload: { itemId: 'itm000000001' } },
			{ kind: 'sprite', payload: { itemId: 'itm000000001' } },
			{ kind: 'transcode', payload: { itemId: 'itm000000001' } }
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
		expect(dto.people).toEqual([
			{
				id: mom.id,
				slug: mom.slug,
				name: 'Mom',
				accentColor: '#A8D8EA',
				avatarUrl: null,
				avatarCrop: null
			}
		]);

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

	it('reports circa age at the item date for imprecise dates', async () => {
		const kid = await seedPerson(db, { name: 'Kid', birthdate: '1990-06-15' });
		// baseInput date is year-precision 1994 → age at 1994-01-01 is 3, approximate.
		const dto = await createItem(db, storage, queue, baseInput({ people: [kid.id] }));
		expect(dto.people[0]).toMatchObject({ id: kid.id, age: 3, ageApprox: true });
	});

	it('reports an exact age for day-precision dates', async () => {
		const kid = await seedPerson(db, { name: 'Kid', birthdate: '1990-06-15' });
		const dto = await createItem(
			db,
			storage,
			queue,
			baseInput({
				date: { dateStart: '1995-06-15', dateEnd: '1995-06-15', precision: 'day' },
				people: [kid.id]
			})
		);
		expect(dto.people[0]).toMatchObject({ age: 5, ageApprox: false });
	});

	it('omits age when the person has no birthdate', async () => {
		const mom = await seedPerson(db, { name: 'Mom' });
		const dto = await createItem(db, storage, queue, baseInput({ people: [mom.id] }));
		expect(dto.people[0].age).toBeUndefined();
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

	it('gets multiple items in caller order and skips missing/deleted ids', async () => {
		await createItem(db, storage, queue, baseInput({ id: 'itm_a', sha256: 'a'.repeat(64) }));
		await createItem(db, storage, queue, baseInput({ id: 'itm_b', sha256: 'b'.repeat(64) }));
		await deleteItem(db, 'itm_a');
		expect(
			(await getItemDTOsByIds(db, storage, ['itm_b', 'missing', 'itm_a'])).map((item) => item.id)
		).toEqual(['itm_b']);
	});
});

describe('normalizeTagName', () => {
	it('lowercases and trims', () => {
		expect(normalizeTagName('  Christmas Morning ')).toBe('christmas morning');
	});
});

describe('listItems', () => {
	async function seedSix() {
		const mom = await seedPerson(db, { id: 'p_mom', name: 'Mom' });
		const dad = await seedPerson(db, { id: 'p_dad', name: 'Dad' });
		const mk = (id: string, over: Partial<CreateItemInput>) =>
			createItem(
				db,
				storage,
				queue,
				baseInput({ id, sha256: id.padEnd(64, '0'), title: null, ...over })
			);
		await mk('itm_a1', {
			date: { dateStart: '1988-07-04', dateEnd: '1988-07-04', precision: 'day' },
			type: 'photo',
			duration: null,
			tags: ['fireworks']
		});
		await mk('itm_a2', {
			date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
			people: [mom.id],
			title: 'Sprinkler day'
		});
		await mk('itm_a3', {
			date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
			people: [mom.id, dad.id]
		});
		await mk('itm_a4', {
			date: { dateStart: '1994-12-01', dateEnd: '1994-12-31', precision: 'month' },
			tags: ['christmas']
		});
		await mk('itm_a5', { date: { dateStart: null, dateEnd: null, precision: 'unknown' } });
		await mk('itm_a6', { date: { dateStart: null, dateEnd: null, precision: 'unknown' } });
		return { mom, dad };
	}

	it('orders by sortDate asc, undated last, and paginates with a stable cursor', async () => {
		await seedSix();
		const page1 = await listItems(db, storage, { limit: 3 });
		expect(page1.items.map((item) => item.id)).toEqual(['itm_a1', 'itm_a2', 'itm_a3']);
		expect(page1.nextCursor).not.toBeNull();
		const page2 = await listItems(db, storage, { limit: 3, cursor: page1.nextCursor! });
		expect(page2.items.map((item) => item.id)).toEqual(['itm_a4', 'itm_a5', 'itm_a6']);
		expect(page2.nextCursor).toBeNull();
	});

	it('filters by year, month, type, status, people, tags, and q', async () => {
		const { mom, dad } = await seedSix();
		expect((await listItems(db, storage, { year: 1994 })).items).toHaveLength(3);
		expect((await listItems(db, storage, { year: 1994, month: 6 })).items).toHaveLength(2);
		expect((await listItems(db, storage, { type: 'photo' })).items.map((item) => item.id)).toEqual([
			'itm_a1'
		]);
		expect((await listItems(db, storage, { status: 'needs_review' })).items).toHaveLength(2);
		expect((await listItems(db, storage, { people: [mom.id] })).items).toHaveLength(2);
		expect(
			(await listItems(db, storage, { people: [mom.id, dad.id] })).items.map((item) => item.id)
		).toEqual(['itm_a3']);
		expect(
			(await listItems(db, storage, { tags: ['Christmas'] })).items.map((item) => item.id)
		).toEqual(['itm_a4']);
		expect((await listItems(db, storage, { q: 'sprinkler' })).items.map((item) => item.id)).toEqual(
			['itm_a2']
		);
	});

	it('filters by album membership', async () => {
		await seedSix();
		await db
			.insert(albumsTable)
			.values({ id: 'alb1', title: 'Summer', createdBy: userId, createdAt: new Date() });
		await db.insert(albumItemsTable).values({ albumId: 'alb1', itemId: 'itm_a2', position: 0 });
		expect((await listItems(db, storage, { album: 'alb1' })).items.map((item) => item.id)).toEqual([
			'itm_a2'
		]);
	});

	it('clamps limit to 100', async () => {
		await seedSix();
		const res = await listItems(db, storage, { limit: 5000 });
		expect(res.items).toHaveLength(6);
	});

	it('cursor survives encode/decode roundtrip including null sortDate', () => {
		for (const cursor of [
			{ s: '1994-06-14', id: 'itm_a2' },
			{ s: null, id: 'itm_a5' }
		]) {
			expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
		}
	});
});

describe('update/delete/restore', () => {
	it('updates editable fields, links, status and year counts', async () => {
		const mom = await seedPerson(db, { name: 'Mom' });
		await createItem(db, storage, queue, baseInput({ tags: ['old'] }));
		const user = await seedUser(db, { id: 'u_owner', username: 'owner', role: 'owner' });

		const updated = await updateItem(db, storage, user, 'itm000000001', {
			title: 'Updated',
			date: { dateStart: '1995-01-01', dateEnd: '1995-12-31', precision: 'year' },
			people: [mom.id],
			tags: ['new']
		});

		expect(updated.title).toBe('Updated');
		expect(updated.shortDate).toBe('c. 1995');
		expect(updated.people.map((person) => person.id)).toEqual([mom.id]);
		expect(updated.tags.map((tag) => tag.name)).toEqual(['new']);
		expect(await db.select().from(yearCounts)).toEqual([
			{ year: 1994, type: 'video', count: 0 },
			{ year: 1995, type: 'video', count: 1 }
		]);
	});

	it('lets uploaders edit only their own items', async () => {
		await createItem(db, storage, queue, baseInput());
		const other = await seedUser(db, { id: 'u_other', username: 'other', role: 'uploader' });
		await expect(
			updateItem(db, storage, other, 'itm000000001', { title: 'Nope' })
		).rejects.toMatchObject({
			status: 403
		});
	});

	it('soft deletes and restores with year count changes', async () => {
		await createItem(db, storage, queue, baseInput());
		await deleteItem(db, 'itm000000001');
		expect(await getItemDTO(db, storage, 'itm000000001')).toBeNull();
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 0 }]);
		const restored = await restoreItem(db, storage, 'itm000000001');
		expect(restored.id).toBe('itm000000001');
		expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 1 }]);
	});
});

describe('setItemPoster', () => {
	it('stores the chosen frame and enqueues a derivatives re-run', async () => {
		await createItem(db, storage, queue, baseInput());
		const user = await seedUser(db, { id: 'u_ed', username: 'ed', role: 'editor' });
		queue.enqueued.length = 0;

		const dto = await setItemPoster(db, storage, queue, user, 'itm000000001', 4.2);

		expect(dto.posterTime).toBe(4.2);
		const [row] = await db
			.select()
			.from(itemsTable)
			.where(eq(itemsTable.id, 'itm000000001'));
		expect(row.posterTime).toBe(4.2);
		expect(queue.enqueued).toEqual([{ kind: 'derivatives', payload: { itemId: 'itm000000001' } }]);
	});

	it('rejects photos, bad times, and non-owners', async () => {
		await createItem(db, storage, queue, baseInput());
		const owner = await seedUser(db, { id: 'u_o', username: 'o', role: 'owner' });
		await expect(
			setItemPoster(db, storage, queue, owner, 'itm000000001', -1)
		).rejects.toMatchObject({ status: 400 });
		await expect(
			setItemPoster(db, storage, queue, owner, 'itm000000001', 9999)
		).rejects.toMatchObject({ status: 400 });

		await createItem(
			db,
			storage,
			queue,
			baseInput({ id: 'itm000000009', sha256: 'e'.repeat(64), type: 'photo', duration: null })
		);
		await expect(
			setItemPoster(db, storage, queue, owner, 'itm000000009', 1)
		).rejects.toMatchObject({ status: 400 });

		const stranger = await seedUser(db, { id: 'u_x', username: 'x', role: 'uploader' });
		await expect(
			setItemPoster(db, storage, queue, stranger, 'itm000000001', 3)
		).rejects.toMatchObject({ status: 403 });
	});
});
