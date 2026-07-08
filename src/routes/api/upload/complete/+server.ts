import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/roles';
import {
	completeUpload,
	validateUploadMeta,
	MAX_DERIVATIVE_BYTES,
	type DerivativeBlob
} from '$lib/server/upload';
import type { RequestHandler } from './$types';

const DERIVATIVE_FIELDS = ['poster', 'thumb_400', 'thumb_800', 'thumb_1600'] as const;

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const form = await request.formData();
	const uploadId = String(form.get('uploadId') ?? '');
	const allowDuplicate = String(form.get('allowDuplicate') ?? '') === 'true';
	let metaRaw: unknown;
	try {
		metaRaw = JSON.parse(String(form.get('meta') ?? 'null'));
	} catch {
		return json({ message: 'meta is not valid JSON' }, { status: 400 });
	}
	const meta = validateUploadMeta(metaRaw);
	const blurhashRaw = form.get('blurhash');
	const derivatives: Partial<Record<(typeof DERIVATIVE_FIELDS)[number], DerivativeBlob>> = {};

	// Derivatives are optional: HEIC/RAW uploads the browser can't decode arrive
	// with none, and the worker builds them server-side from the original. Any
	// that ARE present must be complete — a partial set would leave gaps the
	// worker only fills on its next pass.
	for (const field of DERIVATIVE_FIELDS) {
		const value = form.get(field);
		if (value == null) continue;
		if (!(value instanceof File)) {
			return json({ message: `${field} must be a file` }, { status: 400 });
		}
		if (value.size > MAX_DERIVATIVE_BYTES) {
			return json({ message: `${field} exceeds maximum derivative size` }, { status: 400 });
		}
		derivatives[field] = { data: new Uint8Array(await value.arrayBuffer()), mime: value.type };
	}

	const item = await completeUpload(
		locals.db,
		locals.platform.storage,
		locals.platform.queue,
		user,
		{
			uploadId,
			allowDuplicate,
			meta,
			blurhash: typeof blurhashRaw === 'string' && blurhashRaw.length > 0 ? blurhashRaw : null,
			derivatives
		}
	);

	return json({ item }, { status: 201 });
};
