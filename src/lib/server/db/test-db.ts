/**
 * TEST-ONLY helper. Never import from runtime code: it reaches the better-sqlite3
 * backed in-memory database used by unit tests.
 */
import { memoryDb } from '$lib/server/testing/memory-db';

export const createTestDb = memoryDb;
export type TestDb = ReturnType<typeof createTestDb>;
