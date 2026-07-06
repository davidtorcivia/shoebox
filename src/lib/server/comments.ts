import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { SessionUser } from '$lib/server/auth';
import type { Db } from '$lib/server/db';
import { comments, items, users } from '$lib/server/db/schema';
import { ROLE_RANK } from '$lib/server/roles';
import { reindexItem } from '$lib/server/search';

export interface CommentDTO {
	id: string;
	body: string;
	createdAt: string;
	user: { id: string; username: string; accentColor: string };
	canDelete: boolean;
}

export async function listComments(
	db: Db,
	itemId: string,
	viewer: SessionUser
): Promise<CommentDTO[]> {
	const rows = await db
		.select({
			id: comments.id,
			body: comments.body,
			createdAt: comments.createdAt,
			userId: users.id,
			username: users.username,
			accentColor: users.accentColor
		})
		.from(comments)
		.innerJoin(users, eq(comments.userId, users.id))
		.innerJoin(items, eq(comments.itemId, items.id))
		.where(
			and(
				eq(comments.itemId, itemId),
				isNull(comments.deletedAt),
				isNull(items.deletedAt)
			)
		)
		.orderBy(asc(comments.createdAt));

	return rows.map((row) => ({
		id: row.id,
		body: row.body,
		createdAt: row.createdAt.toISOString(),
		user: { id: row.userId, username: row.username, accentColor: row.accentColor },
		canDelete: canDeleteComment(viewer, row.userId)
	}));
}

export async function addComment(
	db: Db,
	itemId: string,
	viewer: SessionUser,
	body: string
): Promise<CommentDTO> {
	const item = await liveItem(db, itemId);
	if (!item) error(404, 'item not found');

	const trimmed = body.trim();
	if (!trimmed || trimmed.length > 2000) error(400, 'comment must be 1-2000 characters');

	const id = nanoid(12);
	const createdAt = new Date();
	await db.insert(comments).values({
		id,
		itemId,
		userId: viewer.id,
		body: trimmed,
		createdAt
	});
	await reindexItem(db, itemId);

	return {
		id,
		body: trimmed,
		createdAt: createdAt.toISOString(),
		user: { id: viewer.id, username: viewer.username, accentColor: viewer.accentColor },
		canDelete: true
	};
}

export async function deleteComment(
	db: Db,
	commentId: string,
	viewer: SessionUser
): Promise<void> {
	const row = (
		await db
			.select({ id: comments.id, itemId: comments.itemId, userId: comments.userId })
			.from(comments)
			.where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
			.limit(1)
	)[0];
	if (!row) error(404, 'comment not found');
	if (!canDeleteComment(viewer, row.userId)) error(403, 'not allowed to delete this comment');
	await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
	await reindexItem(db, row.itemId);
}

function canDeleteComment(viewer: SessionUser, authorId: string): boolean {
	return viewer.id === authorId || ROLE_RANK[viewer.role] >= ROLE_RANK.editor;
}

async function liveItem(db: Db, itemId: string) {
	return (
		await db
			.select({ id: items.id })
			.from(items)
			.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
			.limit(1)
	)[0];
}
