import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/platform';
import pkg from '../../../package.json' with { type: 'json' };
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// Shallow DB ping: a container whose database has gone away should be reported
	// unhealthy rather than passing on process-alive alone. Fail closed (503).
	try {
		const db = await getDb(event);
		await db.run(sql`SELECT 1`);
		return json({ ok: true, version: pkg.version });
	} catch {
		return json({ ok: false, version: pkg.version }, { status: 503 });
	}
};
