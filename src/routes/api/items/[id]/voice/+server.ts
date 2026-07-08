import { error, json } from '@sveltejs/kit';
import { addVoiceNote } from '$lib/server/voice';
import { requireRole } from '$lib/server/roles';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	const form = await request.formData().catch(() => null);
	const audio = form?.get('audio');
	if (!(audio instanceof File)) error(400, 'audio file is required');
	const durationRaw = Number(form?.get('duration'));
	const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
	const data = new Uint8Array(await audio.arrayBuffer());
	const mime = (audio.type || 'audio/webm').split(';')[0];
	const note = await addVoiceNote(locals.db, locals.platform.storage, user.id, params.id, {
		data,
		mime,
		duration
	});
	return json({ note }, { status: 201 });
};
