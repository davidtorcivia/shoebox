import type { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import type { Db } from '../db';
import * as schema from '../db/schema';

export function openD1Db(d1: D1Database): Db {
	return drizzle(d1, { schema }) as unknown as Db;
}
