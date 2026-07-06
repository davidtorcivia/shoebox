import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import * as schema from '$lib/server/db/schema';
import { people, users } from '$lib/server/db/schema';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;
type Role = SessionUser['role'];

export function memoryDb(): Db {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
	return db as unknown as Db;
}

export async function seedUser(
	db: Db,
	over: Partial<{ id: string; username: string; role: Role }> = {}
): Promise<SessionUser> {
	const id = over.id ?? `u_${nanoid(8)}`;
	const username = over.username ?? `user_${id}`;
	const role = over.role ?? 'uploader';

	await db.insert(users).values({
		id,
		username,
		passwordHash: 'pbkdf2$310000$dGVzdA$dGVzdA',
		role,
		accentColor: '#FA7B62',
		avatarStorageKey: null,
		avatarMime: null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date()
	});

	return {
		id,
		username,
		role,
		accentColor: '#FA7B62',
		avatarStorageKey: null,
		personId: null,
		comfortMode: false,
		theme: 'system'
	};
}

export async function seedPerson(
	db: Db,
	over: Partial<{ id: string; name: string; birthdate: string }> = {}
): Promise<{ id: string; slug: string; name: string }> {
	const id = over.id ?? `p_${nanoid(8)}`;
	const name = over.name ?? `Person ${id}`;
	const slug = `person-${id.toLowerCase()}`;

	await db.insert(people).values({
		id,
		name,
		slug,
		birthdate: over.birthdate ?? null,
		accentColor: '#A8D8EA',
		createdAt: new Date()
	});

	return { id, slug, name };
}
