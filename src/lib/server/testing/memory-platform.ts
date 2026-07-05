import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';

async function collect(data: Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array> {
	if (data instanceof Uint8Array) return data;
	return new Uint8Array(await new Response(data).arrayBuffer());
}

export class MemoryStorage implements StorageAdapter {
	files = new Map<string, { data: Uint8Array; contentType: string }>();

	async put(
		key: string,
		data: Uint8Array | ReadableStream<Uint8Array>,
		opts: { contentType: string; sizeHint?: number }
	): Promise<void> {
		this.files.set(key, { data: await collect(data), contentType: opts.contentType });
	}

	async get(
		key: string,
		range?: { start: number; end?: number }
	): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null> {
		const file = this.files.get(key);
		if (!file) return null;

		const data = range
			? file.data.slice(range.start, range.end === undefined ? file.data.length : range.end + 1)
			: file.data;

		return {
			stream: streamOf(data),
			size: file.data.length,
			contentType: file.contentType
		};
	}

	async head(key: string): Promise<{ size: number; contentType: string } | null> {
		const file = this.files.get(key);
		return file ? { size: file.data.length, contentType: file.contentType } : null;
	}

	async delete(key: string): Promise<void> {
		this.files.delete(key);
	}

	async mediaUrl(key: string): Promise<string> {
		return `/media/${key}`;
	}
}

function streamOf(data: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(data);
			controller.close();
		}
	});
}

export class MemoryQueue implements JobQueueAdapter {
	enqueued: { kind: string; payload: Record<string, unknown> }[] = [];

	async enqueue(
		kind: 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan',
		payload: Record<string, unknown>
	): Promise<void> {
		this.enqueued.push({ kind, payload });
	}
}

export function makeLocals(
	db: App.Locals['db'],
	user: App.Locals['user'],
	storage = new MemoryStorage(),
	queue = new MemoryQueue(),
	name: 'node' | 'cloudflare' = 'node'
): { locals: App.Locals; storage: MemoryStorage; queue: MemoryQueue } {
	const locals = {
		db,
		user,
		platform: {
			name,
			storage,
			queue,
			features: { ingestion: false, faces: false, serverDerivatives: false }
		}
	} as App.Locals;

	return { locals, storage, queue };
}
