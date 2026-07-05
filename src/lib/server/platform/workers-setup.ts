import { env } from 'cloudflare:test';

const existing = await env.DB.prepare(
	"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_fts'"
).first();

if (!existing) {
	for (const stmt of env.TEST_MIGRATIONS) {
		await env.DB.prepare(stmt).run();
	}
}
