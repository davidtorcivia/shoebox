import { and, eq, isNull } from 'drizzle-orm';
import { items } from '$lib/server/db/schema';

type Db = App.Locals['db'];

export async function findDuplicate(db: Db, sha256: string): Promise<{ itemId: string } | null> {
	const rows = await db
		.select({ id: items.id })
		.from(items)
		.where(and(isNull(items.deletedAt), eq(items.sha256, sha256)))
		.limit(1);

	return rows.length > 0 ? { itemId: rows[0].id } : null;
}

