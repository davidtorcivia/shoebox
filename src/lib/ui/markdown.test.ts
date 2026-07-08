import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
	it('renders paragraphs and strong', () => {
		const html = renderMarkdown('She ran the kitchen **like a bridge crew**.');
		expect(html).toContain('<p>');
		expect(html).toContain('<strong>like a bridge crew</strong>');
	});

	it('strips script tags and event handlers', () => {
		const html = renderMarkdown('hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('onerror');
	});

	it('keeps links but drops javascript: hrefs', () => {
		expect(renderMarkdown('[ok](https://example.com)')).toContain('href="https://example.com"');
		expect(renderMarkdown('[bad](javascript:alert(1))')).not.toContain('javascript:');
	});

	it('drops data: URIs in href', () => {
		expect(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)')).not.toMatch(/data:/i);
	});

	it('renders lists', () => {
		expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>');
	});
});
