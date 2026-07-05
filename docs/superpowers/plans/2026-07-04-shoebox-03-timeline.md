# Shoebox Phase 03 — Timeline Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Shoebox timeline home — `src/routes/+page.svelte` with the giant YearBand, the CenturyRail decade histogram, a windowed JS masonry grid with month breaks and media cards, decade gradient rooms with 300ms crossfade, the mobile bottom rail, and `?y=1994` deep links — backed by the unfiltered `/api/timeline` fast path.

**Architecture:** All layout math (masonry positions, rail tick scaling, year-from-scroll) lives in pure TypeScript modules under `src/lib/ui/` with Vitest coverage; Svelte 5 components are thin renderers over that math and are smoke-tested with `svelte/server` SSR `render()`. The page composes DecadeRoom (two stacked Gradient layers crossfading per decade) → YearBand → CenturyRail → MasonryGrid (absolute-position windowed masonry, IntersectionObserver year sentinels, cursor-driven infinite scroll) → MobileRail. The server side keeps `/api/timeline` on the `year_counts` fast path and additively includes a per-year distinct-people count for the YearBand sub-line. Filter chips and filtered histograms are Phase 06 work.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM raw `sql` for aggregates, `blurhash` (decode), Vitest (`svelte/server` SSR render for components), Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` §10 "Timeline home" is the gospel for this phase.
**Locked mockups (MUST open and match):**
- Desktop timeline: `docs/superpowers/specs/mockups/timeline-home-locked.html` (top half, the `.v5` block)
- Mobile timeline: `docs/superpowers/specs/mockups/person-and-mobile-locked.html` (the `.mb2` panel)

## Global Constraints

Copied verbatim from `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — every task below implicitly includes these:

- **Node ≥ 22**, pnpm ≥ 9, TypeScript `strict: true`. ESM only.
- **Never use the Inter font.** Serif = Fraunces (roman only — `font-style: italic` is forbidden app-wide). Sans = Archivo. Monospace appears ONLY as grid-thumbnail duration badges.
- **Zero `border-radius`** anywhere. No `backdrop-filter`/glassmorphism. No borders on media. No play-button overlays on thumbnails.
- All UI colors come from `src/lib/ui/tokens.ts` — never hard-code hex in components.
- WCAG AA contrast both themes; `prefers-reduced-motion` honored (all decorative animation gated by the `reducedMotion` store); touch targets ≥ 44px; base font ≥ 16px.
- Every user-facing destructive action = soft delete (`deleted_at`), 30-day trash.
- All API routes validate the session and role server-side (see §Auth). CSRF: SvelteKit form actions' origin check + `SameSite=Lax` cookie.
- Runtime-portable server code: nothing in `src/lib/server/` (outside `platform/node*` files and `worker/`) may import `node:*` modules, `sharp`, `ffmpeg`, or `better-sqlite3`.
- Tests: Vitest for units (`*.test.ts` beside source), Playwright e2e in `e2e/`. Every phase plan ends with its e2e green.
- Commits: conventional (`feat:`, `fix:`, `test:`, `chore:`), small, after each green test cycle.
- Copy rules: triage page is called **Arrivals**; comment placeholder is **"Add a memory…"**; circa dates render as **"c. 1994"**.

Master contracts: `docs/superpowers/plans/2026-07-04-shoebox-00-master.md`

**Phase 03 scope fences (FORBIDDEN in this phase):**
- No player page / `item/[id]` route work (phase 04). Cards link to `/item/<id>?…` but the route may 404 for now — that is expected.
- No search omnibox, filter chips, or filtered `/api/timeline` behavior (phase 06).
- No sprite *generation* (phase 07). This phase builds the hover-scrub component logic and exercises it with a test sprite fixture only.

**Interfaces consumed from Phases 01–02 (exact; if your checkout differs, fix the import line, not the contract):**
- `src/lib/ui/tokens.ts` — master Contract 4 verbatim: `INK`, `CREAM`, `DAWN`, `ACCENTS`, `DECADES`, `paletteFor(year): DecadePalette`, `GRAIN_URI`, `FONT { serif, sans }`, `MOTION { fast: 200, slow: 300 }`, `type DecadePalette`.
- `src/lib/ui/Gradient.svelte` (phase 01) — props `{ palette: DecadePalette }`; renders a full-bleed absolutely-positioned (inset 0) layered gradient + grain, theme-aware via the theme store internally.
- `src/lib/ui/theme.ts` (phase 01) — exports the `reducedMotion` readable store (`Readable<boolean>`, true when the user prefers reduced motion or comfort mode demands it) plus theme/comfort stores.
- `src/lib/types.ts` (phase 02) — exports `ItemDTO` exactly as master Contract 6: `{ id, type, title, description, date: ItemDate, displayDate, shortDate, duration, width, height, status, urls: { poster, thumb400, thumb800, thumb1600, original?, sprite? }, blurhash, people: { id, name, accentColor, age? }[], tags: { id, name, kind }[], albums: { id, title }[], uploadedBy, tapeLabel }`.
- `src/lib/domain/dates.ts` (phase 01) — `sortDate(d: ItemDate): string | null`, `type ItemDate`, per master Contract 5.
- `GET /api/items` (phase 02) — params `year, cursor, limit≤100` → `{ items: ItemDTO[], nextCursor: string | null }`, sorted by `sort_date` ascending within the requested year. Filter params are introduced in Phase 06.
- `GET /api/timeline` (phase 02) — `{ years: { year, count }[], earliest, latest }`; this phase extends each year row additively with `people` for the locked sub-line, but accepts no filter params.
- `/media/[...key]` streaming (phase 02); storage keys `media/<itemId>/<kind>.<ext>` (Contract 7).
- `requireRole(locals, min)` from `src/lib/server/roles.ts`; `locals.db` per master Contract 2.

**Contract ambiguity resolutions made by this plan** (all additive, none contradict the master):
1. `/api/timeline` response gains a `people` field per year: `{ years: { year, count, people }[], earliest, latest }` — needed for the locked sub-line "214 moments · 12 people". Existing consumers ignore the extra field.
2. Timeline reads stay on `year_counts` per Contract 6. Phase 06 adds the filtered branch for people/tags/type/album/q.
3. Month breaks derive only from items with `day`/`month` precision; `year`/`range` (circa) items flow inline without triggering a month header.
4. The mobile ◀ ▶ steppers live in YearBand's mobile variant (top of screen, flanking the serif year — exactly where the locked mobile mockup puts them); MobileRail is the bottom dock (ticks + thumb + labels) only.
5. Mobile rail ticks aggregate 5-year buckets (the locked mockup shows ~24 ticks over 130 years); labels are every-20-year marks plus the active decade in dawn.
6. Item links preserve only the active `?y` context in this phase. Phase 06 extends them with filter context once filter chips exist.
7. Drag commits on pointer-up (drag distance ÷ 90px/year + momentum), with live visual translate during the drag.
8. `?y` scroll-following uses `replaceState` (no load rerun); explicit jumps (band/rail/steppers/keys) use `goto` (load rerun, grid resets to that year).
9. Infinite scroll is forward-only (scrolling down = later months/years); jumping backwards is done via the band/rail.
10. Desktop shows the ◀ ▶ steppers too (spec accessibility section: "visible year stepper buttons (◀ ▶) alongside drag"), styled quiet at the band's far edges; the mockup omits them but the spec's accessibility requirements win.

---

## File Structure

```
src/lib/ui/
├─ rail-math.ts              # NEW  pure: railSpan, railDecades (sqrt ticks), nearestYearWithContent, mobile ticks/labels/thumb
├─ rail-math.test.ts         # NEW
├─ masonry.ts                # NEW  pure: columnCount, buildGridEntries (month breaks + sentinels), layoutMasonry, visibleEntryIds, activeYearFromSentinels
├─ masonry.test.ts           # NEW
├─ card-format.ts            # NEW  pure: formatDuration, thumbSrcset, captionRight, spriteStyle
├─ card-format.test.ts       # NEW
├─ year-drag.ts              # NEW  pure: yearsFromDrag, momentumYears
├─ year-drag.test.ts         # NEW
├─ room.ts                   # NEW  pure: hexToRgb, alpha, chromeVars(palette) → CSS custom props
├─ room.test.ts              # NEW
├─ MonthBreak.svelte         # NEW  eyebrow "June 1994" + big ink "JUNE"
├─ MonthBreak.test.ts        # NEW  (svelte/server SSR render)
├─ MediaCard.svelte          # NEW  thumb+blurhash, caption row, duration badge, scrub seam
├─ MediaCard.test.ts         # NEW
├─ CenturyRail.svelte        # NEW  decade segments of ten ticks
├─ CenturyRail.test.ts       # NEW
├─ YearBand.svelte           # NEW  giant year slider + docked compact bar + mobile steppers
├─ YearBand.test.ts          # NEW
├─ DecadeRoom.svelte         # NEW  two Gradient layers, 300ms crossfade, chrome vars
├─ DecadeRoom.test.ts        # NEW
├─ MasonryGrid.svelte        # NEW  windowed absolute masonry, IO sentinels, endcap
├─ MasonryGrid.test.ts       # NEW
├─ MobileRail.svelte         # NEW  bottom-docked fade rail
├─ MobileRail.test.ts        # NEW
src/lib/server/
├─ aggregates.ts             # MODIFY  add timelineYears(db) with unfiltered people counts
├─ aggregates-timeline.test.ts # NEW   in-memory sqlite integration test
src/routes/
├─ +page.svelte              # MODIFY (replace phase-01 placeholder)  timeline home
├─ +page.ts                  # NEW   universal load: timeline + first items page
├─ api/timeline/+server.ts   # MODIFY  unfiltered timelineYears response
e2e/
├─ helpers/auth.ts           # NEW   owner setup/login → storageState
├─ helpers/seed.ts           # NEW   API upload seeding + direct-DB people/tags/sprite
├─ global-setup.ts           # NEW   wipe e2e/.data, migrate
├─ timeline.spec.ts          # NEW
playwright.config.ts         # MODIFY/CREATE  webServer env for e2e/.data
vite.config.ts               # VERIFY  vitest test block
```

---

### Task 1: Century rail math (`rail-math.ts`)

**Files:**
- Create: `src/lib/ui/rail-math.ts`
- Test: `src/lib/ui/rail-math.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks import these exact names from `./rail-math`):
  - `interface YearCount { year: number; count: number; people: number }`
  - `interface Span { start: number; end: number }`
  - `railSpan(earliest: number | null, now: number): Span`
  - `decadeLabelText(decade: number): string`
  - `railDecades(years: YearCount[], earliest: number | null, activeYear: number, now: number, maxTickPx?: number): RailDecade[]` where `RailDecade = { decade: number; label: string; centuryMark: boolean; active: boolean; future: boolean; ticks: RailTick[] }` and `RailTick = { year: number; height: number; empty: boolean; active: boolean; future: boolean }`
  - `nearestYearWithContent(target: number, years: YearCount[]): number | null`
  - `mobileRailTicks(years: YearCount[], earliest: number | null, activeYear: number, now: number, bucketYears?: number, maxTickPx?: number): MobileTick[]` where `MobileTick = { startYear: number; height: number; empty: boolean; warm: boolean; future: boolean }`
  - `mobileRailLabels(earliest: number | null, activeYear: number, now: number): RailLabel[]` where `RailLabel = { decade: number; text: string; frac: number; active: boolean }`
  - `thumbFraction(year: number, span: Span): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/rail-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	decadeLabelText,
	mobileRailLabels,
	mobileRailTicks,
	nearestYearWithContent,
	railDecades,
	railSpan,
	thumbFraction,
	type YearCount,
} from './rail-math';

const YEARS: YearCount[] = [
	{ year: 1993, count: 1, people: 1 },
	{ year: 1994, count: 4, people: 12 },
];

describe('railSpan', () => {
	it('spans (earliest decade − 1) through the last year of (current decade + 1)', () => {
		expect(railSpan(1972, 2026)).toEqual({ start: 1960, end: 2039 });
		expect(railSpan(1993, 2026)).toEqual({ start: 1980, end: 2039 });
	});
	it('falls back to the current decade when there is no content', () => {
		expect(railSpan(null, 2026)).toEqual({ start: 2010, end: 2039 });
	});
});

describe('decadeLabelText', () => {
	it('century marks render in full, other decades abbreviate', () => {
		expect(decadeLabelText(1900)).toBe('1900');
		expect(decadeLabelText(2000)).toBe('2000');
		expect(decadeLabelText(1910)).toBe("'10");
		expect(decadeLabelText(2030)).toBe("'30");
	});
});

describe('railDecades', () => {
	const decades = railDecades(YEARS, 1993, 1994, 2026, 44);
	it('covers 1980 through 2030 inclusive, ten ticks each', () => {
		expect(decades.map((d) => d.decade)).toEqual([1980, 1990, 2000, 2010, 2020, 2030]);
		expect(decades.every((d) => d.ticks.length === 10)).toBe(true);
	});
	it('scales tick height by sqrt(count) with the max at maxTickPx', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.ticks.find((t) => t.year === 1994)!.height).toBe(44);
		expect(d90.ticks.find((t) => t.year === 1993)!.height).toBe(22);
	});
	it('marks empty years, active year, century marks, active + future decades/years', () => {
		const d90 = decades.find((d) => d.decade === 1990)!;
		expect(d90.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1994)!.active).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.empty).toBe(true);
		expect(d90.ticks.find((t) => t.year === 1995)!.height).toBe(0);
		expect(decades.find((d) => d.decade === 2000)!.centuryMark).toBe(true);
		expect(decades.find((d) => d.decade === 1980)!.centuryMark).toBe(false);
		expect(decades.find((d) => d.decade === 2030)!.future).toBe(true);
		expect(decades.find((d) => d.decade === 2020)!.future).toBe(false);
		expect(decades.find((d) => d.decade === 2020)!.ticks.find((t) => t.year === 2027)!.future).toBe(true);
	});
});

describe('nearestYearWithContent', () => {
	it('returns the closest year that has items (ties go earlier)', () => {
		expect(
			nearestYearWithContent(1960, [
				{ year: 1955, count: 2, people: 0 },
				{ year: 1980, count: 9, people: 0 },
			]),
		).toBe(1955);
		expect(
			nearestYearWithContent(1990, [
				{ year: 1985, count: 1, people: 0 },
				{ year: 1995, count: 1, people: 0 },
			]),
		).toBe(1985);
		expect(nearestYearWithContent(1994, YEARS)).toBe(1994);
	});
	it('returns null when nothing has content', () => {
		expect(nearestYearWithContent(1990, [])).toBeNull();
		expect(nearestYearWithContent(1990, [{ year: 1980, count: 0, people: 0 }])).toBeNull();
	});
});

describe('mobileRailTicks', () => {
	const ticks = mobileRailTicks(YEARS, 1993, 1994, 2026);
	it('buckets the span into 5-year ticks', () => {
		expect(ticks.length).toBe(12); // 1980..2039 in steps of 5
		expect(ticks[0].startYear).toBe(1980);
		expect(ticks.at(-1)!.startYear).toBe(2035);
	});
	it('warms only buckets overlapping the active decade; marks empties and futures', () => {
		expect(ticks.filter((t) => t.warm).map((t) => t.startYear)).toEqual([1990, 1995]);
		expect(ticks.find((t) => t.startYear === 1980)!.empty).toBe(true);
		expect(ticks.find((t) => t.startYear === 1990)!.empty).toBe(false);
		expect(ticks.find((t) => t.startYear === 2030)!.future).toBe(true);
	});
	it('gives the fullest bucket 30px', () => {
		expect(ticks.find((t) => t.startYear === 1990)!.height).toBe(30);
	});
});

describe('mobileRailLabels', () => {
	it('marks every 20 years plus the active decade', () => {
		const labels = mobileRailLabels(1912, 1994, 2026);
		expect(labels.map((l) => l.text)).toEqual(['1900', "'20", "'40", "'60", "'80", "'90", '2000', "'20"]);
		expect(labels.filter((l) => l.active).map((l) => l.decade)).toEqual([1990]);
		expect(labels[0].frac).toBe(0);
	});
});

describe('thumbFraction', () => {
	it('interpolates the year across the span, clamped', () => {
		expect(thumbFraction(1900, { start: 1900, end: 2039 })).toBe(0);
		expect(thumbFraction(2039, { start: 1900, end: 2039 })).toBe(1);
		expect(thumbFraction(1994, { start: 1900, end: 2039 })).toBeCloseTo(0.6763, 4);
		expect(thumbFraction(1850, { start: 1900, end: 2039 })).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/rail-math.test.ts`
Expected: FAIL — `Failed to resolve import "./rail-math"` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/ui/rail-math.ts`:

```ts
/** Pure math for the CenturyRail, YearBand span, and MobileRail. Spec §10. */

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
	height: number; // px; 0 means "render as 2px dot"
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

/** Rail spans (earliest item decade − 1) → last year of (current decade + 1). */
export function railSpan(earliest: number | null, now: number): Span {
	const firstDecade = Math.floor((earliest ?? now) / 10) * 10 - 10;
	const lastDecade = Math.floor(now / 10) * 10 + 10;
	return { start: firstDecade, end: lastDecade + 9 };
}

export function decadeLabelText(decade: number): string {
	return decade % 100 === 0 ? String(decade) : `'${String(decade % 100).padStart(2, '0')}`;
}

export function railDecades(
	years: YearCount[],
	earliest: number | null,
	activeYear: number,
	now: number,
	maxTickPx = 44,
): RailDecade[] {
	const span = railSpan(earliest, now);
	const counts = new Map(years.map((y) => [y.year, y.count]));
	let maxCount = 1;
	for (const y of years) {
		if (y.year >= span.start && y.year <= span.end && y.count > maxCount) maxCount = y.count;
	}
	const activeDecade = Math.floor(activeYear / 10) * 10;
	const decades: RailDecade[] = [];
	for (let decade = span.start; decade <= span.end; decade += 10) {
		const ticks: RailTick[] = [];
		for (let year = decade; year < decade + 10; year++) {
			const count = counts.get(year) ?? 0;
			ticks.push({
				year,
				height: count === 0 ? 0 : Math.max(3, Math.round((maxTickPx * Math.sqrt(count)) / Math.sqrt(maxCount))),
				empty: count === 0,
				active: year === activeYear,
				future: year > now,
			});
		}
		decades.push({
			decade,
			label: decadeLabelText(decade),
			centuryMark: decade % 100 === 0,
			active: decade === activeDecade,
			future: decade > now,
			ticks,
		});
	}
	return decades;
}

export function nearestYearWithContent(target: number, years: YearCount[]): number | null {
	let best: number | null = null;
	let bestDist = Infinity;
	for (const y of years) {
		if (y.count <= 0) continue;
		const dist = Math.abs(y.year - target);
		if (dist < bestDist || (dist === bestDist && best !== null && y.year < best)) {
			best = y.year;
			bestDist = dist;
		}
	}
	return best;
}

export interface MobileTick {
	startYear: number;
	height: number; // px; 0 means "render as 2px dot"
	empty: boolean;
	warm: boolean;
	future: boolean;
}

export function mobileRailTicks(
	years: YearCount[],
	earliest: number | null,
	activeYear: number,
	now: number,
	bucketYears = 5,
	maxTickPx = 30,
): MobileTick[] {
	const span = railSpan(earliest, now);
	const counts = new Map(years.map((y) => [y.year, y.count]));
	const buckets: { startYear: number; count: number }[] = [];
	for (let start = span.start; start <= span.end; start += bucketYears) {
		let count = 0;
		for (let y = start; y < start + bucketYears && y <= span.end; y++) count += counts.get(y) ?? 0;
		buckets.push({ startYear: start, count });
	}
	const maxCount = Math.max(1, ...buckets.map((b) => b.count));
	const activeDecade = Math.floor(activeYear / 10) * 10;
	return buckets.map((b) => ({
		startYear: b.startYear,
		height: b.count === 0 ? 0 : Math.max(3, Math.round((maxTickPx * Math.sqrt(b.count)) / Math.sqrt(maxCount))),
		empty: b.count === 0,
		warm: b.startYear <= activeDecade + 9 && b.startYear + bucketYears - 1 >= activeDecade,
		future: b.startYear > now,
	}));
}

export interface RailLabel {
	decade: number;
	text: string;
	frac: number; // 0..1 across the span
	active: boolean;
}

export function mobileRailLabels(earliest: number | null, activeYear: number, now: number): RailLabel[] {
	const span = railSpan(earliest, now);
	const activeDecade = Math.floor(activeYear / 10) * 10;
	const decades = new Set<number>();
	for (let d = span.start; d <= span.end; d += 10) {
		if (d % 20 === 0) decades.add(d);
	}
	if (activeDecade >= span.start && activeDecade <= span.end) decades.add(activeDecade);
	return [...decades]
		.sort((a, b) => a - b)
		.map((d) => ({
			decade: d,
			text: decadeLabelText(d),
			frac: (d - span.start) / (span.end - span.start),
			active: d === activeDecade,
		}));
}

export function thumbFraction(year: number, span: Span): number {
	return Math.min(1, Math.max(0, (year - span.start) / (span.end - span.start)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/rail-math.test.ts`
Expected: PASS — 7 test groups, all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/rail-math.ts src/lib/ui/rail-math.test.ts
git commit -m "feat: add century rail math for timeline histogram"
```

---

### Task 2: Masonry + grid-entry math (`masonry.ts`)

**Files:**
- Create: `src/lib/ui/masonry.ts`
- Test: `src/lib/ui/masonry.test.ts`

**Interfaces:**
- Consumes: `sortDate`, `type ItemDate` from `../domain/dates` (Contract 5); `type ItemDTO` from `../types` (phase 02).
- Produces (imported by MasonryGrid and the page):
  - `const GAP = 12`, `const CAPTION_H = 24`, `const MONTH_H = 64`
  - `type GridEntry = { kind: 'item'; id: string; item: ItemDTO } | { kind: 'month'; id: string; year: number; month: number } | { kind: 'sentinel'; id: string; year: number }`
  - `columnCount(containerWidth: number): number` (≥1000→4, ≥680→3, else 2)
  - `buildGridEntries(items: ItemDTO[]): GridEntry[]`
  - `layoutMasonry(entries: GridEntry[], containerWidth: number, cols: number, gap?: number): { positions: Map<string, MasonryPosition>; totalHeight: number }` where `MasonryPosition = { x: number; y: number; w: number; h: number }`
  - `visibleEntryIds(positions: Map<string, MasonryPosition>, scrollTop: number, viewportHeight: number, overscreens?: number): Set<string>`
  - `activeYearFromSentinels(sentinels: { year: number; y: number }[], scrollTop: number, offset?: number): number | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/masonry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '../types';
import {
	activeYearFromSentinels,
	buildGridEntries,
	columnCount,
	layoutMasonry,
	visibleEntryIds,
	type GridEntry,
} from './masonry';

function fakeItem(
	id: string,
	dateStart: string,
	dateEnd: string,
	precision: 'day' | 'month' | 'year' | 'range',
	width = 300,
	height = 200,
): ItemDTO {
	return {
		id,
		type: 'photo',
		title: null,
		description: null,
		date: { dateStart, dateEnd, precision },
		displayDate: '',
		shortDate: '',
		duration: null,
		width,
		height,
		status: 'ready',
		urls: {
			poster: `/media/media/${id}/poster.webp`,
			thumb400: `/media/media/${id}/thumb_400.webp`,
			thumb800: `/media/media/${id}/thumb_800.webp`,
			thumb1600: `/media/media/${id}/thumb_1600.webp`,
		},
		blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
		people: [],
		tags: [],
		albums: [],
		uploadedBy: 'u1',
		tapeLabel: null,
	} as unknown as ItemDTO;
}

describe('columnCount', () => {
	it('is 4 desktop / 3 tablet / 2 mobile', () => {
		expect(columnCount(1200)).toBe(4);
		expect(columnCount(1000)).toBe(4);
		expect(columnCount(999)).toBe(3);
		expect(columnCount(680)).toBe(3);
		expect(columnCount(679)).toBe(2);
		expect(columnCount(0)).toBe(2);
	});
});

describe('buildGridEntries', () => {
	it('inserts year sentinels and month breaks (day/month precision only)', () => {
		const items = [
			fakeItem('A', '1994-06-14', '1994-06-14', 'day'),
			fakeItem('B', '1994-06-21', '1994-06-21', 'day'),
			fakeItem('C', '1994-01-01', '1994-12-31', 'year'), // circa — no month break
			fakeItem('D', '1994-08-05', '1994-08-05', 'day'),
			fakeItem('E', '1995-02-01', '1995-02-01', 'day'),
		];
		const kinds = buildGridEntries(items).map((e) => `${e.kind}:${e.id}`);
		expect(kinds).toEqual([
			'sentinel:s-1994',
			'month:m-1994-6',
			'item:A',
			'item:B',
			'item:C',
			'month:m-1994-8',
			'item:D',
			'sentinel:s-1995',
			'month:m-1995-2',
			'item:E',
		]);
	});
});

describe('layoutMasonry', () => {
	it('places entries into the shortest column with sqrt-free deterministic math', () => {
		const entries: GridEntry[] = [
			{ kind: 'sentinel', id: 's-1994', year: 1994 },
			{ kind: 'month', id: 'm-1994-6', year: 1994, month: 6 },
			{ kind: 'item', id: 'A', item: fakeItem('A', '1994-06-14', '1994-06-14', 'day', 300, 200) },
			{ kind: 'item', id: 'B', item: fakeItem('B', '1994-06-14', '1994-06-14', 'day', 300, 400) },
			{ kind: 'item', id: 'C', item: fakeItem('C', '1994-06-21', '1994-06-21', 'day', 300, 300) },
			{ kind: 'item', id: 'D', item: fakeItem('D', '1994-06-22', '1994-06-22', 'day', 300, 150) },
			{ kind: 'item', id: 'E', item: fakeItem('E', '1994-06-23', '1994-06-23', 'day', 300, 250) },
		];
		const { positions, totalHeight } = layoutMasonry(entries, 1012, 4, 12);
		// colW = (1012 − 3·12) / 4 = 244; card h = round(244·ih/iw) + 24; month h = 64
		expect(positions.get('s-1994')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
		expect(positions.get('m-1994-6')).toEqual({ x: 0, y: 0, w: 244, h: 64 });
		expect(positions.get('A')).toEqual({ x: 256, y: 0, w: 244, h: 187 });
		expect(positions.get('B')).toEqual({ x: 512, y: 0, w: 244, h: 349 });
		expect(positions.get('C')).toEqual({ x: 768, y: 0, w: 244, h: 268 });
		expect(positions.get('D')).toEqual({ x: 0, y: 76, w: 244, h: 146 });
		expect(positions.get('E')).toEqual({ x: 256, y: 199, w: 244, h: 227 });
		expect(totalHeight).toBe(426); // tallest column (E: 199+227+12) − trailing gap
	});
});

describe('visibleEntryIds', () => {
	it('windows to viewport ± overscreens screens and skips sentinels', () => {
		const positions = new Map([
			['near', { x: 0, y: 0, w: 100, h: 200 }],
			['mid', { x: 0, y: 2000, w: 100, h: 200 }],
			['far', { x: 0, y: 3000, w: 100, h: 200 }],
			['s-1994', { x: 0, y: 0, w: 0, h: 0 }],
		]);
		const ids = visibleEntryIds(positions, 0, 800, 2);
		expect(ids.has('near')).toBe(true);
		expect(ids.has('mid')).toBe(true); // 2000 < 0 + 800·3
		expect(ids.has('far')).toBe(false);
		expect(ids.has('s-1994')).toBe(false);
	});
});

describe('activeYearFromSentinels', () => {
	const sents = [
		{ year: 1993, y: 0 },
		{ year: 1994, y: 1200 },
		{ year: 1995, y: 2600 },
	];
	it('picks the last sentinel above scrollTop + offset', () => {
		expect(activeYearFromSentinels(sents, 0)).toBe(1993);
		expect(activeYearFromSentinels(sents, 1100, 240)).toBe(1994);
		expect(activeYearFromSentinels(sents, 3000)).toBe(1995);
		expect(activeYearFromSentinels([], 0)).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/masonry.test.ts`
Expected: FAIL — `Failed to resolve import "./masonry"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ui/masonry.ts`:

```ts
/** Pure masonry layout math — CSS-columns-free, deterministic, windowable. Spec §10. */
import { sortDate } from '../domain/dates';
import type { ItemDTO } from '../types';

export const GAP = 12;
export const CAPTION_H = 24; // must match .cap height in MediaCard.svelte
export const MONTH_H = 64; // must match .month height in MonthBreak.svelte

export type GridEntry =
	| { kind: 'item'; id: string; item: ItemDTO }
	| { kind: 'month'; id: string; year: number; month: number }
	| { kind: 'sentinel'; id: string; year: number };

export function columnCount(containerWidth: number): number {
	if (containerWidth >= 1000) return 4;
	if (containerWidth >= 680) return 3;
	return 2;
}

/**
 * Items must already be sorted by sort_date ascending (the /api/items contract).
 * Emits a zero-size year sentinel at each year boundary and a month break when
 * the month changes — but only day/month-precision items advance months;
 * circa (year/range) items flow inline (locked decision).
 */
export function buildGridEntries(items: ItemDTO[]): GridEntry[] {
	const entries: GridEntry[] = [];
	let lastYear: number | null = null;
	let lastMonthKey: string | null = null;
	for (const item of items) {
		const iso = sortDate(item.date);
		if (!iso) continue;
		const year = Number(iso.slice(0, 4));
		const month = Number(iso.slice(5, 7));
		if (year !== lastYear) {
			entries.push({ kind: 'sentinel', id: `s-${year}`, year });
			lastYear = year;
			lastMonthKey = null;
		}
		if (item.date.precision === 'day' || item.date.precision === 'month') {
			const key = `${year}-${month}`;
			if (key !== lastMonthKey) {
				entries.push({ kind: 'month', id: `m-${key}`, year, month });
				lastMonthKey = key;
			}
		}
		entries.push({ kind: 'item', id: item.id, item });
	}
	return entries;
}

export interface MasonryPosition {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function layoutMasonry(
	entries: GridEntry[],
	containerWidth: number,
	cols: number,
	gap = GAP,
): { positions: Map<string, MasonryPosition>; totalHeight: number } {
	const positions = new Map<string, MasonryPosition>();
	const colW = (containerWidth - gap * (cols - 1)) / cols;
	const heights = new Array<number>(cols).fill(0);
	for (const e of entries) {
		if (e.kind === 'sentinel') {
			positions.set(e.id, { x: 0, y: Math.min(...heights), w: 0, h: 0 });
			continue;
		}
		const col = heights.indexOf(Math.min(...heights));
		const h = e.kind === 'month' ? MONTH_H : Math.round((colW * e.item.height) / e.item.width) + CAPTION_H;
		positions.set(e.id, { x: col * (colW + gap), y: heights[col], w: colW, h });
		heights[col] += h + gap;
	}
	const max = Math.max(0, ...heights);
	return { positions, totalHeight: max > 0 ? max - gap : 0 };
}

/** Windowed rendering: only entries within viewport ± `overscreens` screens. */
export function visibleEntryIds(
	positions: Map<string, MasonryPosition>,
	scrollTop: number,
	viewportHeight: number,
	overscreens = 2,
): Set<string> {
	const top = scrollTop - viewportHeight * overscreens;
	const bottom = scrollTop + viewportHeight * (overscreens + 1);
	const ids = new Set<string>();
	for (const [id, p] of positions) {
		if (p.h === 0 && p.w === 0) continue; // sentinels render separately
		if (p.y < bottom && p.y + p.h > top) ids.add(id);
	}
	return ids;
}

/** Year-from-scroll derivation: last sentinel whose y is above scrollTop + offset. */
export function activeYearFromSentinels(
	sentinels: { year: number; y: number }[],
	scrollTop: number,
	offset = 240,
): number | null {
	if (sentinels.length === 0) return null;
	const sorted = [...sentinels].sort((a, b) => a.y - b.y);
	let active = sorted[0].year;
	for (const s of sorted) {
		if (s.y <= scrollTop + offset) active = s.year;
	}
	return active;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/masonry.test.ts`
Expected: PASS (5 describes). If `buildGridEntries` fails on `sortDate`, check that `src/lib/domain/dates.ts` exports `sortDate` per Contract 5 — do not reimplement it here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/masonry.ts src/lib/ui/masonry.test.ts
git commit -m "feat: add masonry layout and grid entry math"
```

---

### Task 3: Card format + year drag helpers

**Files:**
- Create: `src/lib/ui/card-format.ts`, `src/lib/ui/year-drag.ts`
- Test: `src/lib/ui/card-format.test.ts`, `src/lib/ui/year-drag.test.ts`

**Interfaces:**
- Consumes: `type ItemDTO` from `../types`.
- Produces:
  - `formatDuration(seconds: number): string` → `"0:42"`, `"1:15"`
  - `thumbSrcset(urls: ItemDTO['urls']): string`
  - `captionRight(item: Pick<ItemDTO, 'people' | 'title'>): string`
  - `SPRITE_COLS = 10`, `SPRITE_ROWS = 10`, `SPRITE_FRAMES = 100`
  - `spriteStyle(fraction: number): { backgroundPosition: string; backgroundSize: string }`
  - `PX_PER_YEAR = 90`, `yearsFromDrag(deltaPx: number, pxPerYear?: number): number`, `momentumYears(velocityPxPerMs: number, pxPerYear?: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ui/card-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { captionRight, formatDuration, spriteStyle, thumbSrcset } from './card-format';

describe('formatDuration', () => {
	it('formats m:ss', () => {
		expect(formatDuration(42)).toBe('0:42');
		expect(formatDuration(75)).toBe('1:15');
		expect(formatDuration(600)).toBe('10:00');
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(41.6)).toBe('0:42');
	});
});

describe('thumbSrcset', () => {
	it('offers 400w and 800w', () => {
		expect(
			thumbSrcset({
				poster: '/m/p.webp',
				thumb400: '/m/t4.webp',
				thumb800: '/m/t8.webp',
				thumb1600: '/m/t16.webp',
			}),
		).toBe('/m/t4.webp 400w, /m/t8.webp 800w');
	});
});

describe('captionRight', () => {
	const p = (id: string, name: string) => ({ id, name, accentColor: '#FA7B62' });
	it('joins up to two people with a middle dot, then +N', () => {
		expect(captionRight({ people: [p('1', 'Dad'), p('2', 'Eric')], title: 'x' })).toBe('Dad · Eric');
		expect(captionRight({ people: [p('1', 'Dad'), p('2', 'Eric'), p('3', 'Mom')], title: 'x' })).toBe('Dad · Eric +1');
	});
	it('falls back to the title, then empty', () => {
		expect(captionRight({ people: [], title: "Eric's birthday" })).toBe("Eric's birthday");
		expect(captionRight({ people: [], title: null })).toBe('');
	});
});

describe('spriteStyle', () => {
	it('maps a 0..1 fraction onto a 10×10 sprite grid', () => {
		expect(spriteStyle(0)).toEqual({ backgroundPosition: '0.0000% 0.0000%', backgroundSize: '1000% 1000%' });
		expect(spriteStyle(0.5).backgroundPosition).toBe('0.0000% 55.5556%'); // frame 50 → col 0, row 5
		expect(spriteStyle(1).backgroundPosition).toBe('100.0000% 100.0000%'); // clamped to frame 99
		expect(spriteStyle(-1).backgroundPosition).toBe('0.0000% 0.0000%');
	});
});
```

Create `src/lib/ui/year-drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { momentumYears, yearsFromDrag } from './year-drag';

describe('yearsFromDrag', () => {
	it('converts drag distance to whole years (drag left = forward in time)', () => {
		expect(yearsFromDrag(-180)).toBe(2);
		expect(yearsFromDrag(-90)).toBe(1);
		expect(yearsFromDrag(89)).toBe(0);
		expect(yearsFromDrag(-89)).toBe(0);
		expect(yearsFromDrag(200)).toBe(-2);
	});
});

describe('momentumYears', () => {
	it('ignores slow releases, adds capped extra years for flicks', () => {
		expect(momentumYears(0.2)).toBe(0);
		expect(momentumYears(-0.2)).toBe(0);
		expect(momentumYears(-1)).toBe(2); // fast left flick → forward
		expect(momentumYears(0.5)).toBe(-1);
		expect(momentumYears(3)).toBe(-6); // clamped
		expect(momentumYears(-9)).toBe(6); // clamped
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/ui/card-format.test.ts src/lib/ui/year-drag.test.ts`
Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Write the implementations**

Create `src/lib/ui/card-format.ts`:

```ts
/** Pure formatting helpers for MediaCard. Spec §10 caption/badge rules. */
import type { ItemDTO } from '../types';

export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function thumbSrcset(urls: ItemDTO['urls']): string {
	return `${urls.thumb400} 400w, ${urls.thumb800} 800w`;
}

/** Caption right cell: up to two people "Dad · Eric" (+N overflow), else title, else ''. */
export function captionRight(item: Pick<ItemDTO, 'people' | 'title'>): string {
	if (item.people.length > 0) {
		const names = item.people.slice(0, 2).map((p) => p.name).join(' · ');
		return item.people.length > 2 ? `${names} +${item.people.length - 2}` : names;
	}
	return item.title ?? '';
}

/** Contract 7: sprite is a 10×10 grid of 160×90 frames. */
export const SPRITE_COLS = 10;
export const SPRITE_ROWS = 10;
export const SPRITE_FRAMES = SPRITE_COLS * SPRITE_ROWS;

export function spriteStyle(fraction: number): { backgroundPosition: string; backgroundSize: string } {
	const f = Math.min(1, Math.max(0, fraction));
	const idx = Math.min(SPRITE_FRAMES - 1, Math.floor(f * SPRITE_FRAMES));
	const col = idx % SPRITE_COLS;
	const row = Math.floor(idx / SPRITE_COLS);
	const pct = (n: number, cells: number) => `${((n * 100) / (cells - 1)).toFixed(4)}%`;
	return {
		backgroundPosition: `${pct(col, SPRITE_COLS)} ${pct(row, SPRITE_ROWS)}`,
		backgroundSize: `${SPRITE_COLS * 100}% ${SPRITE_ROWS * 100}%`,
	};
}
```

Create `src/lib/ui/year-drag.ts`:

```ts
/** Drag/momentum math for YearBand. Dragging left pulls later years in. */

export const PX_PER_YEAR = 90;

export function yearsFromDrag(deltaPx: number, pxPerYear = PX_PER_YEAR): number {
	const n = Math.trunc(deltaPx / pxPerYear);
	return n === 0 ? 0 : -n;
}

/** velocity in px/ms at release; < 0.25 px/ms is not a flick. Result clamped ±6. */
export function momentumYears(velocityPxPerMs: number, pxPerYear = PX_PER_YEAR): number {
	if (Math.abs(velocityPxPerMs) < 0.25) return 0;
	const extra = -Math.round((velocityPxPerMs * 220) / pxPerYear);
	return Math.max(-6, Math.min(6, extra));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/ui/card-format.test.ts src/lib/ui/year-drag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/card-format.ts src/lib/ui/card-format.test.ts src/lib/ui/year-drag.ts src/lib/ui/year-drag.test.ts
git commit -m "feat: add media card format and year drag helpers"
```

---

### Task 4: Unfiltered `/api/timeline` people counts (`timelineYears`)

**Files:**
- Modify: `src/lib/server/aggregates.ts` (append; keep phase 02 year_counts maintenance functions untouched)
- Modify: `src/routes/api/timeline/+server.ts` (preserve Contract 6 response shape, add `people` per year)
- Test: `src/lib/server/aggregates-timeline.test.ts`

**Interfaces:**
- Consumes: Drizzle schema from `$lib/server/db/schema` (Contract 1); `requireRole` from `$lib/server/roles`; `locals.db` (Contract 2).
- Produces:
  - `interface TimelineYearRow { year: number; count: number; people: number }`
  - `interface TimelineResult { years: TimelineYearRow[]; earliest: number | null; latest: number | null }`
  - `timelineYears(db): Promise<TimelineResult>`
  - HTTP: `GET /api/timeline` -> `TimelineResult` JSON. It accepts no filter params in this phase; Phase 06 adds filtered histograms.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/aggregates-timeline.test.ts` with an in-memory SQLite database. Seed `items`, `item_people`, and `year_counts`, then assert:
- unfiltered counts come from `year_counts`;
- `people` is the distinct person count per year among ready, non-deleted, dated items;
- `processing`, `needs_review`, deleted, and undated items do not contribute to `people`;
- empty archives return `{ years: [], earliest: null, latest: null }`.

Run: `pnpm vitest run src/lib/server/aggregates-timeline.test.ts`
Expected: FAIL — `timelineYears` is not exported from `./aggregates`.

- [ ] **Step 2: Implement `timelineYears`**

Append the unfiltered implementation to `src/lib/server/aggregates.ts`. The `count` column must be derived only from `year_counts`; do not scan `items` for counts in this phase. Compute `people` live because `year_counts` has no people dimension.

- [ ] **Step 3: Replace `src/routes/api/timeline/+server.ts`**

The handler must call `requireRole(locals, 'user')`, ignore any filter query params, call `timelineYears(locals.db)`, and return JSON. Leave a short code comment that Phase 06 adds filtered histogram support.

- [ ] **Step 4: Run and commit**

Run: `pnpm check && pnpm vitest run src/lib/server/aggregates-timeline.test.ts`
Expected: 0 errors; timeline aggregate test passes.

```bash
git add src/lib/server/aggregates.ts src/lib/server/aggregates-timeline.test.ts src/routes/api/timeline/+server.ts
git commit -m "feat: add unfiltered timeline aggregate with people counts"
```

---

### Task 5: MonthBreak component (+ SSR component-test harness)

**Files:**
- Verify/Modify: `vite.config.ts`
- Create: `src/lib/ui/MonthBreak.svelte`
- Test: `src/lib/ui/MonthBreak.test.ts`

**Interfaces:**
- Consumes: `FONT` from `./tokens`; chrome CSS vars `--chrome`, `--chrome-full` (set by DecadeRoom, Task 9; safe fallbacks used standalone).
- Produces: `<MonthBreak year={1994} month={6} />` — props `{ year: number; month: number }` (month is 1-based). Fixed rendered height 64px = `MONTH_H`.

- [ ] **Step 1: Ensure Vitest compiles Svelte components**

Open `vite.config.ts`. It must run tests through the SvelteKit plugin with a node environment. If the `test` block is missing, make the file:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
```

Keep any additional settings phases 01–02 added; only the `plugins: [sveltekit()]` and the `test` block above are required.

- [ ] **Step 2: Write the failing test**

Create `src/lib/ui/MonthBreak.test.ts`:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MonthBreak from './MonthBreak.svelte';

describe('MonthBreak', () => {
	it('renders the sans-caps eyebrow and the big month name', () => {
		const { body } = render(MonthBreak, { props: { year: 1994, month: 6 } });
		expect(body).toContain('June 1994');
		expect(body).toContain('JUNE');
		expect(body).toContain('data-testid="month-break"');
	});
	it('handles every month index', () => {
		const { body } = render(MonthBreak, { props: { year: 2001, month: 12 } });
		expect(body).toContain('December 2001');
		expect(body).toContain('DECEMBER');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/MonthBreak.test.ts`
Expected: FAIL — cannot resolve `./MonthBreak.svelte`.

- [ ] **Step 4: Write the component**

Create `src/lib/ui/MonthBreak.svelte`:

```svelte
<script lang="ts">
	import { FONT } from './tokens';

	const NAMES = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	];

	let { year, month }: { year: number; month: number } = $props();

	const name = $derived(NAMES[month - 1] ?? '');
</script>

<div class="month" data-testid="month-break" style:--sans={FONT.sans}>
	<span class="eyebrow">{name} {year}</span>
	<h4>{name.toUpperCase()}</h4>
</div>

<style>
	/* Height MUST stay 64px — masonry.ts MONTH_H depends on it. No rules, no borders. */
	.month {
		height: 64px;
		box-sizing: border-box;
		padding-top: 10px;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 4px;
		font-family: var(--sans, sans-serif);
	}
	.eyebrow {
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--chrome, currentColor);
	}
	h4 {
		margin: 0;
		font-size: 30px;
		font-weight: 800;
		letter-spacing: 0.02em;
		line-height: 1;
		color: var(--chrome-full, currentColor);
	}
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/MonthBreak.test.ts`
Expected: PASS. Then `pnpm check` — 0 errors.

- [ ] **Step 6: Structural verification vs locked mockup**

Compare the component code against `timeline-home-locked.html` `.v5 .month` (lines 41–43):
- Eyebrow "June 1994": ~10px, letterspacing 0.2em, uppercase, muted chrome ink — ✓ small sans caps (sans, NOT monospace — master allows mono only on duration badges).
- Big month "JUNE": 30px, weight 800, full-ink color, letterspacing 0.02em, no rules/hairlines above or below.
- It flows as a grid cell (no background, no border, sharp corners).

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts src/lib/ui/MonthBreak.svelte src/lib/ui/MonthBreak.test.ts
git commit -m "feat: add MonthBreak grid typography component"
```

---

### Task 6: MediaCard component

**Files:**
- Create: `src/lib/ui/MediaCard.svelte`
- Test: `src/lib/ui/MediaCard.test.ts`

**Interfaces:**
- Consumes: `formatDuration`, `thumbSrcset`, `captionRight`, `spriteStyle` from `./card-format`; `INK`, `CREAM`, `MOTION` from `./tokens`; `reducedMotion` from `./theme`; `decode` from `blurhash`; `type ItemDTO` from `../types`.
- Produces: `<MediaCard item={ItemDTO} href={string} />` — the card root is the `<a data-testid="media-card">`; fills its parent box (MasonryGrid sets explicit width/height); caption row is exactly 24px (`CAPTION_H`); hover-scrub shows `data-testid="scrub-hairline"` when `item.urls.sprite` exists.

- [ ] **Step 1: Ensure the blurhash dependency exists**

Run: `pnpm add blurhash`
Expected: already present from phase 02 (no-op version bump refusal is fine) or freshly added. Either way `blurhash` ends up in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `src/lib/ui/MediaCard.test.ts`:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '../types';
import MediaCard from './MediaCard.svelte';

function fakeItem(overrides: Record<string, unknown> = {}): ItemDTO {
	return {
		id: 'it1',
		type: 'video',
		title: "Eric's birthday",
		description: null,
		date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
		displayDate: 'June 14, 1994',
		shortDate: 'Jun 14',
		duration: 42,
		width: 300,
		height: 220,
		status: 'ready',
		urls: {
			poster: '/media/media/it1/poster.webp',
			thumb400: '/media/media/it1/thumb_400.webp',
			thumb800: '/media/media/it1/thumb_800.webp',
			thumb1600: '/media/media/it1/thumb_1600.webp',
		},
		blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
		people: [
			{ id: 'p1', name: 'Dad', accentColor: '#FFD9A8' },
			{ id: 'p2', name: 'Eric', accentColor: '#FA7B62' },
		],
		tags: [],
		albums: [],
		uploadedBy: 'u1',
		tapeLabel: null,
		...overrides,
	} as unknown as ItemDTO;
}

describe('MediaCard', () => {
	it('renders thumb srcset, duration badge, and the caption row', () => {
		const { body } = render(MediaCard, { props: { item: fakeItem(), href: '/item/it1?y=1994' } });
		expect(body).toContain('data-testid="media-card"');
		expect(body).toContain('href="/item/it1?y=1994"');
		expect(body).toContain('/media/media/it1/thumb_400.webp 400w, /media/media/it1/thumb_800.webp 800w');
		expect(body).toContain('0:42');
		expect(body).toContain('Jun 14');
		expect(body).toContain('Dad · Eric');
	});
	it('shows circa short dates and falls back to title captions', () => {
		const { body } = render(MediaCard, {
			props: {
				item: fakeItem({ type: 'photo', duration: null, shortDate: 'c. 1994', people: [], title: 'Lake house' }),
				href: '/item/it1',
			},
		});
		expect(body).toContain('c. 1994');
		expect(body).toContain('Lake house');
		expect(body).not.toContain('0:42');
	});
	it('has no scrub hairline until a pointer moves (and none without a sprite)', () => {
		const { body } = render(MediaCard, { props: { item: fakeItem(), href: '/x' } });
		expect(body).not.toContain('scrub-hairline');
	});
	it('uses alt text from title, falling back to the display date', () => {
		const { body } = render(MediaCard, { props: { item: fakeItem({ title: null }), href: '/x' } });
		expect(body).toContain('alt="June 14, 1994"');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/MediaCard.test.ts`
Expected: FAIL — cannot resolve `./MediaCard.svelte`.

- [ ] **Step 4: Write the component**

Create `src/lib/ui/MediaCard.svelte`:

```svelte
<script lang="ts">
	import { decode } from 'blurhash';
	import { onMount } from 'svelte';
	import type { ItemDTO } from '../types';
	import { captionRight, formatDuration, spriteStyle, thumbSrcset } from './card-format';
	import { reducedMotion } from './theme';
	import { CREAM, INK, MOTION } from './tokens';

	let { item, href }: { item: ItemDTO; href: string } = $props();

	let loaded = $state(false);
	let canvas: HTMLCanvasElement | undefined = $state();
	let mediaEl: HTMLDivElement | undefined = $state();
	let scrubFrac = $state<number | null>(null);

	const canScrub = $derived(Boolean(item.urls.sprite));
	const sprite = $derived(scrubFrac !== null && canScrub ? spriteStyle(scrubFrac) : null);

	onMount(() => {
		if (canvas && item.blurhash) {
			try {
				const pixels = decode(item.blurhash, 32, 32);
				const ctx = canvas.getContext('2d');
				if (ctx) {
					const img = ctx.createImageData(32, 32);
					img.data.set(pixels);
					ctx.putImageData(img, 0, 0);
				}
			} catch {
				// bad blurhash → keep the empty placeholder; the real thumb still loads
			}
		}
	});

	// Hover-scrub SEAM (spec §10): sprite files start existing in phase 07;
	// the logic ships now and lights up whenever item.urls.sprite is present.
	function onScrubMove(e: PointerEvent) {
		if (!canScrub || e.pointerType !== 'mouse' || !mediaEl) return;
		const r = mediaEl.getBoundingClientRect();
		scrubFrac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	}
</script>

<a
	class="card"
	{href}
	data-testid="media-card"
	style:--ink={INK}
	style:--cream={CREAM}
	style:--fade={`${MOTION.fast}ms`}
>
	<div class="media" bind:this={mediaEl} onpointermove={onScrubMove} onpointerleave={() => (scrubFrac = null)}>
		<canvas class="ph" width="32" height="32" bind:this={canvas} aria-hidden="true"></canvas>
		<img
			src={item.urls.thumb400}
			srcset={thumbSrcset(item.urls)}
			sizes="(max-width: 640px) 46vw, (max-width: 1000px) 30vw, 23vw"
			alt={item.title ?? item.displayDate}
			loading="lazy"
			class:loaded
			class:instant={$reducedMotion}
			onload={() => (loaded = true)}
		/>
		{#if sprite}
			<div
				class="sprite"
				style:background-image={`url(${item.urls.sprite})`}
				style:background-size={sprite.backgroundSize}
				style:background-position={sprite.backgroundPosition}
			></div>
			<span class="hairline" data-testid="scrub-hairline" style:width={`${(scrubFrac ?? 0) * 100}%`}></span>
		{/if}
		{#if item.type === 'video' && item.duration != null}
			<span class="dur">{formatDuration(item.duration)}</span>
		{/if}
	</div>
	<div class="cap">
		<span class="when">{item.shortDate}</span>
		<span class="who">{captionRight(item)}</span>
	</div>
</a>

<style>
	/* Non-negotiables: zero radius, no borders, no shadows on media, no play overlay. */
	.card {
		display: flex;
		flex-direction: column;
		height: 100%;
		text-decoration: none;
		color: inherit;
	}
	.media {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.ph {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		opacity: 0;
		transition: opacity var(--fade) ease;
	}
	img.loaded {
		opacity: 1;
	}
	img.instant {
		transition: none;
	}
	.sprite {
		position: absolute;
		inset: 0;
		background-repeat: no-repeat;
	}
	.hairline {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: var(--cream);
	}
	/* The ONLY permitted monospace in the app: tiny duration badge. */
	.dur {
		position: absolute;
		right: 8px;
		bottom: 8px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 10px;
		color: var(--cream);
		text-shadow: 0 1px 6px color-mix(in srgb, var(--ink) 80%, transparent);
	}
	/* Height MUST stay 24px — masonry.ts CAPTION_H depends on it. */
	.cap {
		height: 24px;
		box-sizing: border-box;
		padding-top: 6px;
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-family: var(--sans, sans-serif);
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.when {
		color: var(--chrome-caption, currentColor);
		white-space: nowrap;
	}
	.who {
		color: var(--chrome-caption-dim, currentColor);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/MediaCard.test.ts`
Expected: PASS (4 tests). Then `pnpm check` — 0 errors.

- [ ] **Step 6: Structural verification vs locked mockup**

Compare against `timeline-home-locked.html` `.v5 .cell/.cap/.dur` (lines 36–44):
- Image: full-bleed, `display:block`-equivalent, zero radius, no border, no shadow, no play-button overlay.
- Duration badge: monospace 10px, cream, bottom-right 8px inset, soft ink text-shadow — videos only.
- Caption row under the media: left = shortDate ("Jun 14" / "c. 1994"), right = people ("Dad · Eric") or event/title, both small caps at reduced ink opacity (`--chrome-caption` ≈ .78, `--chrome-caption-dim` ≈ .55), justify space-between, 6px top padding.
- Blurhash canvas sits under the image; image fades in 200ms (`MOTION.fast`), fade disabled when `reducedMotion`.
- Scrub hairline: 2px cream line at the media's bottom edge, width = pointer fraction; sprite frame steps on pointermove (mouse only). Click anywhere = navigate (the whole card is the link) — no hover-only functionality is load-bearing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/MediaCard.svelte src/lib/ui/MediaCard.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add MediaCard with blurhash, captions and scrub seam"
```

---

### Task 7: CenturyRail component

**Files:**
- Create: `src/lib/ui/CenturyRail.svelte`
- Test: `src/lib/ui/CenturyRail.test.ts`

**Interfaces:**
- Consumes: `railDecades`, `nearestYearWithContent`, `type YearCount` from `./rail-math`; `FONT` from `./tokens`; chrome vars from DecadeRoom.
- Produces: `<CenturyRail years earliest activeYear now? compact? onselect />` — props `{ years: YearCount[]; earliest: number | null; activeYear: number; now?: number; compact?: boolean; onselect: (year: number) => void }`. `compact` renders 20px ticks and no label row (used by the docked band). Hidden below 640px (MobileRail replaces it).

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/CenturyRail.test.ts`:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { YearCount } from './rail-math';
import CenturyRail from './CenturyRail.svelte';

const YEARS: YearCount[] = [
	{ year: 1993, count: 1, people: 1 },
	{ year: 1994, count: 4, people: 12 },
];
const noop = () => {};

describe('CenturyRail', () => {
	it('renders one tick per year across the span with decade labels', () => {
		const { body } = render(CenturyRail, {
			props: { years: YEARS, earliest: 1993, activeYear: 1994, now: 2026, onselect: noop },
		});
		// span 1980..2039 → 6 decades × 10 ticks
		expect(body.match(/title="(19|20)\d\d"/g)?.length).toBe(60);
		expect(body).toContain('data-testid="century-rail"');
		expect(body).toContain('2000'); // century mark label
		expect(body).toContain("'90");
		expect(body).toContain('Jump to the 1990s');
	});
	it('compact mode drops the label row', () => {
		const { body } = render(CenturyRail, {
			props: { years: YEARS, earliest: 1993, activeYear: 1994, now: 2026, compact: true, onselect: noop },
		});
		expect(body).not.toContain('Jump to the 1990s');
		expect(body.match(/title="(19|20)\d\d"/g)?.length).toBe(60);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/CenturyRail.test.ts`
Expected: FAIL — cannot resolve `./CenturyRail.svelte`.

- [ ] **Step 3: Write the component**

Create `src/lib/ui/CenturyRail.svelte`:

```svelte
<script lang="ts">
	import { nearestYearWithContent, railDecades, type YearCount } from './rail-math';
	import { FONT } from './tokens';

	let {
		years,
		earliest,
		activeYear,
		now = new Date().getFullYear(),
		compact = false,
		onselect,
	}: {
		years: YearCount[];
		earliest: number | null;
		activeYear: number;
		now?: number;
		compact?: boolean;
		onselect: (year: number) => void;
	} = $props();

	const decades = $derived(railDecades(years, earliest, activeYear, now, compact ? 20 : 44));

	// Tap a tick → that year; empty tick → nearest year with content.
	function pickYear(year: number, empty: boolean) {
		if (!empty) return onselect(year);
		onselect(nearestYearWithContent(year, years) ?? year);
	}

	// Tap a decade label → nearest year with content to that decade's middle.
	function pickDecade(decade: number) {
		onselect(nearestYearWithContent(decade + 4, years) ?? decade);
	}
</script>

<!-- The rail duplicates YearBand's slider for pointer users; keyboard/AT use the
     band (role=slider). Ticks are pointer-only and hidden from the a11y tree;
     the decade label buttons remain focusable jumps. -->
<div class="band" class:compact data-testid="century-rail" style:--sans={FONT.sans}>
	<div class="century" aria-hidden="true">
		{#each decades as dec (dec.decade)}
			<div class="dec" class:future={dec.future}>
				{#each dec.ticks as tick (tick.year)}
					<button
						class="tick"
						class:dot={tick.empty}
						class:cur={tick.active}
						style:height={tick.empty ? '2px' : `${tick.height}px`}
						title={String(tick.year)}
						tabindex="-1"
						onclick={() => pickYear(tick.year, tick.empty)}
					></button>
				{/each}
			</div>
		{/each}
	</div>
	{#if !compact}
		<div class="declabels">
			{#each decades as dec (dec.decade)}
				<button
					class="dlabel"
					class:century-mark={dec.centuryMark}
					class:on={dec.active}
					aria-label={`Jump to the ${dec.decade}s`}
					onclick={() => pickDecade(dec.decade)}
				>{dec.label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* NO horizontal rules/bars anywhere — structure comes from tick weight alone (locked). */
	.band {
		padding: 0 30px;
	}
	.century {
		display: flex;
		align-items: flex-end;
		height: 44px;
	}
	.compact .century {
		height: 20px;
	}
	.dec {
		flex: 1;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		padding: 0 5px;
	}
	.tick {
		flex: 1;
		min-width: 1px;
		padding: 0;
		border: 0;
		cursor: pointer;
		background: var(--chrome-soft, currentColor);
	}
	.tick.dot {
		background: var(--chrome-dot, currentColor);
	}
	.tick:hover {
		background: var(--chrome, currentColor);
	}
	.tick.cur {
		background: var(--chrome-full, currentColor);
	}
	.dec.future .tick {
		opacity: 0.45;
	}
	.declabels {
		display: flex;
	}
	.dlabel {
		flex: 1;
		text-align: left;
		padding: 6px 0 0 5px;
		border: 0;
		background: none;
		cursor: pointer;
		font-family: var(--sans, sans-serif);
		font-size: 9.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--chrome, currentColor);
	}
	.dlabel.century-mark {
		color: var(--chrome-strong, currentColor);
		font-weight: 700;
	}
	.dlabel.on {
		color: var(--chrome-full, currentColor);
		font-weight: 700;
	}
	@media (max-width: 640px) {
		.band {
			display: none; /* MobileRail replaces the rail on phones */
		}
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/CenturyRail.test.ts`
Expected: PASS. Then `pnpm check` — 0 errors.

- [ ] **Step 5: Structural verification vs locked mockup**

Compare against `timeline-home-locked.html` `.v5 .band/.century/.dec/.declabels` (lines 24–34, 93–112):
- Decade segments flex 1, ten ticks each, 2px gaps, 5px decade padding, ticks bottom-aligned in a 44px row.
- Tick height ∝ count (sqrt scale, Task 1); empty years = 2px dots at fainter chrome (`--chrome-dot` .16 vs `--chrome-soft` .22); active year tick = full chrome ink; future decade ghosted (0.45 opacity).
- Century labels ("1900", "2000") bold/strong; active decade label ("'90") bold full ink; other labels muted 9.5px caps, letterspacing .12em.
- ABSOLUTELY NO horizontal rule/bar lines above or below the rail (the locked change).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/CenturyRail.svelte src/lib/ui/CenturyRail.test.ts
git commit -m "feat: add CenturyRail decade histogram component"
```

---

### Task 8: YearBand component

**Files:**
- Create: `src/lib/ui/YearBand.svelte`
- Test: `src/lib/ui/YearBand.test.ts`

**Interfaces:**
- Consumes: `yearsFromDrag`, `momentumYears` from `./year-drag`; `railSpan`, `type YearCount` from `./rail-math`; `paletteFor`, `FONT`, `CREAM` from `./tokens`; `reducedMotion` from `./theme`; `CenturyRail` (docked mini rail).
- Produces: `<YearBand activeYear years earliest now? docked? onchange />` — props `{ activeYear: number; years: YearCount[]; earliest: number | null; now?: number; docked?: boolean; onchange: (year: number) => void }`. Normal mode = ARIA slider hero band (`data-testid="year-band"`); `docked` mode = fixed compact top bar (`data-testid="docked-band"`). Mobile (≤640px) renders serif year + cream ◀ ▶ steppers.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/YearBand.test.ts`:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { YearCount } from './rail-math';
import YearBand from './YearBand.svelte';

const YEARS: YearCount[] = [
	{ year: 1993, count: 1, people: 1 },
	{ year: 1994, count: 214, people: 12 },
];
const noop = () => {};

describe('YearBand', () => {
	it('renders ARIA slider semantics with min/max/now and the sub-line', () => {
		const { body } = render(YearBand, {
			props: { activeYear: 1994, years: YEARS, earliest: 1993, now: 2026, onchange: noop },
		});
		expect(body).toContain('role="slider"');
		expect(body).toContain('aria-valuemin="1980"');
		expect(body).toContain('aria-valuemax="2039"');
		expect(body).toContain('aria-valuenow="1994"');
		expect(body).toContain('tabindex="0"');
		expect(body).toContain('214 moments · 12 people');
	});
	it('renders two flanking years on each side plus steppers', () => {
		const { body } = render(YearBand, {
			props: { activeYear: 1994, years: YEARS, earliest: 1993, now: 2026, onchange: noop },
		});
		for (const y of ['1992', '1993', '1995', '1996']) expect(body).toContain(y);
		expect(body).toContain('aria-label="Previous year"');
		expect(body).toContain('aria-label="Next year"');
	});
	it('pluralizes and copes with empty years', () => {
		const { body } = render(YearBand, {
			props: { activeYear: 1980, years: YEARS, earliest: 1993, now: 2026, onchange: noop },
		});
		expect(body).toContain('No moments yet');
	});
	it('docked mode renders the compact bar with a mini rail', () => {
		const { body } = render(YearBand, {
			props: { activeYear: 1994, years: YEARS, earliest: 1993, now: 2026, docked: true, onchange: noop },
		});
		expect(body).toContain('data-testid="docked-band"');
		expect(body).toContain('data-testid="century-rail"');
		expect(body).not.toContain('role="slider"');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/YearBand.test.ts`
Expected: FAIL — cannot resolve `./YearBand.svelte`.

- [ ] **Step 3: Write the component**

Create `src/lib/ui/YearBand.svelte`:

```svelte
<script lang="ts">
	import CenturyRail from './CenturyRail.svelte';
	import { railSpan, type YearCount } from './rail-math';
	import { reducedMotion } from './theme';
	import { CREAM, FONT, INK, paletteFor } from './tokens';
	import { momentumYears, yearsFromDrag } from './year-drag';

	let {
		activeYear,
		years,
		earliest,
		now = new Date().getFullYear(),
		docked = false,
		onchange,
	}: {
		activeYear: number;
		years: YearCount[];
		earliest: number | null;
		now?: number;
		docked?: boolean;
		onchange: (year: number) => void;
	} = $props();

	const span = $derived(railSpan(earliest, now));
	const yearData = $derived(years.find((y) => y.year === activeYear));
	const subline = $derived(
		yearData
			? `${yearData.count} ${yearData.count === 1 ? 'moment' : 'moments'} · ${yearData.people} ${
					yearData.people === 1 ? 'person' : 'people'
				}`
			: 'No moments yet',
	);
	// Ember text-shadow color comes from the decade's first radial pool (tokens).
	const ember = $derived(paletteFor(activeYear).pools[0]?.color ?? 'transparent');

	function clampYear(y: number): number {
		return Math.min(span.end, Math.max(span.start, y));
	}
	function step(delta: number) {
		const next = clampYear(activeYear + delta);
		if (next !== activeYear) onchange(next);
	}

	// Drag with momentum: live translate while dragging, commit on release.
	let dragging = $state(false);
	let offset = $state(0);
	let startX = 0;
	let lastX = 0;
	let lastT = 0;
	let velocity = 0;

	function onDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		dragging = true;
		startX = lastX = e.clientX;
		lastT = e.timeStamp;
		velocity = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!dragging) return;
		const dt = e.timeStamp - lastT;
		if (dt > 0) velocity = (e.clientX - lastX) / dt;
		lastX = e.clientX;
		lastT = e.timeStamp;
		offset = e.clientX - startX;
	}
	function onUp() {
		if (!dragging) return;
		dragging = false;
		const total = yearsFromDrag(offset) + ($reducedMotion ? 0 : momentumYears(velocity));
		offset = 0;
		if (total !== 0) step(total);
	}

	// Wheel: accumulate, one year per notch-cluster, 200ms lockout.
	let wheelAcc = 0;
	let wheelLockUntil = 0;
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.timeStamp < wheelLockUntil) return;
		wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(wheelAcc) >= 60) {
			step(wheelAcc > 0 ? 1 : -1);
			wheelAcc = 0;
			wheelLockUntil = e.timeStamp + 200;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			step(-1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			step(1);
		} else if (e.key === 'Home') {
			e.preventDefault();
			onchange(span.start);
		} else if (e.key === 'End') {
			e.preventDefault();
			onchange(span.end);
		}
	}
</script>

{#if docked}
	<!-- Compact scrubber while scrolled: slim ink bar, year + mini rail. -->
	<div
		class="dockband"
		data-testid="docked-band"
		style:--sans={FONT.sans}
		style:--cream={CREAM}
		style:background={`${INK}F0`}
	>
		<button
			class="dockyear"
			onclick={() => window.scrollTo({ top: 0, behavior: $reducedMotion ? 'auto' : 'smooth' })}
		>{activeYear}</button>
		<div class="dockrail">
			<CenturyRail {years} {earliest} {activeYear} {now} compact onselect={onchange} />
		</div>
	</div>
{:else}
	<div
		class="band"
		data-testid="year-band"
		style:--sans={FONT.sans}
		style:--serif={FONT.serif}
		style:--cream={CREAM}
		style:--ember={ember}
		role="slider"
		tabindex="0"
		aria-label="Timeline year"
		aria-valuemin={span.start}
		aria-valuemax={span.end}
		aria-valuenow={activeYear}
		aria-valuetext={`${activeYear} — ${subline}`}
		onkeydown={onKey}
		onwheel={onWheel}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointercancel={onUp}
	>
		<button class="stepper" aria-label="Previous year" onclick={() => step(-1)}>◀</button>
		<div class="years" class:instant={$reducedMotion || dragging} style:transform={`translateX(${offset}px)`}>
			<button class="yr n1" tabindex="-1" disabled={activeYear - 2 < span.start} onclick={() => step(-2)}>
				{activeYear - 2}
			</button>
			<button class="yr n2" tabindex="-1" disabled={activeYear - 1 < span.start} onclick={() => step(-1)}>
				{activeYear - 1}
			</button>
			<span class="yr big" style:text-shadow={`0 4px 60px ${ember}`}>
				{activeYear}
				<small>{subline}</small>
			</span>
			<button class="yr n2" tabindex="-1" disabled={activeYear + 1 > span.end} onclick={() => step(1)}>
				{activeYear + 1}
			</button>
			<button class="yr n1" tabindex="-1" disabled={activeYear + 2 > span.end} onclick={() => step(2)}>
				{activeYear + 2}
			</button>
		</div>
		<button class="stepper" aria-label="Next year" onclick={() => step(1)}>▶</button>
	</div>
{/if}

<style>
	.band {
		display: flex;
		align-items: center;
		padding: 22px 16px 0;
		overflow: hidden;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		outline-offset: 4px;
	}
	.years {
		flex: 1;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 42px;
		white-space: nowrap;
		transition: transform 200ms ease;
	}
	.years.instant {
		transition: none;
	}
	.yr {
		border: 0;
		background: none;
		padding: 0;
		cursor: pointer;
		font-family: var(--sans, sans-serif);
		font-weight: 800;
		letter-spacing: -0.04em;
		line-height: 0.8;
	}
	.yr:disabled {
		visibility: hidden;
	}
	.n1 {
		font-size: 40px;
		color: color-mix(in srgb, var(--cream) 34%, transparent);
	}
	.n2 {
		font-size: 56px;
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}
	.big {
		font-size: clamp(96px, 12vw, 170px);
		color: var(--cream);
		cursor: default;
	}
	.big small {
		display: block;
		font-family: var(--sans, sans-serif);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.3em;
		line-height: 1;
		text-align: center;
		text-transform: uppercase;
		margin-top: 12px;
		color: var(--chrome-strong, currentColor);
	}
	.stepper {
		width: 44px;
		height: 44px;
		flex: none;
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 18px;
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}
	.stepper:hover,
	.stepper:focus-visible {
		color: var(--cream);
	}

	.dockband {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 8px 16px;
		/* mini rail on the ink bar always reads in cream */
		--chrome-full: var(--cream);
		--chrome-strong: color-mix(in srgb, var(--cream) 85%, transparent);
		--chrome: color-mix(in srgb, var(--cream) 50%, transparent);
		--chrome-soft: color-mix(in srgb, var(--cream) 28%, transparent);
		--chrome-dot: color-mix(in srgb, var(--cream) 14%, transparent);
	}
	.dockyear {
		border: 0;
		background: none;
		cursor: pointer;
		font-family: var(--sans, sans-serif);
		font-weight: 800;
		font-size: 30px;
		letter-spacing: -0.04em;
		color: var(--cream);
	}
	.dockrail {
		flex: 1;
		min-width: 0;
	}

	@media (max-width: 640px) {
		.band {
			padding: 18px 10px 0;
		}
		.years {
			gap: 18px;
		}
		.n1,
		.n2 {
			display: none;
		}
		/* Locked mobile mockup: serif year, cream, ember glow; 24px light steppers. */
		.big {
			font-family: var(--serif, serif);
			font-weight: 400;
			letter-spacing: 0;
			font-size: 78px;
			line-height: 1;
		}
		.stepper {
			font-size: 24px;
			font-weight: 300;
			color: var(--cream);
			text-shadow: 0 2px 24px var(--ember);
		}
		.dockband {
			display: none; /* mobile uses MobileRail, not the docked bar */
		}
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/YearBand.test.ts`
Expected: PASS (4 tests). Then `pnpm check` — 0 errors.

- [ ] **Step 5: Structural verification vs locked mockups**

Against `timeline-home-locked.html` `.v5 .years/.yr` (lines 19–23, 90–92):
- Giant active year: heavy sans numerals weight 800, letterspacing −0.04em, line-height 0.8, cream `#FFF5E8` (CREAM token), ember text-shadow `0 4px 60px <decade pool color>`; ~170px at desktop width (clamp).
- Flanking years at two size steps: adjacent 56px @ 55% cream, outer 40px @ 34% cream, baseline-aligned, 42px gaps; neighbors are tappable (jump on click).
- Sub-line under the numeral: 10px sans caps, 0.3em letterspacing, centered, muted chrome ("214 moments · 12 people").
- Steppers: 44×44 hit area, quiet cream at the band's far edges (spec accessibility requirement — not in the desktop mockup, deliberate).
Against `person-and-mobile-locked.html` `.mb2 .yearrow/.step/.yr` (lines 63–65):
- Mobile: flanking years hidden; year is 78px serif roman cream with ember shadow; ◀ ▶ steppers 44px boxes, 24px light glyphs, cream, same ember glow.
- ARIA: role=slider, valuemin/max = span ends, valuenow = active year, focusable, ←/→/Home/End handled.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/YearBand.svelte src/lib/ui/YearBand.test.ts
git commit -m "feat: add YearBand hero year slider"
```

---

### Task 9: Room chrome helpers + DecadeRoom crossfade

**Files:**
- Create: `src/lib/ui/room.ts`, `src/lib/ui/DecadeRoom.svelte`
- Test: `src/lib/ui/room.test.ts`, `src/lib/ui/DecadeRoom.test.ts`

**Interfaces:**
- Consumes: `INK`, `CREAM`, `DAWN`, `FONT`, `MOTION`, `paletteFor`, `type DecadePalette` from `./tokens`; `Gradient.svelte` (phase 01, prop `palette: DecadePalette`); `reducedMotion` from `./theme`.
- Produces:
  - `hexToRgb(hex: string): { r: number; g: number; b: number }`
  - `alpha(hex: string, a: number): string` → `"rgba(23,20,18,0.5)"`
  - `chromeVars(palette: DecadePalette): Record<string, string>` — keys `--chrome-full`, `--chrome-contrast`, `--chrome-strong`, `--chrome`, `--chrome-soft`, `--chrome-dot`, `--chrome-caption`, `--chrome-caption-dim`
  - `<DecadeRoom year={n}>{children}</DecadeRoom>` — full-viewport decade gradient room, `data-decade` attribute, 300ms opacity crossfade on decade change (skipped under `reducedMotion`), sets chrome vars + `--sans/--serif/--cream/--ink/--dawn` for all children.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ui/room.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alpha, chromeVars, hexToRgb } from './room';
import { paletteFor } from './tokens';

describe('alpha', () => {
	it('converts hex + alpha to rgba()', () => {
		expect(hexToRgb('#171412')).toEqual({ r: 23, g: 20, b: 18 });
		expect(alpha('#171412', 0.5)).toBe('rgba(23,20,18,0.5)');
		expect(alpha('#FFF5E8', 0.22)).toBe('rgba(255,245,232,0.22)');
	});
});

describe('chromeVars', () => {
	it('uses ink chrome on light decades (the 90s)', () => {
		const vars = chromeVars(paletteFor(1994));
		expect(vars['--chrome-full']).toBe('#171412');
		expect(vars['--chrome-contrast']).toBe('#FFF5E8');
		expect(vars['--chrome']).toBe('rgba(23,20,18,0.5)');
		expect(vars['--chrome-dot']).toBe('rgba(23,20,18,0.16)');
		expect(vars['--chrome-caption']).toBe('rgba(23,20,18,0.78)');
	});
	it('uses cream chrome on dark decades (the 80s)', () => {
		const vars = chromeVars(paletteFor(1985));
		expect(vars['--chrome-full']).toBe('#FFF5E8');
		expect(vars['--chrome-contrast']).toBe('#171412');
		expect(vars['--chrome-soft']).toBe('rgba(255,245,232,0.22)');
	});
});
```

Create `src/lib/ui/DecadeRoom.test.ts`:

```ts
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import DecadeRoom from './DecadeRoom.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>inside the room</p>' }));

describe('DecadeRoom', () => {
	it('renders the decade room with chrome vars and the content', () => {
		const { body } = render(DecadeRoom, { props: { year: 1994, children } });
		expect(body).toContain('data-decade="1990"');
		expect(body).toContain('inside the room');
		expect(body).toContain('--chrome-full:#171412');
	});
	it('picks the decade from any year within it', () => {
		const { body } = render(DecadeRoom, { props: { year: 1987, children } });
		expect(body).toContain('data-decade="1980"');
		expect(body).toContain('--chrome-full:#FFF5E8');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/ui/room.test.ts src/lib/ui/DecadeRoom.test.ts`
Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Write `src/lib/ui/room.ts`**

```ts
/** Chrome ink/cream assignment per decade palette (spec §10 "chromeOn"). */
import { CREAM, INK, type DecadePalette } from './tokens';

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace('#', '');
	return {
		r: parseInt(h.slice(0, 2), 16),
		g: parseInt(h.slice(2, 4), 16),
		b: parseInt(h.slice(4, 6), 16),
	};
}

export function alpha(hex: string, a: number): string {
	const { r, g, b } = hexToRgb(hex);
	return `rgba(${r},${g},${b},${a})`;
}

/** CSS custom properties every timeline component reads (ticks, captions, labels). */
export function chromeVars(palette: DecadePalette): Record<string, string> {
	const base = palette.chromeOn === 'ink' ? INK : CREAM;
	const contrast = palette.chromeOn === 'ink' ? CREAM : INK;
	return {
		'--chrome-full': base,
		'--chrome-contrast': contrast,
		'--chrome-strong': alpha(base, 0.85),
		'--chrome': alpha(base, 0.5),
		'--chrome-soft': alpha(base, 0.22),
		'--chrome-dot': alpha(base, 0.16),
		'--chrome-caption': alpha(base, 0.78),
		'--chrome-caption-dim': alpha(base, 0.55),
	};
}
```

- [ ] **Step 4: Write `src/lib/ui/DecadeRoom.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Gradient from './Gradient.svelte';
	import { chromeVars } from './room';
	import { reducedMotion } from './theme';
	import { CREAM, DAWN, FONT, INK, MOTION, paletteFor, type DecadePalette } from './tokens';

	let { year, children }: { year: number; children: Snippet } = $props();

	let current = $state<DecadePalette>(paletteFor(year));
	let previous = $state<DecadePalette | null>(null);
	let fadeKey = $state(0);

	// Decade change → 300ms opacity crossfade between two Gradient layers.
	// Gated by reducedMotion: instant swap, no second layer.
	$effect(() => {
		const next = paletteFor(year);
		if (next.decade === current.decade) return;
		if ($reducedMotion) {
			current = next;
			previous = null;
			return;
		}
		previous = current;
		current = next;
		fadeKey++;
		const t = setTimeout(() => (previous = null), MOTION.slow);
		return () => clearTimeout(t);
	});

	const styleVars = $derived(
		[
			...Object.entries(chromeVars(current)).map(([k, v]) => `${k}:${v}`),
			`--sans:${FONT.sans}`,
			`--serif:${FONT.serif}`,
			`--cream:${CREAM}`,
			`--ink:${INK}`,
			`--dawn:${DAWN}`,
		].join(';'),
	);
</script>

<div class="room" data-decade={current.decade} style={styleVars}>
	{#if previous}
		<div class="layer">
			<Gradient palette={previous} />
		</div>
	{/if}
	{#key fadeKey}
		<div class="layer" class:fading={previous !== null}>
			<Gradient palette={current} />
		</div>
	{/key}
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
	}
	/* Fixed so the room fills the viewport however far the grid scrolls. */
	.layer {
		position: fixed;
		inset: 0;
		z-index: 0;
	}
	.content {
		position: relative;
		z-index: 1;
	}
	.fading {
		animation: roomfade 300ms ease both;
	}
	@keyframes roomfade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/ui/room.test.ts src/lib/ui/DecadeRoom.test.ts`
Expected: PASS. Then `pnpm check` — 0 errors. If `Gradient.svelte`'s prop is not named `palette`, adapt the two `<Gradient palette={…} />` lines to phase 01's actual prop — do NOT change Gradient itself.

- [ ] **Step 6: Structural verification vs locked mockup**

Against `timeline-home-locked.html` `.v5` background (lines 5–12):
- Room = Gradient.svelte fed `paletteFor(activeYear)` (linear wash + radial pools + grain come from the phase 01 component; this task only stacks/crossfades layers).
- Crossfade duration is exactly `MOTION.slow` (300ms), opacity-only, both in CSS (`roomfade`) and the cleanup timer.
- `reducedMotion` → hard cut, single layer.
- `chromeOn` flips tick/meta ink vs cream per palette: 1990s → ink chrome, 1980s → cream chrome (verified by unit tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/room.ts src/lib/ui/room.test.ts src/lib/ui/DecadeRoom.svelte src/lib/ui/DecadeRoom.test.ts
git commit -m "feat: add DecadeRoom gradient crossfade wrapper"
```

---

### Task 10: MasonryGrid component (windowed, sentinels, endcap)

**Files:**
- Create: `src/lib/ui/MasonryGrid.svelte`
- Test: `src/lib/ui/MasonryGrid.test.ts`

**Interfaces:**
- Consumes: everything from `./masonry`; `MediaCard`, `MonthBreak`.
- Produces: `<MasonryGrid entries itemHref onNearEnd onYearVisible />` — props `{ entries: GridEntry[]; itemHref: (itemId: string) => string; onNearEnd: () => void; onYearVisible: (year: number) => void }`. Root `data-testid="masonry-grid"` with `data-cols` attribute. Windowed rendering (viewport ± 2 screens), stable keys (`entry.id`), ResizeObserver width measurement, IntersectionObserver year sentinels + near-end endcap.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/MasonryGrid.test.ts` (SSR smoke test — the layout math is fully covered by Task 2; browser behavior by Task 14 e2e):

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import MasonryGrid from './MasonryGrid.svelte';

describe('MasonryGrid', () => {
	it('SSRs an empty measurable container (2 cols until measured)', () => {
		const { body } = render(MasonryGrid, {
			props: {
				entries: [],
				itemHref: (id: string) => `/item/${id}`,
				onNearEnd: () => {},
				onYearVisible: () => {},
			},
		});
		expect(body).toContain('data-testid="masonry-grid"');
		expect(body).toContain('data-cols="2"');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/MasonryGrid.test.ts`
Expected: FAIL — cannot resolve `./MasonryGrid.svelte`.

- [ ] **Step 3: Write the component**

Create `src/lib/ui/MasonryGrid.svelte`:

```svelte
<script lang="ts">
	import {
		activeYearFromSentinels,
		columnCount,
		GAP,
		layoutMasonry,
		visibleEntryIds,
		type GridEntry,
	} from './masonry';
	import MediaCard from './MediaCard.svelte';
	import MonthBreak from './MonthBreak.svelte';

	let {
		entries,
		itemHref,
		onNearEnd,
		onYearVisible,
	}: {
		entries: GridEntry[];
		itemHref: (itemId: string) => string;
		onNearEnd: () => void;
		onYearVisible: (year: number) => void;
	} = $props();

	let container: HTMLDivElement | undefined = $state();
	let endcap: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let scrollTop = $state(0);
	let viewportH = $state(800);

	const cols = $derived(columnCount(width));
	const layout = $derived(width > 0 ? layoutMasonry(entries, width, cols, GAP) : null);
	const sentinels = $derived(
		entries
			.filter((e) => e.kind === 'sentinel')
			.map((e) => ({ id: e.id, year: (e as { year: number }).year, y: layout?.positions.get(e.id)?.y ?? 0 })),
	);
	// Windowed rendering: only entries within viewport ± 2 screens; stable keys.
	const windowed = $derived.by(() => {
		if (!layout) return [] as GridEntry[];
		const ids = visibleEntryIds(layout.positions, scrollTop, viewportH, 2);
		return entries.filter((e) => e.kind !== 'sentinel' && ids.has(e.id));
	});

	// Container width via ResizeObserver.
	$effect(() => {
		if (!container) return;
		const ro = new ResizeObserver((obs) => {
			width = obs[0].contentRect.width;
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// Window-scroll → grid-relative scrollTop (rAF-throttled) for windowing.
	$effect(() => {
		let raf = 0;
		const measure = () => {
			raf = 0;
			if (container) scrollTop = -container.getBoundingClientRect().top;
			viewportH = window.innerHeight;
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(measure);
		};
		measure();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			if (raf) cancelAnimationFrame(raf);
		};
	});

	// Year context via IntersectionObserver on the year sentinels.
	$effect(() => {
		if (!container || sentinels.length === 0) return;
		const els = Array.from(container.querySelectorAll<HTMLElement>('[data-year]'));
		if (els.length === 0) return;
		const report = () => {
			const list = els.map((el) => ({ year: Number(el.dataset.year), y: el.getBoundingClientRect().top }));
			const year = activeYearFromSentinels(list, 0, 160);
			if (year !== null) onYearVisible(year);
		};
		const io = new IntersectionObserver(report, { rootMargin: '0px 0px -80% 0px', threshold: 0 });
		els.forEach((el) => io.observe(el));
		queueMicrotask(report);
		return () => io.disconnect();
	});

	// Infinite scroll: endcap observed with a 2-screen lookahead.
	$effect(() => {
		if (!endcap) return;
		const io = new IntersectionObserver(
			(obs) => {
				if (obs.some((o) => o.isIntersecting)) onNearEnd();
			},
			{ rootMargin: '0px 0px 200% 0px', threshold: 0 },
		);
		io.observe(endcap);
		return () => io.disconnect();
	});
</script>

<div
	class="grid"
	bind:this={container}
	data-testid="masonry-grid"
	data-cols={cols}
	style:height={layout ? `${layout.totalHeight}px` : 'auto'}
>
	{#each windowed as e (e.id)}
		{@const pos = layout?.positions.get(e.id)}
		{#if pos}
			<div class="cell" style:transform={`translate(${pos.x}px, ${pos.y}px)`} style:width={`${pos.w}px`} style:height={`${pos.h}px`}>
				{#if e.kind === 'item'}
					<MediaCard item={e.item} href={itemHref(e.item.id)} />
				{:else if e.kind === 'month'}
					<MonthBreak year={e.year} month={e.month} />
				{/if}
			</div>
		{/if}
	{/each}
	{#each sentinels as s (s.id)}
		<div class="sentinel" data-year={s.year} style:transform={`translate(0px, ${s.y}px)`}></div>
	{/each}
	<div class="endcap" bind:this={endcap} style:transform={`translate(0px, ${layout?.totalHeight ?? 0}px)`}></div>
</div>

<style>
	.grid {
		position: relative;
		margin: 22px 30px 0;
	}
	.cell,
	.sentinel,
	.endcap {
		position: absolute;
		top: 0;
		left: 0;
	}
	.sentinel,
	.endcap {
		width: 100%;
		height: 1px;
		pointer-events: none;
	}
	@media (max-width: 640px) {
		.grid {
			margin: 16px 12px 140px; /* clear the MobileRail dock */
		}
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/MasonryGrid.test.ts`
Expected: PASS. Then `pnpm check` — 0 errors.

- [ ] **Step 5: Structural verification vs locked mockup**

Against `timeline-home-locked.html` `.v5 .grid` (line 35, 114–120):
- 12px column gaps (GAP), 30px side margins on desktop; 12px margins + 2 columns on mobile (mockup `.mb2 .grid` 8px gap is superseded by the shared GAP=12 constant — acceptable; check the visual balance at Task 14).
- Month breaks flow as grid cells among the cards; chronological order runs down/across via shortest-column placement.
- Windowing: `windowed` renders only viewport ± 2 screens; keys are stable ids; absolute translate positioning (no CSS columns).
- 10k-item readiness: layout is O(n) pure math; DOM holds only the window.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/MasonryGrid.svelte src/lib/ui/MasonryGrid.test.ts
git commit -m "feat: add windowed MasonryGrid with year sentinels"
```

---

### Task 11: Phase 06 filter-chip seam

Filter chips are intentionally not implemented in Phase 03. Phase 06 owns the `FilterChips` component, filtered timeline histograms, omnibox chips, and adding filter state to timeline item links.

- [ ] **Step 1: Verify absence**

Run:

```bash
rg "FilterChips|filter-chip|people=<|tags=<|type=<" src/routes/+page.svelte src/lib/ui
```

Expected: no Phase 03 implementation hits. Hits in docs/tests for Phase 06 are acceptable.

- [ ] **Step 2: Commit if cleanup was needed**

```bash
git add src/routes/+page.svelte src/lib/ui
git commit -m "chore: leave timeline filter chips for search phase"
```

---

### Task 12: MobileRail component

**Files:**
- Create: `src/lib/ui/MobileRail.svelte`
- Test: `src/lib/ui/MobileRail.test.ts`

**Interfaces:**
- Consumes: `railSpan`, `mobileRailTicks`, `mobileRailLabels`, `thumbFraction`, `type YearCount` from `./rail-math`; `alpha` from `./room`; `INK`, `CREAM`, `DAWN`, `FONT` from `./tokens`.
- Produces: `<MobileRail years earliest activeYear now? onchange />` — props `{ years: YearCount[]; earliest: number | null; activeYear: number; now?: number; onchange: (year: number) => void }`. Fixed bottom dock (`data-testid="mobile-rail"`), visible only ≤640px, safe-area inset padding, drag + tap + ←/→ keys.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/MobileRail.test.ts`:

```ts
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { YearCount } from './rail-math';
import MobileRail from './MobileRail.svelte';

const YEARS: YearCount[] = [
	{ year: 1993, count: 1, people: 1 },
	{ year: 1994, count: 4, people: 12 },
];
const noop = () => {};

describe('MobileRail', () => {
	it('renders the docked rail with thumb year, ticks and decade labels', () => {
		const { body } = render(MobileRail, {
			props: { years: YEARS, earliest: 1993, activeYear: 1994, now: 2026, onchange: noop },
		});
		expect(body).toContain('data-testid="mobile-rail"');
		expect(body).toContain('role="slider"');
		expect(body).toContain('aria-valuenow="1994"');
		expect(body).toContain('>1994</b>'); // serif thumb label
		expect(body).toContain("'90");
		expect(body.match(/class="[^"]*tick[^"]*"/g)?.length).toBe(12); // 5-year buckets, 1980..2039
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/MobileRail.test.ts`
Expected: FAIL — cannot resolve `./MobileRail.svelte`.

- [ ] **Step 3: Write the component**

Create `src/lib/ui/MobileRail.svelte`:

```svelte
<script lang="ts">
	import { mobileRailLabels, mobileRailTicks, railSpan, thumbFraction, type YearCount } from './rail-math';
	import { alpha } from './room';
	import { CREAM, DAWN, FONT, INK } from './tokens';

	let {
		years,
		earliest,
		activeYear,
		now = new Date().getFullYear(),
		onchange,
	}: {
		years: YearCount[];
		earliest: number | null;
		activeYear: number;
		now?: number;
		onchange: (year: number) => void;
	} = $props();

	const span = $derived(railSpan(earliest, now));
	const ticks = $derived(mobileRailTicks(years, earliest, activeYear, now));
	const labels = $derived(mobileRailLabels(earliest, activeYear, now));

	let dragYear = $state<number | null>(null);
	const shownYear = $derived(dragYear ?? activeYear);
	const frac = $derived(thumbFraction(shownYear, span));

	let railEl: HTMLDivElement | undefined = $state();
	let dragging = false;

	function yearAt(clientX: number): number {
		if (!railEl) return activeYear;
		const r = railEl.getBoundingClientRect();
		const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
		return Math.round(span.start + f * (span.end - span.start));
	}
	function onDown(e: PointerEvent) {
		dragging = true;
		dragYear = yearAt(e.clientX);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (dragging) dragYear = yearAt(e.clientX);
	}
	function onUp() {
		if (!dragging) return;
		dragging = false;
		if (dragYear !== null && dragYear !== activeYear) onchange(dragYear);
		dragYear = null;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			onchange(Math.max(span.start, activeYear - 1));
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			onchange(Math.min(span.end, activeYear + 1));
		}
	}

	// No hard band: ticks rise out of an ink fade (locked mobile mockup).
	const dockBg = `linear-gradient(180deg, ${alpha(INK, 0)} 0%, ${alpha(INK, 0.72)} 34%, ${alpha(INK, 0.94)} 100%)`;
</script>

<div
	class="dock"
	data-testid="mobile-rail"
	style:background={dockBg}
	style:--sans={FONT.sans}
	style:--serif={FONT.serif}
	style:--tick={alpha(CREAM, 0.28)}
	style:--tickdot={alpha(CREAM, 0.14)}
	style:--warm={alpha(DAWN, 0.75)}
	style:--creamv={CREAM}
	style:--dawnv={DAWN}
	role="slider"
	tabindex="0"
	aria-label="Timeline scrubber"
	aria-valuemin={span.start}
	aria-valuemax={span.end}
	aria-valuenow={activeYear}
	aria-valuetext={String(shownYear)}
	onkeydown={onKey}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
>
	<div class="ticks" bind:this={railEl}>
		{#each ticks as t (t.startYear)}
			<span
				class="tick"
				class:dot={t.empty}
				class:warm={t.warm}
				class:future={t.future}
				style:height={t.empty ? '2px' : `${t.height}px`}
			></span>
		{/each}
		<span class="thumb" style:left={`${frac * 100}%`}><b>{shownYear}</b></span>
	</div>
	<div class="lbls">
		{#each labels as l (l.decade)}
			<span class:on={l.active} style:left={`${l.frac * 100}%`}>{l.text}</span>
		{/each}
	</div>
</div>

<style>
	.dock {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 5;
		padding: 30px 16px calc(14px + env(safe-area-inset-bottom));
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		display: none;
	}
	@media (max-width: 640px) {
		.dock {
			display: block;
		}
	}
	.ticks {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 30px;
	}
	.tick {
		flex: 1;
		background: var(--tick);
	}
	.tick.dot {
		background: var(--tickdot);
	}
	.tick.warm {
		background: var(--warm);
	}
	.tick.future {
		opacity: 0.45;
	}
	/* Glowing hairline thumb, serif year above it. */
	.thumb {
		position: absolute;
		top: -22px;
		width: 2px;
		height: 52px;
		background: var(--creamv);
		box-shadow: 0 0 18px color-mix(in srgb, var(--creamv) 55%, transparent);
	}
	.thumb b {
		position: absolute;
		top: -18px;
		left: 50%;
		transform: translateX(-50%);
		font-family: var(--serif, serif);
		font-weight: 400;
		font-size: 13px;
		letter-spacing: 0.04em;
		color: var(--creamv);
	}
	.lbls {
		position: relative;
		height: 14px;
		margin-top: 8px;
		font-family: var(--sans, sans-serif);
		font-size: 8px;
		letter-spacing: 0.14em;
		color: color-mix(in srgb, var(--creamv) 45%, transparent);
	}
	.lbls span {
		position: absolute;
		transform: translateX(-50%);
	}
	.lbls span.on {
		color: var(--dawnv);
		font-weight: 700;
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/MobileRail.test.ts`
Expected: PASS. Then `pnpm check` — 0 errors.

- [ ] **Step 5: Structural verification vs locked mobile mockup**

Against `person-and-mobile-locked.html` `.mb2 .dock` (lines 75–84, 158–163):
- Bottom dock with NO hard band: pure ink fade `transparent → .72 @34% → .94`, ticks rising out of it.
- Ticks cream at .28 (dots .14, 2px); active decade's ticks warmed to dawn `rgba(DAWN, .75)`; future ghosted.
- Thumb: 2px glowing cream hairline, 52px tall, riding above the tick row, serif year label (13px, roman) centered above.
- Decade labels beneath: tiny sans caps at 45% cream; the current decade in dawn, bold.
- Safe-area inset padding at the bottom; drag anywhere on the dock scrubs (44px+ effective target); ◀ ▶ steppers live in YearBand's mobile row (resolution #4).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/MobileRail.svelte src/lib/ui/MobileRail.test.ts
git commit -m "feat: add mobile bottom rail scrubber"
```

---

### Task 13: Timeline home page assembly

**Files:**
- Create: `src/routes/+page.ts`
- Modify: `src/routes/+page.svelte` (replace whatever placeholder phase 01 left)

**Interfaces:**
- Consumes: all Task 5-12 components; `buildGridEntries`, `type GridEntry` from `$lib/ui/masonry`; unfiltered `GET /api/timeline` (Task 4) and `GET /api/items?year&cursor&limit` (phase 02); `goto`, `replaceState` from `$app/navigation`; `page` from `$app/state`; `browser` from `$app/environment`.
- Produces: `/` route with `?y=<year>` only; `PageData = { timeline: TimelineDTO; activeYear: number; startYear: number; items: ItemDTO[]; nextCursor: string | null }`.

- [ ] **Step 1: Write `src/routes/+page.ts`**

Load `/api/timeline`, choose `activeYear` from `?y` or the latest content year, choose `startYear` as the first content year at/after `activeYear`, then load the first item page from `/api/items?year=${startYear}&limit=60`. Do not parse or emit people/tags/type filters in this phase.

- [ ] **Step 2: Replace `src/routes/+page.svelte`**

Compose `DecadeRoom`, `YearBand`, optional docked `YearBand`, `CenturyRail`, `MasonryGrid`, and `MobileRail`. Item hrefs are `/item/${id}?y=${activeYear}`. Infinite scroll is forward-only by year and cursor. Scroll-following updates `?y` with `replaceState`; explicit jumps use `goto` to `/?y=YYYY`.

Do not import `FilterChips`; Phase 06 adds it.

- [ ] **Step 3: Typecheck + full unit suite**

Run: `pnpm check && pnpm vitest run`
Expected: 0 errors, all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/routes/+page.ts src/routes/+page.svelte
git commit -m "feat: assemble unfiltered timeline home"
```

---

### Task 14: Playwright e2e — seeded timeline golden path

**Files:**
- Modify/Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`, `e2e/helpers/auth.ts`, `e2e/helpers/seed.ts`, `e2e/timeline.spec.ts`

**Interfaces:**
- Consumes: `/setup` + `/login` UI (phase 01); `/api/upload/init|chunk|complete`, `/api/items`, `/api/timeline` (phases 02–03); the DB schema (direct inserts for people/tags/sprite — those APIs ship in phases 05–07); `pnpm db:migrate` script (phase 01).
- Produces: `pnpm test:e2e` green.

- [ ] **Step 1: Ensure the Playwright config runs against an isolated data dir**

Make `playwright.config.ts` (create it if phases 01–02 didn't; if it exists, merge so that `globalSetup`, the `webServer` env vars, and `reuseExistingServer: false` below are present — keep existing projects/tests):

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: 'http://localhost:4173',
	},
	webServer: {
		command:
			'pnpm build && PORT=4173 ORIGIN=http://localhost:4173 DATABASE_PATH=e2e/.data/shoebox.db MEDIA_PATH=e2e/.data/media node build',
		port: 4173,
		reuseExistingServer: false,
		timeout: 240_000,
	},
});
```

- [ ] **Step 2: Write `e2e/global-setup.ts`**

```ts
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

export default function globalSetup(): void {
	rmSync('e2e/.data', { recursive: true, force: true });
	mkdirSync('e2e/.data/media', { recursive: true });
	execSync('pnpm db:migrate', {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_PATH: 'e2e/.data/shoebox.db' },
	});
}
```

- [ ] **Step 3: Write `e2e/helpers/auth.ts`**

```ts
import type { Browser, Page } from '@playwright/test';

export const OWNER = { username: 'david', password: 'shoebox-e2e-pass-1' };

async function fillAuthForm(page: Page, username: string, password: string): Promise<void> {
	await page.locator('input[name="username"]').fill(username);
	const pw = page.locator('input[type="password"]');
	await pw.first().fill(password);
	if ((await pw.count()) > 1) await pw.nth(1).fill(password); // confirm field, if phase 01 added one
	await page.locator('button[type="submit"]').first().click();
}

/** First-run owner setup (or login on reruns), then persist cookies to statePath. */
export async function ensureOwnerState(browser: Browser, baseURL: string, statePath: string): Promise<void> {
	const page = await browser.newPage({ baseURL });
	await page.goto('/');
	if (page.url().includes('/setup')) {
		await fillAuthForm(page, OWNER.username, OWNER.password);
		await page.waitForURL((u) => !u.pathname.startsWith('/setup'));
	}
	if (page.url().includes('/login')) {
		await fillAuthForm(page, OWNER.username, OWNER.password);
		await page.waitForURL((u) => !u.pathname.startsWith('/login'));
	}
	await page.context().storageState({ path: statePath });
	await page.close();
}
```

- [ ] **Step 4: Write `e2e/helpers/seed.ts`**

Items are seeded through the real upload API (phase 02); people/tags/sprite rows are inserted directly (their APIs belong to phases 05–07). The 26-byte WebP is a valid 1×1 lossless image; card aspect comes from the DTO's width/height, not the file.

```ts
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';

export const TINY_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
export const TINY_MP4 = Buffer.from('AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t', 'base64');

export interface SeedSpec {
	type: 'video' | 'photo';
	dateStart: string;
	dateEnd?: string;
	precision: 'day' | 'month' | 'year' | 'range';
	title?: string;
	width: number;
	height: number;
	duration?: number;
}

/** Upload one item through /api/upload/{init,chunk,complete}; returns the item id. */
export async function seedItem(api: APIRequestContext, spec: SeedSpec, seq: number): Promise<string> {
	const base = spec.type === 'video' ? TINY_MP4 : TINY_WEBP;
	const bytes = Buffer.concat([base, Buffer.from(`seed-${seq}`)]); // unique sha per item
	const sha256 = createHash('sha256').update(bytes).digest('hex');

	const init = await api.post('/api/upload/init', {
		data: {
			sha256,
			sizeBytes: bytes.length,
			mime: spec.type === 'video' ? 'video/mp4' : 'image/webp',
			filename: `seed-${seq}.${spec.type === 'video' ? 'mp4' : 'webp'}`,
		},
	});
	if (!init.ok()) throw new Error(`upload/init ${init.status()}: ${await init.text()}`);
	const { uploadId } = (await init.json()) as { uploadId: string };

	const chunk = await api.fetch(`/api/upload/chunk?uploadId=${uploadId}&index=0`, {
		method: 'PUT',
		data: bytes,
		headers: { 'content-type': 'application/octet-stream' },
	});
	if (!chunk.ok()) throw new Error(`upload/chunk ${chunk.status()}: ${await chunk.text()}`);

	const meta = {
		type: spec.type,
		width: spec.width,
		height: spec.height,
		duration: spec.duration ?? null,
		dateStart: spec.dateStart,
		dateEnd: spec.dateEnd ?? spec.dateStart,
		datePrecision: spec.precision,
		title: spec.title ?? null,
	};
	const webpFile = (name: string) => ({ name, mimeType: 'image/webp', buffer: TINY_WEBP });
	const complete = await api.post('/api/upload/complete', {
		multipart: {
			uploadId,
			poster: webpFile('poster.webp'),
			thumb_400: webpFile('thumb_400.webp'),
			thumb_800: webpFile('thumb_800.webp'),
			thumb_1600: webpFile('thumb_1600.webp'),
			blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
			meta: JSON.stringify(meta),
		},
	});
	if (!complete.ok()) throw new Error(`upload/complete ${complete.status()}: ${await complete.text()}`);
	const body = (await complete.json()) as Record<string, unknown>;
	const id =
		(body.id as string | undefined) ??
		((body.item as Record<string, unknown> | undefined)?.id as string | undefined) ??
		(body.itemId as string | undefined);
	if (!id) throw new Error(`no item id in upload/complete response: ${JSON.stringify(body)}`);
	return id;
}

// ---- direct-DB seeding (people/tags APIs arrive in later phases) ----

const nowSec = () => Math.floor(Date.now() / 1000);

export function openDb(dbPath: string): Database.Database {
	return new Database(dbPath);
}
export function seedPerson(db: Database.Database, id: string, name: string): void {
	db.prepare('INSERT OR IGNORE INTO people (id, name, accent_color, created_at) VALUES (?, ?, ?, ?)').run(
		id, name, '#FA7B62', nowSec(),
	);
}
export function linkPerson(db: Database.Database, itemId: string, personId: string): void {
	db.prepare("INSERT OR IGNORE INTO item_people (item_id, person_id, source) VALUES (?, ?, 'manual')").run(
		itemId, personId,
	);
}
export function seedTag(db: Database.Database, id: string, name: string): void {
	db.prepare("INSERT OR IGNORE INTO tags (id, name, kind) VALUES (?, ?, 'topic')").run(id, name);
}
export function tagItem(db: Database.Database, itemId: string, tagId: string): void {
	db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId);
}
/** Sprite fixture: writes the file where storage-fs expects it and registers the item_files row. */
export function addSprite(db: Database.Database, mediaRoot: string, itemId: string): void {
	const key = `media/${itemId}/sprite.webp`;
	const path = join(mediaRoot, key);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, TINY_WEBP);
	db.prepare(
		'INSERT OR IGNORE INTO item_files (id, item_id, kind, storage_key, mime, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)',
	).run(`if_sprite_${itemId}`, itemId, 'sprite', key, 'image/webp', 1600, 900);
}
```

- [ ] **Step 5: Write `e2e/timeline.spec.ts`**

```ts
import { expect, request as pwRequest, test } from '@playwright/test';
import { ensureOwnerState } from './helpers/auth';
import { addSprite, linkPerson, openDb, seedItem, seedPerson, seedTag, tagItem } from './helpers/seed';

const STATE = 'e2e/.data/owner.json';
const DB_PATH = 'e2e/.data/shoebox.db';
const MEDIA_ROOT = 'e2e/.data/media';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: STATE });

test.beforeAll(async ({ browser }, testInfo) => {
	const baseURL = (testInfo.project.use.baseURL as string) ?? 'http://localhost:4173';
	await ensureOwnerState(browser, baseURL, STATE);
	const api = await pwRequest.newContext({ baseURL, storageState: STATE });

	const tl = (await (await api.get('/api/timeline')).json()) as { years: unknown[] };
	if (!tl.years || tl.years.length === 0) {
		let seq = 0;
		// --- 3 years of items, via the real upload API ---
		const vBirthday = await seedItem(api, { type: 'video', dateStart: '1994-06-14', precision: 'day', title: "Eric's birthday", width: 300, height: 220, duration: 42 }, seq++);
		const pCake = await seedItem(api, { type: 'photo', dateStart: '1994-06-14', precision: 'day', title: 'Cake on the porch', width: 300, height: 380 }, seq++);
		await seedItem(api, { type: 'video', dateStart: '1994-06-21', precision: 'day', title: 'Backyard', width: 300, height: 200, duration: 75 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year', title: 'Lake house', width: 300, height: 300 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1994-08-05', precision: 'day', title: 'August porch', width: 300, height: 240 }, seq++);
		for (let i = 0; i < 8; i++) {
			await seedItem(api, { type: 'photo', dateStart: `1994-09-${String(2 + i).padStart(2, '0')}`, precision: 'day', title: `September ${2 + i}`, width: 300, height: 260 + i * 20 }, seq++);
		}
		await seedItem(api, { type: 'photo', dateStart: '1993-03-10', precision: 'day', title: 'Spring 93', width: 300, height: 220 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1993-07-04', precision: 'day', title: 'Fourth 93', width: 300, height: 300 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1993-11-02', precision: 'day', title: 'Fall 93', width: 300, height: 250 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1995-02-01', precision: 'day', title: 'Winter 95', width: 300, height: 240 }, seq++);
		await seedItem(api, { type: 'photo', dateStart: '1995-08-15', precision: 'day', title: 'Summer 95', width: 300, height: 320 }, seq++);
		// --- people/tags/sprite fixture directly in the DB (APIs land in later phases) ---
		const db = openDb(DB_PATH);
		seedPerson(db, 'p_eric', 'Eric');
		seedPerson(db, 'p_mom', 'Mom');
		seedTag(db, 't_birthday', 'birthday');
		linkPerson(db, vBirthday, 'p_eric');
		linkPerson(db, pCake, 'p_eric');
		tagItem(db, vBirthday, 't_birthday');
		addSprite(db, MEDIA_ROOT, vBirthday);
		db.close();
	}
	await api.dispose();
});

test('deep link ?y renders that year chronologically with month breaks', async ({ page }) => {
	await page.goto('/?y=1994');
	const band = page.getByRole('slider', { name: 'Timeline year' });
	await expect(band).toHaveAttribute('aria-valuenow', '1994');
	// month breaks flow inside the grid, in order
	const june = page.getByText('JUNE', { exact: true });
	const august = page.getByText('AUGUST', { exact: true });
	await expect(june).toBeVisible();
	await expect(august).toBeVisible();
	const jy = (await june.boundingBox())!.y;
	const ay = (await august.boundingBox())!.y;
	expect(jy).toBeLessThan(ay);
	// captions: date left, people/title right; circa item; duration badge
	await expect(page.getByText('Dad · Eric').or(page.getByText('Eric')).first()).toBeVisible();
	await expect(page.getByText('c. 1994')).toBeVisible();
	await expect(page.getByText('0:42')).toBeVisible();
	// card links preserve list context
	const video = page.getByTestId('media-card').filter({ hasText: '0:42' });
	await expect(video).toHaveAttribute('href', /\/item\/.+\?(.*&)?y=1994/);
});

test('/ lands on the latest year with content', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('slider', { name: 'Timeline year' })).toHaveAttribute('aria-valuenow', '1995');
});

test('keyboard step changes year, URL, and decade room', async ({ page }) => {
	await page.goto('/?y=1990');
	await expect(page.locator('[data-decade]')).toHaveAttribute('data-decade', '1990');
	const band = page.getByRole('slider', { name: 'Timeline year' });
	await band.focus();
	await band.press('ArrowLeft');
	await page.waitForURL(/y=1989/);
	await expect(page.locator('[data-decade]')).toHaveAttribute('data-decade', '1980');
	await band.press('ArrowRight');
	await page.waitForURL(/y=1990/);
	await expect(page.locator('[data-decade]')).toHaveAttribute('data-decade', '1990');
});

test('dragging the band scrubs years', async ({ page }) => {
	await page.goto('/?y=1994');
	const band = page.getByRole('slider', { name: 'Timeline year' });
	const box = (await band.boundingBox())!;
	const cy = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width / 2, cy);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(box.x + box.width / 2 + i * 25, cy);
		await page.waitForTimeout(30); // slow drag → distance only, no momentum
	}
	await page.mouse.up();
	await expect
		.poll(async () => Number(await band.getAttribute('aria-valuenow')))
		.toBeLessThan(1994); // drag right = back in time
});

test('tapping a neighbor year jumps to it', async ({ page }) => {
	await page.goto('/?y=1994');
	await page.getByRole('button', { name: '1993', exact: true }).first().click();
	await page.waitForURL(/y=1993/);
	await expect(page.getByRole('slider', { name: 'Timeline year' })).toHaveAttribute('aria-valuenow', '1993');
});

test('hover-scrub: sprite card shows hairline and steps frames', async ({ page }) => {
	await page.goto('/?y=1994');
	const video = page.getByTestId('media-card').filter({ hasText: '0:42' });
	const box = (await video.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
	await expect(page.getByTestId('scrub-hairline')).toBeVisible();
	const pos1 = await video.locator('.sprite').evaluate((el) => getComputedStyle(el).backgroundPosition);
	await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.4);
	const pos2 = await video.locator('.sprite').evaluate((el) => getComputedStyle(el).backgroundPosition);
	expect(pos2).not.toBe(pos1);
	// non-sprite cards never scrub
	const photo = page.getByTestId('media-card').filter({ hasText: 'c. 1994' });
	const pbox = (await photo.boundingBox())!;
	await page.mouse.move(pbox.x + pbox.width * 0.5, pbox.y + pbox.height * 0.4);
	await expect(photo.getByTestId('scrub-hairline')).toHaveCount(0);
});

test('infinite scroll crosses into 1995 and docks the compact scrubber', async ({ page }) => {
	await page.goto('/?y=1994');
	await page.mouse.move(640, 600); // over the grid, not the band
	for (let i = 0; i < 12; i++) {
		await page.mouse.wheel(0, 1400);
		await page.waitForTimeout(150);
	}
	await expect(page.getByTestId('docked-band')).toBeVisible();
	await expect(page.getByText('FEBRUARY', { exact: true })).toBeVisible(); // 1995 loaded across the boundary
	await expect
		.poll(async () => new URL(page.url()).searchParams.get('y'))
		.toBe('1995'); // sentinel scroll-following via replaceState
});

test.describe('mobile', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('bottom rail, steppers and 2-col grid', async ({ page }) => {
		await page.goto('/?y=1994');
		await expect(page.getByTestId('mobile-rail')).toBeVisible();
		await expect(page.getByTestId('masonry-grid')).toHaveAttribute('data-cols', '2');
		await expect(page.getByRole('button', { name: 'Next year' })).toBeVisible();
		await page.getByRole('button', { name: 'Next year' }).click();
		await page.waitForURL(/y=1995/);
		await expect(page.getByTestId('century-rail')).toBeHidden(); // desktop rail replaced by the dock
	});
});
```

- [ ] **Step 6: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all 8 tests PASS. Debugging notes if not:
- `upload/complete` field mismatch → open `src/routes/api/upload/complete/+server.ts` (phase 02) and align the `meta` JSON keys / multipart field names in `e2e/helpers/seed.ts` (the helper, never the server) with what phase 02 actually reads.
- `aria-valuenow` stuck → check that phase 02's `/api/items` really sorts by `sort_date` ascending; the grid and sentinels assume it.

- [ ] **Step 7: Full-suite gate**

Run: `pnpm check && pnpm vitest run && pnpm test:e2e`
Expected: everything green.

- [ ] **Step 8: Final visual pass against the locked mockups**

With the e2e server still seeded (`PORT=4173 ORIGIN=http://localhost:4173 DATABASE_PATH=e2e/.data/shoebox.db MEDIA_PATH=e2e/.data/media node build` after `pnpm build`), open `http://localhost:4173/?y=1994` and compare side-by-side with `docs/superpowers/specs/mockups/timeline-home-locked.html` (top panel), then at 390px width with `person-and-mobile-locked.html` (right panel). Check every line:
- Room: '90s gradient (benihi ember wash, dawn pool upper-left, cream pool right), grain overlay, NO hard edges.
- Year band: 1992 · 1993 · **1994** · 1995 · 1996 with the locked size/opacity steps; ember shadow under the big numeral; sub-line "13 moments · 1 person" style matches "214 moments · 12 people" typography.
- Century rail: tick weights vary with density, 2px dots for empty years, ink ticks on the '90s room, bold 1900/2000, bold '90, ghosted future decade, and ZERO horizontal rules.
- Grid: 4 columns desktop / 2 mobile, 12px gaps, JUNE/AUGUST/SEPTEMBER month breaks as pure typography, duration badge mono bottom-right, captions in reduced-ink small caps, "c. 1994" on the circa card, no borders/radius/shadows/play buttons anywhere.
- Scrolled: slim ink docked bar with cream year + mini rail.
- Mobile: cream serif 78px year with 44px cream steppers; bottom dock fade with warmed active-decade ticks, glowing serif-labeled thumb, decade labels with '90 in dawn; safe-area padding.
- Toggle dark/light theme (phase 01 toggle): chrome stays AA-readable in both.
- Enable reduced motion (OS setting or comfort mode): decade change hard-cuts, no image fade, no smooth scroll.

Fix any deviation before committing (adjust the component, not the mockup).

- [ ] **Step 9: Commit**

```bash
git add playwright.config.ts e2e/global-setup.ts e2e/helpers/auth.ts e2e/helpers/seed.ts e2e/timeline.spec.ts
git commit -m "test: add timeline e2e coverage"
```

---

## Self-review (performed while writing; verified against spec §10 + master)

- **Scope coverage:** YearBand (giant year ~170px, two-step flanks, sub-line, drag+momentum, wheel, keys, neighbor taps, ARIA slider, docked compact bar) — Tasks 3/8/13. CenturyRail (span rule, sqrt ticks, 2px dots, ghosted future, bold century/active labels, decade→nearest-content, tick→year, no rules) — Tasks 1/7. Decade rooms (paletteFor, 300ms crossfade, reducedMotion gate, chromeOn ink/cream flip) — Task 9. MasonryGrid (JS masonry 4/3/2, windowed ±2 screens, ResizeObserver, stable keys, cursor infinite scroll across years, IO sentinels → band+URL, dock trigger) — Tasks 2/10/13. MonthBreak — Task 5. MediaCard (srcset, blurhash fade, zero radius/border/shadow, mono duration badge, caption row, circa, sprite scrub seam + fixture, context-preserving links) — Tasks 3/6. Unfiltered `/api/timeline` with people counts — Task 4. MobileRail — Tasks 1/12. Unit tests (masonry math, rail math, year-from-scroll) — Tasks 1/2. E2e (seed 3 years via API, chronology + month breaks, step/drag changes room, deep link, mobile rail + 2-col) — Task 14. Forbidden items (player, omnibox, filter chips, filtered timeline, sprite generation) — absent.
- **Placeholder scan:** no TBD/TODO/"similar to"; every file has full contents; every run step has a command and expected outcome. The only conditional steps are integration seams with phases 01–02 (vite/playwright config merge, Gradient prop name, upload meta keys), each with exact target content stated.
- **Signature consistency:** `YearCount {year,count,people}` used by rail-math ↔ YearBand ↔ CenturyRail ↔ MobileRail ↔ `/api/timeline` response; `GridEntry`/`MasonryPosition` shared by masonry ↔ MasonryGrid ↔ page; `CAPTION_H`/`MONTH_H` pinned to the components' CSS; `chromeVars` keys match every `var(--chrome-*)` consumer; `timelineYears` return type equals the endpoint JSON and `+page.ts` `TimelineDTO`.
