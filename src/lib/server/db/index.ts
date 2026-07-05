import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export { schema };

export type Db = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;
