import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/server/auth';
import type { Db } from '$lib/server/db';
import type { Platform as ShoeboxPlatform } from '$lib/server/platform/types';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			platform: ShoeboxPlatform;
			db: Db;
		}
		interface Platform {
			env?: {
				DB: D1Database;
				MEDIA: R2Bucket;
			};
		}
	}
}

export {};
