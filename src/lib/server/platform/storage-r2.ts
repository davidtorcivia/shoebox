import type { R2Bucket } from '@cloudflare/workers-types';
import type { StorageAdapter } from './types';

const FALLBACK_MIME = 'application/octet-stream';

export function createR2Storage(bucket: R2Bucket): StorageAdapter {
	return {
		async put(key, data, opts) {
			const body =
				data instanceof Uint8Array
					? data
					: new Uint8Array(await new Response(data as ReadableStream<Uint8Array>).arrayBuffer());
			await bucket.put(key, body, { httpMetadata: { contentType: opts.contentType } });
		},

		async get(key, range) {
			const obj = await bucket.get(
				key,
				range
					? {
							range: {
								offset: range.start,
								length: range.end !== undefined ? range.end - range.start + 1 : undefined
							}
						}
					: undefined
			);
			if (!obj) return null;
			return {
				stream: obj.body as unknown as ReadableStream<Uint8Array>,
				size: obj.size,
				contentType: obj.httpMetadata?.contentType ?? FALLBACK_MIME
			};
		},

		async head(key) {
			const obj = await bucket.head(key);
			if (!obj) return null;
			return { size: obj.size, contentType: obj.httpMetadata?.contentType ?? FALLBACK_MIME };
		},

		async delete(key) {
			await bucket.delete(key);
		},

		async mediaUrl(key) {
			return `/media/${key}`;
		}
	};
}
