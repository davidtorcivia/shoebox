import { describe, expect, it } from 'vitest';
import { noopQueue } from './queue-noop';

describe('queue-noop', () => {
	it('enqueue resolves without side effects', async () => {
		await expect(noopQueue.enqueue('derivatives', { itemId: 'x' })).resolves.toBeUndefined();
	});
});
