import { describe, expect, it } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { createR2Storage, type R2StorageEnv } from './storage-r2';

const FULL_ENV: R2StorageEnv = {
	MEDIA: {} as R2Bucket,
	R2_ACCOUNT_ID: 'abcdef0123456789',
	R2_ACCESS_KEY_ID: 'AKIAEXAMPLEACCESSKEY',
	R2_SECRET_ACCESS_KEY: 'shhhsecretexamplesecret',
	R2_BUCKET_NAME: 'shoebox-media'
};

describe('storage-r2 mediaUrl presigning', () => {
	it('produces a correctly shaped SigV4 presigned GET URL', async () => {
		const storage = createR2Storage(FULL_ENV);
		const signed = new URL(await storage.mediaUrl('media/abc123/original.mp4'));
		expect(signed.protocol).toBe('https:');
		expect(signed.hostname).toBe('abcdef0123456789.r2.cloudflarestorage.com');
		expect(signed.pathname).toBe('/shoebox-media/media/abc123/original.mp4');
		expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
		expect(signed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
		expect(signed.searchParams.get('X-Amz-Credential')).toContain('AKIAEXAMPLEACCESSKEY');
		expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('produces distinct signed URLs for distinct keys', async () => {
		const storage = createR2Storage(FULL_ENV);
		const a = await storage.mediaUrl('media/aaa/original.mp4');
		const b = await storage.mediaUrl('media/bbb/original.mp4');
		expect(a).not.toBe(b);
	});

	it('falls back to /media/<key> when access key or secret is missing', async () => {
		const noKey = createR2Storage({
			MEDIA: {} as R2Bucket,
			R2_ACCOUNT_ID: 'abcdef0123456789',
			R2_SECRET_ACCESS_KEY: 'shhhsecretexamplesecret',
			R2_BUCKET_NAME: 'shoebox-media'
		});
		const noSecret = createR2Storage({
			MEDIA: {} as R2Bucket,
			R2_ACCOUNT_ID: 'abcdef0123456789',
			R2_ACCESS_KEY_ID: 'AKIAEXAMPLEACCESSKEY',
			R2_BUCKET_NAME: 'shoebox-media'
		});
		expect(await noKey.mediaUrl('media/x/original.mp4')).toBe('/media/media/x/original.mp4');
		expect(await noSecret.mediaUrl('media/x/original.mp4')).toBe('/media/media/x/original.mp4');
	});

	it('encodes key segments containing spaces as %20', async () => {
		const storage = createR2Storage(FULL_ENV);
		const signed = await storage.mediaUrl('media/abc def/original.mp4');
		expect(signed).toContain('abc%20def');
	});
});

describe('storage-r2 put streaming', () => {
	it('passes a ReadableStream body straight through to the bucket', async () => {
		const received: { body?: unknown; opts?: unknown } = {};
		const bucket = {
			put: async (key: string, body: unknown, opts?: unknown) => {
				received.body = body;
				received.opts = opts;
			},
			get: async () => null,
			head: async () => null,
			delete: async () => {}
		};
		const storage = createR2Storage({ MEDIA: bucket as unknown as R2Bucket });
		const stream = new Response(new Uint8Array([1, 2, 3, 4])).body!;
		await storage.put('media/x/original.mp4', stream, { contentType: 'video/mp4' });
		// Same instance, not buffered into a Uint8Array.
		expect(received.body).toBe(stream);
		expect(received.opts).toEqual({ httpMetadata: { contentType: 'video/mp4' } });
	});
});
