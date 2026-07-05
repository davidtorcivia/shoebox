import type { JobQueueAdapter } from './types';

export const noopQueue: JobQueueAdapter = {
	async enqueue() {
		// Cloudflare derivatives are client-generated in this phase.
	}
};
