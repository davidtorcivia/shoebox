import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

export function renderMarkdown(markdown: string): string {
	const html = marked.parse(markdown, { async: false, breaks: true, gfm: true }) as string;
	return DOMPurify.sanitize(html, {
		ALLOWED_ATTR: ['href'],
		ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4']
	});
}
