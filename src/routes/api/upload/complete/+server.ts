import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import { completeUpload, validateUploadMeta, type DerivativeBlob } from '$lib/server/upload';
import type { RequestHandler } from './$types';

const DERIVATIVE_FIELDS = ['poster', 'thumb_400', 'thumb_800', 'thumb_1600'] as const;

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const form = await request.formData();
	const uploadId = String(form.get('uploadId') ?? '');
	const allowDuplicate = String(form.get('allowDuplicate') ?? '') === 'true';
	const metaRaw = JSON.parse(String(form.get('meta') ?? 'null')) as unknown;
	const meta = validateUploadMeta(metaRaw);
	const blurhashRaw = form.get('blurhash');
	const derivatives = {} as Record<(typeof DERIVATIVE_FIELDS)[number], DerivativeBlob>;

	for (const field of DERIVATIVE_FIELDS) {
		const value = form.get(field);
		if (!(value instanceof File)) {
			return json({ message: `${field} is required` }, { status: 400 });
		}
		derivatives[field] = { data: new Uint8Array(await value.arrayBuffer()), mime: value.type };
	}

	const item = await completeUpload(locals.db, locals.platform.storage, locals.platform.queue, user, {
		uploadId,
		allowDuplicate,
		meta,
		blurhash: typeof blurhashRaw === 'string' && blurhashRaw.length > 0 ? blurhashRaw : null,
		derivatives
	});

	return json({ item }, { status: 201 });
};

