import { expect, test } from '@playwright/test';

test('GET /healthz returns ok + version without auth', async ({ request }) => {
	const res = await request.get('/healthz');
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ ok: true, version: '0.1.0' });
});
