import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FaceBoxes from './FaceBoxes.svelte';

describe('FaceBoxes', () => {
	it('renders normalized box percentages and person labels', () => {
		const { body } = render(FaceBoxes, {
			props: {
				faces: [
					{
						id: 'f1',
						box: { x: 0.125, y: 0.25, w: 0.375, h: 0.5 },
						person: { id: 'p1', slug: 'marta', name: 'Marta', accentColor: '#A8D8EA' }
					}
				]
			}
		});

		expect(body).toContain('data-testid="face-box"');
		expect(body).toContain('--x:12.5%;--y:25%;--w:37.5%;--h:50%');
		expect(body).toContain('Marta');
		expect(body).toContain('/people/marta');
	});
});
