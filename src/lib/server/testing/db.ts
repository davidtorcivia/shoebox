import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import type { SessionUser } from '$lib/server/auth';
import * as schema from '$lib/server/db/schema';
import type { StorageAdapter } from '$lib/server/platform/types';

export type TestDb = App.Locals['db'];

export function makeTestDb(): TestDb {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
	return db as unknown as TestDb;
}

export async function makeUser(
	db: TestDb,
	over: Partial<typeof schema.users.$inferInsert> = {}
): Promise<typeof schema.users.$inferSelect> {
	const id = over.id ?? nanoid(12);
	await db.insert(schema.users).values({
		id,
		username: over.username ?? `user-${id}`,
		passwordHash: over.passwordHash ?? 'pbkdf2$310000$c2FsdA==$aGFzaA==',
		role: over.role ?? 'user',
		accentColor: over.accentColor ?? '#FA7B62',
		personId: over.personId ?? null,
		comfortMode: over.comfortMode ?? false,
		theme: over.theme ?? 'system',
		createdAt: over.createdAt ?? new Date()
	});
	return (await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1))[0];
}

export async function makePerson(
	db: TestDb,
	over: Partial<typeof schema.people.$inferInsert> = {}
): Promise<typeof schema.people.$inferSelect> {
	const id = over.id ?? nanoid(12);
	await db.insert(schema.people).values({
		id,
		name: over.name ?? `Person ${id}`,
		slug: over.slug ?? `person-${id.toLowerCase()}`,
		nickname: over.nickname ?? null,
		birthdate: over.birthdate ?? null,
		deathDate: over.deathDate ?? null,
		birthPlace: over.birthPlace ?? null,
		bio: over.bio ?? null,
		avatarItemId: over.avatarItemId ?? null,
		avatarCrop: over.avatarCrop ?? null,
		accentColor: over.accentColor ?? '#FA7B62',
		createdAt: over.createdAt ?? new Date()
	});
	return (await db.select().from(schema.people).where(eq(schema.people.id, id)).limit(1))[0];
}

export async function makeItem(
	db: TestDb,
	over: { uploadedBy: string } & Partial<typeof schema.items.$inferInsert>
): Promise<typeof schema.items.$inferSelect> {
	const id = over.id ?? nanoid(12);
	await db.insert(schema.items).values({
		id,
		type: over.type ?? 'photo',
		title: over.title ?? null,
		description: over.description ?? null,
		dateStart: 'dateStart' in over ? (over.dateStart ?? null) : '1994-01-01',
		dateEnd: 'dateEnd' in over ? (over.dateEnd ?? null) : '1994-01-01',
		datePrecision: over.datePrecision ?? 'day',
		sortDate: 'sortDate' in over ? (over.sortDate ?? null) : (over.dateStart ?? '1994-01-01'),
		duration: over.duration ?? null,
		width: over.width ?? 800,
		height: over.height ?? 600,
		sizeBytes: over.sizeBytes ?? 1000,
		sha256: over.sha256 ?? `sha-${id}`,
		blurhash: over.blurhash ?? null,
		source: over.source ?? 'upload',
		tapeLabel: over.tapeLabel ?? null,
		status: over.status ?? 'ready',
		uploadedBy: over.uploadedBy,
		deletedAt: over.deletedAt ?? null,
		createdAt: over.createdAt ?? new Date()
	});
	return (await db.select().from(schema.items).where(eq(schema.items.id, id)).limit(1))[0];
}

export async function addThumbs(db: TestDb, itemId: string): Promise<void> {
	for (const kind of ['thumb_400', 'thumb_800', 'poster'] as const) {
		await db.insert(schema.itemFiles).values({
			id: nanoid(12),
			itemId,
			kind,
			storageKey: `media/${itemId}/${kind}.webp`,
			mime: 'image/webp',
			width: 400,
			height: 300
		});
	}
}

export async function tagPerson(db: TestDb, itemId: string, personId: string): Promise<void> {
	await db.insert(schema.itemPeople).values({ itemId, personId, source: 'manual' });
}

export const stubStorage: StorageAdapter = {
	async mediaUrl(key) {
		return `/media/${key}`;
	},
	async put() {
		throw new Error('stub storage');
	},
	async get() {
		throw new Error('stub storage');
	},
	async head() {
		throw new Error('stub storage');
	},
	async delete() {
		throw new Error('stub storage');
	}
};

export function sessionUser(row: typeof schema.users.$inferSelect): SessionUser {
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		accentColor: row.accentColor,
		personId: row.personId,
		comfortMode: row.comfortMode,
		theme: row.theme
	};
}
