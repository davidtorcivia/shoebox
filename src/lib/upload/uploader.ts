import type { InitUploadInput, InitUploadResult } from '$lib/server/upload';
import type { ItemDTO, UploadMeta } from '$lib/types';

type FetchLike = typeof fetch;

export type InitResponse = InitUploadResult;

export async function apiInitUpload(
	input: InitUploadInput,
	fetchFn: FetchLike = fetch
): Promise<InitResponse> {
	const res = await fetchFn('/api/upload/init', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) throw new Error(await message(res));
	return (await res.json()) as InitResponse;
}

export function chunkBytes(size: number, chunkSize: number, index: number): number {
	return Math.min(chunkSize, size - index * chunkSize);
}

export async function uploadChunks(
	file: Blob,
	init: InitResponse,
	onProgress: (sentBytes: number, totalBytes: number) => void = () => {},
	fetchFn: FetchLike = fetch
): Promise<void> {
	const received = new Set(init.receivedChunks);
	let sent = init.receivedChunks.reduce(
		(total, index) => total + chunkBytes(file.size, init.chunkSize, index),
		0
	);
	onProgress(sent, file.size);

	for (let index = 0; index < init.totalChunks; index += 1) {
		const size = chunkBytes(file.size, init.chunkSize, index);
		if (received.has(index)) continue;
		const chunk = file.slice(index * init.chunkSize, index * init.chunkSize + size);
		const body = await chunk.arrayBuffer();
		if (body.byteLength !== size) {
			throw new Error(
				`chunk ${index}: expected ${size} bytes before upload, got ${body.byteLength}`
			);
		}
		const res = await fetchFn(
			`/api/upload/chunk?uploadId=${encodeURIComponent(init.uploadId)}&index=${index}`,
			{ method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body }
		);
		if (!res.ok) throw new Error(await message(res));
		sent += size;
		onProgress(sent, file.size);
	}
}

export async function apiCompleteUpload(
	params: {
		uploadId: string;
		allowDuplicate: boolean;
		meta: UploadMeta;
		blurhash: string | null;
		derivatives: Record<'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600', Blob>;
	},
	fetchFn: FetchLike = fetch
): Promise<{ item: ItemDTO }> {
	const form = new FormData();
	form.set('uploadId', params.uploadId);
	form.set('allowDuplicate', String(params.allowDuplicate));
	form.set('meta', JSON.stringify(params.meta));
	if (params.blurhash) form.set('blurhash', params.blurhash);
	for (const [key, value] of Object.entries(params.derivatives)) {
		form.set(key, value);
	}
	const res = await fetchFn('/api/upload/complete', { method: 'POST', body: form });
	if (!res.ok) throw new Error(await message(res));
	return (await res.json()) as { item: ItemDTO };
}

async function message(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { message?: string };
		return body.message ?? res.statusText;
	} catch {
		return res.statusText;
	}
}
