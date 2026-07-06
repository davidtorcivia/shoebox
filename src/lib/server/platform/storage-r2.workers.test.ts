import { env } from 'cloudflare:test';
import { runStorageContract } from './storage-contract';
import { createR2Storage } from './storage-r2';

runStorageContract('storage-r2', async () => createR2Storage({ MEDIA: env.MEDIA }));
