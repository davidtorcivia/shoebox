import { sha256 } from '@noble/hashes/sha2.js';

const SLICE_SIZE = 8 * 1024 * 1024;

export async function sha256File(file: Blob): Promise<string> {
	const hash = sha256.create();
	for (let offset = 0; offset < file.size; offset += SLICE_SIZE) {
		const chunk = new Uint8Array(await file.slice(offset, offset + SLICE_SIZE).arrayBuffer());
		hash.update(chunk);
	}
	return hex(hash.digest());
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

