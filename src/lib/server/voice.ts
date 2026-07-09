import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { items, users, voiceNotes } from '$lib/server/db/schema';
import type { Db } from '$lib/server/db';
import type { StorageAdapter } from '$lib/server/platform/types';

export const MAX_VOICE_BYTES = 12 * 1024 * 1024; // short clips only
const ALLOWED_MIME = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']);

export interface VoiceNoteDTO {
	id: string;
	url: string;
	mime: string;
	duration: number | null;
	author: string;
	authorId: string;
	authorAvatarUrl: string | null;
	authorAccentColor: string;
	createdAt: number;
	mine: boolean;
}

export async function listVoiceNotes(
	db: Db,
	storage: StorageAdapter,
	itemId: string,
	viewerId: string
): Promise<VoiceNoteDTO[]> {
	const rows = await db
		.select({
			id: voiceNotes.id,
			storageKey: voiceNotes.storageKey,
			mime: voiceNotes.mime,
			duration: voiceNotes.duration,
			createdAt: voiceNotes.createdAt,
			userId: voiceNotes.userId,
			username: users.username,
			avatarStorageKey: users.avatarStorageKey,
			accentColor: users.accentColor
		})
		.from(voiceNotes)
		.innerJoin(users, eq(users.id, voiceNotes.userId))
		.where(eq(voiceNotes.itemId, itemId))
		.orderBy(asc(voiceNotes.createdAt));

	return Promise.all(
		rows.map(async (row) => ({
			id: row.id,
			url: await storage.mediaUrl(row.storageKey),
			mime: row.mime,
			duration: row.duration,
			author: row.username,
			authorId: row.userId,
			authorAvatarUrl: row.avatarStorageKey ? await storage.mediaUrl(row.avatarStorageKey) : null,
			authorAccentColor: row.accentColor,
			createdAt: row.createdAt.getTime(),
			mine: row.userId === viewerId
		}))
	);
}

export async function addVoiceNote(
	db: Db,
	storage: StorageAdapter,
	userId: string,
	itemId: string,
	input: { data: Uint8Array; mime: string; duration: number | null }
): Promise<VoiceNoteDTO> {
	const item = (
		await db
			.select({ id: items.id })
			.from(items)
			.where(and(eq(items.id, itemId), isNull(items.deletedAt)))
			.limit(1)
	)[0];
	if (!item) error(404, 'item not found');
	if (!ALLOWED_MIME.has(input.mime)) error(400, 'unsupported audio type');
	if (input.data.byteLength === 0) error(400, 'empty recording');
	if (input.data.byteLength > MAX_VOICE_BYTES) error(400, 'recording too large');

	const id = nanoid(12);
	const ext = input.mime.split('/')[1]?.split(';')[0] ?? 'webm';
	const storageKey = `media/${itemId}/voice/${id}.${ext}`;
	await storage.put(storageKey, input.data, { contentType: input.mime });
	await db.insert(voiceNotes).values({
		id,
		itemId,
		userId,
		storageKey,
		mime: input.mime,
		duration: input.duration,
		createdAt: new Date()
	});

	const [created] = await listVoiceNotesById(db, storage, id, userId);
	return created;
}

export async function deleteVoiceNote(
	db: Db,
	storage: StorageAdapter,
	userId: string,
	isEditor: boolean,
	noteId: string
): Promise<void> {
	const note = (await db.select().from(voiceNotes).where(eq(voiceNotes.id, noteId)).limit(1))[0];
	if (!note) error(404, 'voice note not found');
	// The author can delete their own memory; editors can moderate any.
	if (note.userId !== userId && !isEditor) error(403, 'not allowed to delete this memory');
	await storage.delete(note.storageKey);
	await db.delete(voiceNotes).where(eq(voiceNotes.id, noteId));
}

async function listVoiceNotesById(
	db: Db,
	storage: StorageAdapter,
	id: string,
	viewerId: string
): Promise<VoiceNoteDTO[]> {
	const row = (
		await db
			.select({
				id: voiceNotes.id,
				storageKey: voiceNotes.storageKey,
				mime: voiceNotes.mime,
				duration: voiceNotes.duration,
				createdAt: voiceNotes.createdAt,
				userId: voiceNotes.userId,
				username: users.username,
				avatarStorageKey: users.avatarStorageKey,
				accentColor: users.accentColor
			})
			.from(voiceNotes)
			.innerJoin(users, eq(users.id, voiceNotes.userId))
			.where(eq(voiceNotes.id, id))
			.limit(1)
	)[0];
	if (!row) return [];
	return [
		{
			id: row.id,
			url: await storage.mediaUrl(row.storageKey),
			mime: row.mime,
			duration: row.duration,
			author: row.username,
			authorId: row.userId,
			authorAvatarUrl: row.avatarStorageKey ? await storage.mediaUrl(row.avatarStorageKey) : null,
			authorAccentColor: row.accentColor,
			createdAt: row.createdAt.getTime(),
			mine: row.userId === viewerId
		}
	];
}
