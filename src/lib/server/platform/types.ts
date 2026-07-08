export interface StorageAdapter {
	put(
		key: string,
		data: Uint8Array | ReadableStream<Uint8Array>,
		opts: { contentType: string; sizeHint?: number }
	): Promise<void>;
	get(
		key: string,
		range?: { start: number; end?: number }
	): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
	head(key: string): Promise<{ size: number; contentType: string } | null>;
	delete(key: string): Promise<void>;
	/** URL the browser can fetch. Node: `/media/${key}`. CF: signed R2 URL (1h). */
	mediaUrl(key: string): Promise<string>;
}

export interface JobQueueAdapter {
	enqueue(
		kind: 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan' | 'transcode' | 'hls',
		payload: Record<string, unknown>,
		runAfter?: Date
	): Promise<void>;
}

export interface Platform {
	name: 'node' | 'cloudflare';
	storage: StorageAdapter;
	queue: JobQueueAdapter;
	features: { ingestion: boolean; faces: boolean; serverDerivatives: boolean };
}
