export interface ConventionHints {
	year?: number;
	tags: string[];
	filename: string;
}

export interface ResolvedDate {
	dateStart: string | null;
	dateEnd: string | null;
	precision: 'day' | 'year' | 'unknown';
}

const YEAR_RE = /^(18|19|20)\d\d$/;

export function parseConventions(relPath: string): ConventionHints {
	const segments = relPath
		.replace(/\\/g, '/')
		.split('/')
		.filter((segment) => segment.length > 0);
	const filename = segments.pop() ?? '';
	const dirs = [...segments];
	let year: number | undefined;

	if (dirs.length > 0 && YEAR_RE.test(dirs[0])) {
		year = Number(dirs.shift());
	}

	const tags = [
		...new Set(
			dirs
				.map((dir) => dir.trim().toLowerCase().replace(/\s+/g, '-'))
				.filter((tag) => tag.length > 0)
		)
	];

	return year === undefined ? { tags, filename } : { year, tags, filename };
}

export function titleFromFilename(filename: string): string {
	return filename
		.replace(/\.[^.]+$/, '')
		.replace(/[-_]+/g, ' ')
		.trim();
}

export function resolveItemDate(mediaDate: string | null, yearHint?: number): ResolvedDate {
	if (mediaDate) {
		return { dateStart: mediaDate, dateEnd: mediaDate, precision: 'day' };
	}
	if (yearHint !== undefined) {
		return { dateStart: `${yearHint}-01-01`, dateEnd: `${yearHint}-12-31`, precision: 'year' };
	}
	return { dateStart: null, dateEnd: null, precision: 'unknown' };
}
