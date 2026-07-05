import { inArray } from 'drizzle-orm';
import { albums, items, shares } from '$lib/server/db/schema';
import { requireRole } from '$lib/server/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals, 'admin');
	const rows = await locals.db.select().from(shares);
	const albumIds = rows.filter((row) => row.targetType === 'album').map((row) => row.targetId);
	const itemIds = rows.filter((row) => row.targetType === 'item').map((row) => row.targetId);
	const albumTitles = albumIds.length
		? await locals.db
				.select({ id: albums.id, title: albums.title })
				.from(albums)
				.where(inArray(albums.id, albumIds))
		: [];
	const itemTitles = itemIds.length
		? await locals.db
				.select({ id: items.id, title: items.title })
				.from(items)
				.where(inArray(items.id, itemIds))
		: [];
	const titles = new Map<string, string>([
		...albumTitles.map((album) => [album.id, album.title] as const),
		...itemTitles.map((item) => [item.id, item.title ?? 'Untitled item'] as const)
	]);

	return {
		shares: rows.map((row) => ({
			id: row.id,
			token: row.token,
			targetType: row.targetType,
			targetId: row.targetId,
			targetTitle: titles.get(row.targetId) ?? '(deleted)',
			hasPassword: row.passwordHash !== null,
			expiresAt: row.expiresAt,
			allowDownload: row.allowDownload
		}))
	};
};
