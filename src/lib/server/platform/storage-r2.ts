import type { R2Bucket } from '@cloudflare/workers-types';
import { AwsClient } from 'aws4fetch';
import type { StorageAdapter } from './types';

const FALLBACK_MIME = 'application/octet-stream';
/** Presigned GET URL lifetime, in seconds. */
const PRESIGN_TTL = 3600;

export interface R2StorageEnv {
	MEDIA: R2Bucket;
	R2_ACCOUNT_ID?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_BUCKET_NAME?: string;
}

type FixedLengthStreamCtor = new (length: number) => {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
};

// workerd exposes FixedLengthStream as a global; the DOM lib types do not, so
// resolve the constructor through a named binding (no inline cast-to-access).
const workerRuntime = globalThis as unknown as { FixedLengthStream?: FixedLengthStreamCtor };
const makeFixedLengthStream = workerRuntime.FixedLengthStream;

export function createR2Storage(env: R2StorageEnv): StorageAdapter {
	const bucket = env.MEDIA;

	const canPresign = !!(
		env.R2_ACCOUNT_ID &&
		env.R2_ACCOUNT_ID !== 'set-me-via-wrangler-whoami' &&
		env.R2_ACCESS_KEY_ID &&
		env.R2_SECRET_ACCESS_KEY &&
		env.R2_BUCKET_NAME
	);

	const signer = canPresign
		? new AwsClient({
				accessKeyId: env.R2_ACCESS_KEY_ID!,
				secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
				service: 's3',
				region: 'auto'
			})
		: null;

	return {
		async put(key, data, opts) {
			if (data instanceof Uint8Array) {
				await bucket.put(key, data, { httpMetadata: { contentType: opts.contentType } });
				return;
			}
			// workerd R2 requires a known-length body. When the caller gives a size
			// hint, stream through a FixedLengthStream so the original is never
			// buffered into Worker heap. FixedLengthStream only exists on the Workers
			// runtime; elsewhere (unit tests with a fake bucket) the stream passes
			// through unchanged.
			if (opts.sizeHint !== undefined && makeFixedLengthStream) {
				const { readable, writable } = new makeFixedLengthStream(opts.sizeHint);
				await Promise.all([
					data.pipeTo(writable),
					bucket.put(key, readable as unknown as Parameters<R2Bucket['put']>[1], {
						httpMetadata: { contentType: opts.contentType }
					})
				]);
				return;
			}
			await bucket.put(key, data as unknown as Parameters<R2Bucket['put']>[1], {
				httpMetadata: { contentType: opts.contentType }
			});
		},

		async get(key, range) {
			const obj = range
				? await bucket.get(key, {
						range: {
							offset: range.start,
							length: range.end !== undefined ? range.end - range.start + 1 : undefined
						}
					})
				: await bucket.get(key);
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
			if (!canPresign || !signer) return `/media/${key}`;
			const encodedKey = key.split('/').map(encodeURIComponent).join('/');
			const url = new URL(
				`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodedKey}`
			);
			url.searchParams.set('X-Amz-Expires', String(PRESIGN_TTL));
			const signed = await signer.sign(new Request(url, { method: 'GET' }), {
				aws: { signQuery: true }
			});
			return signed.url;
		}
	};
}
