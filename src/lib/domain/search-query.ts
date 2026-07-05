export interface SearchQuery {
	text: string;
	people: string[];
	tags: string[];
	type?: 'video' | 'photo';
	album?: string;
	yearFrom?: number;
	yearTo?: number;
	age?: { person: string; min: number; max: number };
	uploader?: string;
}

export type ParsedOmnibox = SearchQuery & { warnings: string[] };

const TOKEN_RE = /([A-Za-z]+):"([^"]*)"|([A-Za-z]+):(\S+)|"([^"]*)"|(\S+)/g;
const KNOWN_KEYS = new Set(['person', 'tag', 'type', 'album', 'uploader', 'age']);
const YEAR_MIN = 1800;
const YEAR_MAX = 2199;

export function parseOmnibox(input: string): ParsedOmnibox {
	const q: ParsedOmnibox = { text: '', people: [], tags: [], warnings: [] };
	const textParts: string[] = [];
	let ageToken: string | null = null;

	const setYears = (from: number, to: number, token: string) => {
		if (q.yearFrom != null) {
			q.warnings.push(`Ignored "${token}" - a year filter is already set`);
			return;
		}
		if (from > to) [from, to] = [to, from];
		q.yearFrom = from;
		q.yearTo = to;
	};

	for (const match of input.matchAll(TOKEN_RE)) {
		const key = (match[1] ?? match[3])?.toLowerCase();
		const val = match[2] ?? match[4];
		if (key !== undefined && val !== undefined && KNOWN_KEYS.has(key)) {
			switch (key) {
				case 'person': {
					const v = val.trim();
					if (v) q.people.push(v);
					break;
				}
				case 'tag': {
					const v = val.trim().toLowerCase();
					if (v) q.tags.push(v);
					break;
				}
				case 'type': {
					const t = val.trim().toLowerCase();
					if (t !== 'video' && t !== 'photo') {
						q.warnings.push(`Ignored type:${val} - expected video or photo`);
					} else if (q.type && q.type !== t) {
						q.warnings.push(`Ignored type:${t} - already filtering type:${q.type}`);
					} else {
						q.type = t;
					}
					break;
				}
				case 'album': {
					const v = val.trim();
					if (!v) break;
					if (q.album) q.warnings.push(`Ignored album:${v} - already filtering album:${q.album}`);
					else q.album = v;
					break;
				}
				case 'uploader': {
					const v = val.trim();
					if (!v) break;
					if (q.uploader) q.warnings.push(`Ignored uploader:${v} - already filtering uploader:${q.uploader}`);
					else q.uploader = v;
					break;
				}
				case 'age': {
					if (ageToken !== null) q.warnings.push(`Ignored duplicate age:${val}`);
					else ageToken = val.trim();
					break;
				}
			}
			continue;
		}

		if (match[5] !== undefined) {
			if (match[5].trim()) textParts.push(`"${match[5]}"`);
			continue;
		}

		const word = match[6] ?? match[0];
		const range = /^(\d{4})\.\.(\d{4})$/.exec(word);
		if (range) {
			setYears(Number(range[1]), Number(range[2]), word);
			continue;
		}

		if (/^\d{4}$/.test(word)) {
			const year = Number(word);
			if (year >= YEAR_MIN && year <= YEAR_MAX) {
				setYears(year, year, word);
				continue;
			}
		}

		textParts.push(word);
	}

	const peopleByKey = new Map<string, string>();
	for (const person of q.people) {
		const key = person.toLowerCase();
		if (!peopleByKey.has(key)) peopleByKey.set(key, person);
	}
	q.people = [...peopleByKey.values()];
	q.tags = [...new Set(q.tags)];

	if (ageToken !== null) {
		const ageMatch = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(ageToken);
		if (!ageMatch) {
			q.warnings.push(`Ignored age:${ageToken} - expected age:N or age:N-M`);
		} else if (q.people.length !== 1) {
			q.warnings.push(
				`Ignored age:${ageToken} - age needs exactly one person filter (got ${q.people.length})`
			);
		} else {
			let min = Number(ageMatch[1]);
			let max = ageMatch[2] !== undefined ? Number(ageMatch[2]) : min;
			if (min > max) [min, max] = [max, min];
			q.age = { person: q.people[0], min, max };
		}
	}

	q.text = textParts.join(' ');
	return q;
}

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

export function serializeQuery(q: SearchQuery): string {
	const parts: string[] = [];
	for (const person of q.people) parts.push(`person:${quote(person)}`);
	if (q.age) parts.push(q.age.min === q.age.max ? `age:${q.age.min}` : `age:${q.age.min}-${q.age.max}`);
	for (const tag of q.tags) parts.push(`tag:${quote(tag)}`);
	if (q.type) parts.push(`type:${q.type}`);
	if (q.album) parts.push(`album:${quote(q.album)}`);
	if (q.uploader) parts.push(`uploader:${quote(q.uploader)}`);
	if (q.yearFrom != null) {
		const to = q.yearTo ?? q.yearFrom;
		parts.push(q.yearFrom === to ? `${q.yearFrom}` : `${q.yearFrom}..${to}`);
	}
	if (q.text.trim()) parts.push(q.text.trim());
	return parts.join(' ');
}
