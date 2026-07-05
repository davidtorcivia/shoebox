import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { SessionUser } from './auth';
import { hashPassword } from './auth';
import type { Db } from './db';
import { albums, comments, invites, items, people, sessions, shares, users } from './db/schema';
import type { Role } from './roles';

export interface AdminUserRow {
	id: string;
	username: string;
	role: Role;
	accentColor: string;
	personId: string | null;
	personName: string | null;
	createdAt: Date;
}

export async function listUsers(db: Db): Promise<AdminUserRow[]> {
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			role: users.role,
			accentColor: users.accentColor,
			personId: users.personId,
			personName: people.name,
			createdAt: users.createdAt
		})
		.from(users)
		.leftJoin(people, eq(people.id, users.personId))
		.orderBy(asc(users.username));

	return rows.map((row) => ({
		...row,
		personId: row.personId ?? null,
		personName: row.personName ?? null
	}));
}

async function getUserOr404(db: Db, id: string): Promise<typeof users.$inferSelect> {
	const row = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
	if (!row) error(404, 'User not found');
	return row;
}

export async function changeRole(
	db: Db,
	actor: SessionUser,
	userId: string,
	newRole: Exclude<Role, 'owner'>
): Promise<void> {
	const target = await getUserOr404(db, userId);
	if ((newRole as Role) === 'owner') error(400, 'There is exactly one owner.');
	if (target.role === 'owner') error(403, "The owner's role cannot be changed.");
	if ((newRole === 'admin' || target.role === 'admin') && actor.role !== 'owner') {
		error(403, 'Only the owner can promote to or demote from admin.');
	}
	await db.update(users).set({ role: newRole }).where(eq(users.id, userId));
}

export async function resetPassword(db: Db, actor: SessionUser, userId: string): Promise<string> {
	const target = await getUserOr404(db, userId);
	if (target.role === 'owner' && actor.id !== target.id) {
		error(403, 'Only the owner can reset the owner password.');
	}
	if (target.role === 'admin' && actor.role !== 'owner') {
		error(403, 'Only the owner can reset an admin password.');
	}

	const temp = nanoid(14);
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(temp) })
		.where(eq(users.id, userId));
	await db.delete(sessions).where(eq(sessions.userId, userId));
	return temp;
}

export async function linkPerson(db: Db, userId: string, personId: string | null): Promise<void> {
	await getUserOr404(db, userId);
	if (personId !== null) {
		const person = (
			await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).limit(1)
		)[0];
		if (!person) error(400, 'unknown person');

		const linked = (
			await db.select({ id: users.id }).from(users).where(eq(users.personId, personId)).limit(1)
		)[0];
		if (linked && linked.id !== userId) error(409, 'person-already-linked');
	}

	await db.update(users).set({ personId }).where(eq(users.id, userId));
}

export async function deleteUser(db: Db, actor: SessionUser, userId: string): Promise<void> {
	const target = await getUserOr404(db, userId);
	if (target.role === 'owner') error(403, 'The owner cannot be deleted.');
	if (target.id === actor.id) error(400, 'You cannot delete your own account from here.');
	if (target.role === 'admin' && actor.role !== 'owner')
		error(403, 'Only the owner can delete an admin.');

	const owner = (
		await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1)
	)[0];
	if (!owner) error(500, 'No owner account found');

	await db.update(items).set({ uploadedBy: owner.id }).where(eq(items.uploadedBy, userId));
	await db.update(albums).set({ createdBy: owner.id }).where(eq(albums.createdBy, userId));
	await db.update(comments).set({ userId: owner.id }).where(eq(comments.userId, userId));
	await db.update(invites).set({ createdBy: owner.id }).where(eq(invites.createdBy, userId));
	await db.update(shares).set({ createdBy: owner.id }).where(eq(shares.createdBy, userId));
	await db.delete(sessions).where(eq(sessions.userId, userId));
	await db.delete(users).where(eq(users.id, userId));
}

export async function linkedPersonConflict(
	db: Db,
	userId: string,
	personId: string
): Promise<string | null> {
	const row = (
		await db.select({ id: users.id }).from(users).where(eq(users.personId, personId)).limit(1)
	)[0];
	return row && row.id !== userId ? row.id : null;
}
