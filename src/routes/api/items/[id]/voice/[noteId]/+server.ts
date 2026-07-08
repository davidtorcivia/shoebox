import { json } from '@sveltejs/kit';
import { deleteVoiceNote } from '$lib/server/voice';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'user');
	const isEditor = ROLE_RANK[user.role] >= ROLE_RANK.editor;
	await deleteVoiceNote(locals.db, locals.platform.storage, user.id, isEditor, params.noteId);
	return json({ ok: true });
};
