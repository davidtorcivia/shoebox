export interface YearCount {
	year: number;
	count: number;
	people: number;
}

export interface Span {
	start: number;
	end: number;
}

export interface RailTick {
	year: number;
	count: number;
	people: number;
	height: number;
	empty: boolean;
	active: boolean;
	future: boolean;
}

export interface RailDecade {
	decade: number;
	label: string;
	centuryMark: boolean;
	active: boolean;
	future: boolean;
	ticks: RailTick[];
}

export interface MobileTick {
	startYear: number;
	height: number;
	empty: boolean;
	warm: boolean;
	future: boolean;
}

export interface RailLabel {
	decade: number;
	text: string;
	frac: number;
	active: boolean;
}

export function railSpan(earliest: number | null, now: number): Span {
	const currentDecade = decadeOf(now);
	const contentBase = earliest === null ? currentDecade : decadeOf(earliest);
	return { start: contentBase - 10, end: now };
}

export function decadeLabelText(decade: number): string {
	if (decade % 100 === 0) return String(decade);
	return `'${String(decade).slice(2)}`;
}

export function railDecades(
	years: YearCount[],
	earliest: number | null,
	activeYear: number,
	now: number,
	maxTickPx = 34
): RailDecade[] {
	const span = railSpan(earliest, now);
	const counts = new Map(years.map((year) => [year.year, year]));
	const maxCount = Math.max(1, ...years.map((year) => year.count));
	const out: RailDecade[] = [];

	for (let decade = decadeOf(span.start); decade <= decadeOf(span.end); decade += 10) {
		const ticks: RailTick[] = [];
		for (let offset = 0; offset < 10; offset += 1) {
			const year = decade + offset;
			if (year > now) continue;
			const entry = counts.get(year);
			const count = entry?.count ?? 0;
			ticks.push({
				year,
				count,
				people: entry?.people ?? 0,
				height: count > 0 ? Math.round(Math.sqrt(count / maxCount) * maxTickPx) : 0,
				empty: count === 0,
				active: year === activeYear,
				future: year > now
			});
		}

		out.push({
			decade,
			label: decadeLabelText(decade),
			centuryMark: decade % 100 === 0,
			active: activeYear >= decade && activeYear <= decade + 9,
			future: decade > now,
			ticks
		});
	}

	return out;
}

export function nearestYearWithContent(target: number, years: YearCount[]): number | null {
	const withContent = years.filter((year) => year.count > 0).map((year) => year.year);
	if (withContent.length === 0) return null;
	return withContent.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
}

export function mobileRailTicks(
	years: YearCount[],
	earliest: number | null,
	activeYear: number,
	now: number,
	bucketYears = 5,
	maxTickPx = 30
): MobileTick[] {
	const span = railSpan(earliest, now);
	const activeDecade = decadeOf(activeYear);
	const maxBucketCount = Math.max(
		1,
		...bucketCounts(years, span, bucketYears).map((bucket) => bucket.count)
	);
	const counts = new Map(
		bucketCounts(years, span, bucketYears).map((bucket) => [bucket.startYear, bucket.count])
	);
	const out: MobileTick[] = [];

	for (let startYear = span.start; startYear <= span.end; startYear += bucketYears) {
		const count = counts.get(startYear) ?? 0;
		out.push({
			startYear,
			height: count > 0 ? Math.round(Math.sqrt(count / maxBucketCount) * maxTickPx) : 0,
			empty: count === 0,
			warm: startYear < activeDecade + 10 && startYear + bucketYears > activeDecade,
			future: startYear > now
		});
	}

	return out;
}

export function mobileRailLabels(
	earliest: number | null,
	activeYear: number,
	now: number
): RailLabel[] {
	const span = railSpan(earliest, now);
	const activeDecade = decadeOf(activeYear);
	const labels = new Map<number, RailLabel>();

	for (let decade = decadeOf(span.start); decade <= decadeOf(span.end); decade += 20) {
		labels.set(decade, {
			decade,
			text: decadeLabelText(decade),
			frac: thumbFraction(decade, span),
			active: decade === activeDecade
		});
	}

	labels.set(activeDecade, {
		decade: activeDecade,
		text: decadeLabelText(activeDecade),
		frac: thumbFraction(activeDecade, span),
		active: true
	});

	return [...labels.values()].sort((a, b) => a.decade - b.decade);
}

export function thumbFraction(year: number, span: Span): number {
	if (span.end <= span.start) return 0;
	return clamp((year - span.start) / (span.end - span.start), 0, 1);
}

function bucketCounts(
	years: YearCount[],
	span: Span,
	bucketYears: number
): { startYear: number; count: number }[] {
	const buckets = new Map<number, number>();
	for (const year of years) {
		const bucket = span.start + Math.floor((year.year - span.start) / bucketYears) * bucketYears;
		if (bucket >= span.start && bucket <= span.end) {
			buckets.set(bucket, (buckets.get(bucket) ?? 0) + year.count);
		}
	}
	return [...buckets.entries()].map(([startYear, count]) => ({ startYear, count }));
}

function decadeOf(year: number): number {
	return Math.floor(year / 10) * 10;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
