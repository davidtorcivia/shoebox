# Shoebox Phase 06 — Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Shoebox search end-to-end: the contentless FTS5 reindex pipeline wired into every mutation path, holiday derivation + auto-tagging on date writes, the omnibox parser, `GET /api/search` with structured filters (people AND-combos, tags, type, album, uploader, year windows, age windows), the `/search` page, and filtered timeline histograms.

**Architecture:** Pure domain logic (`holidays.ts`, `search-query.ts`) stays platform-free and unit-test heavy. `src/lib/server/search.ts` owns the FTS5 index (delete+insert per item against the contentless `search_fts` table, joined to `items` by rowid) and the SQL condition builder shared by `/api/search` and the filtered `/api/timeline`. Holiday auto-tagging lives in `src/lib/server/items.ts` as `applyHolidayTags` (exported as the seam Phase 07 Arrivals calls). Every mutation route from phases 02–05 gains a reindex call; a `pnpm db:reindex` script rebuilds from scratch.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM (`sql` template), SQLite FTS5 (better-sqlite3 / D1), Vitest, Playwright, pnpm, tsx.

**Master:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts are LAW. If this plan conflicts with the master, the master wins.

## Global Constraints

(Copied verbatim from the master plan — they apply to every task below.)

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

**Phase-06 additions (from spec §1 non-goals and phase scope — FORBIDDEN):**

- No natural-language search. No semantic embeddings. Structured omnibox + FTS5 only.
- No search-as-you-type dropdown/suggestions (YAGNI). The omnibox is a plain submit (Enter / button) that navigates to `/search?q=…`.
- `src/lib/server/search.ts` uses **relative imports only** (no `$lib` alias) so `scripts/db-reindex.ts` can import it under `tsx` outside the Vite alias graph.

## File Structure

```
Create:
  src/lib/domain/holidays.ts                     # HOLIDAYS registry, easterDate, holidaysFor (Contract 5)
  src/lib/domain/holidays.test.ts
  src/lib/domain/search-query.ts                 # parseOmnibox (Contract 5) + serializeQuery + ParsedOmnibox
  src/lib/domain/search-query.test.ts
  src/lib/server/db/migrations/<NNNN>_search-fts-v2.sql   # drizzle-kit --custom; recreates search_fts with contentless_delete=1
  src/lib/server/db/fts.test.ts                  # migration smoke test
  src/lib/server/platform/node-test-db.ts        # in-memory migrated test DB (only if phase 01 left no equivalent)
  src/lib/server/search.ts                       # reindexItem/reindexAll/fan-outs, ftsMatchExpr, buildItemConditions,
                                                 # executeSearch, filteredYearCounts, searchPeopleCards/searchAlbumCards
  src/lib/server/search.test.ts                  # reindex unit tests
  src/lib/server/search-exec.test.ts             # executeSearch unit tests (incl. Eric age-window proof)
  src/lib/server/search-cards.test.ts            # searchPeopleCards/searchAlbumCards unit tests
  src/lib/server/holiday-tags.test.ts            # applyHolidayTags unit tests
  src/lib/server/timeline-filter.test.ts         # filteredYearCounts unit tests
  scripts/db-reindex.ts                          # pnpm db:reindex
  src/routes/api/search/+server.ts               # GET /api/search (Contract 6)
  src/routes/search/+page.ts                     # loads /api/search from ?q= (URL = source of truth)
  src/routes/search/+page.svelte                 # omnibox, chips, people/albums rows, MasonryGrid, empty state
  e2e/search.spec.ts

Modify:
  src/lib/server/items.ts                        # + applyHolidayTags, enabledHolidaySet, itemDTOsByIds (wrapper)
  src/routes/api/items/+server.ts                # POST: holiday tags + reindex
  src/routes/api/items/[id]/+server.ts           # PATCH/DELETE: holiday tags + reindex
  src/routes/api/items/[id]/comments/+server.ts  # POST: reindex
  (comment-delete handler, located by grep)      # DELETE: reindex
  src/routes/api/people/[id]/+server.ts          # PATCH/DELETE: fan-out reindex
  (tag rename/delete handler, located by grep)   # PATCH/DELETE: fan-out reindex
  src/routes/api/albums/[id]/+server.ts          # PATCH/DELETE: fan-out reindex
  src/routes/api/albums/[id]/items/+server.ts    # membership changes: reindex per item
  src/routes/api/timeline/+server.ts             # + filtered-histogram branch
  src/routes/+page.svelte                        # timeline compact omnibox affordance
  package.json                                   # "db:reindex" script (+ tsx devDep if missing)
```

Phases 01–05 executed before this plan. Their plans own the exact internals of the files under "Modify"; every task that touches one starts with a read/grep verification step and states the adaptation rule. The master's Contract 6 route paths are LAW, so the route files above exist at exactly those paths.

---

### Task 1: Fixed-date holidays (`src/lib/domain/holidays.ts`)

**Files:**
- Create: `src/lib/domain/holidays.ts`
- Test: `src/lib/domain/holidays.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces:
  - `export interface HolidayDef { id: string; label: string }`
  - `export const HOLIDAYS: HolidayDef[]` — the full registry (15 ids), used by Task 8's settings seam and the Admin settings page (phase 08).
  - `export function holidaysFor(isoDate: string): string[]` — Contract 5 signature. This task implements the fixed-date subset; Task 2 completes it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/domain/holidays.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { holidaysFor, HOLIDAYS } from './holidays';

describe('holidaysFor — fixed-date holidays', () => {
  it('christmas 12-25', () => expect(holidaysFor('1994-12-25')).toContain('christmas'));
  it('christmas-eve 12-24', () => expect(holidaysFor('1994-12-24')).toContain('christmas-eve'));
  it('new-years-day 01-01', () => expect(holidaysFor('1995-01-01')).toContain('new-years-day'));
  it('new-years-eve 12-31', () => expect(holidaysFor('1994-12-31')).toContain('new-years-eve'));
  it('july-4th 07-04', () => expect(holidaysFor('1994-07-04')).toContain('july-4th'));
  it('halloween 10-31', () => expect(holidaysFor('1994-10-31')).toContain('halloween'));
  it('valentines 02-14', () => expect(holidaysFor('1994-02-14')).toContain('valentines'));
  it('st-patricks 03-17', () => expect(holidaysFor('1994-03-17')).toContain('st-patricks'));
  it('veterans-day 11-11', () => expect(holidaysFor('1994-11-11')).toContain('veterans-day'));
  it('a plain day returns []', () => expect(holidaysFor('1994-03-02')).toEqual([]));
  it('non-date input returns []', () => {
    expect(holidaysFor('')).toEqual([]);
    expect(holidaysFor('1994-12')).toEqual([]);
    expect(holidaysFor('garbage')).toEqual([]);
  });
  it('registry contains every fixed id', () => {
    const ids = HOLIDAYS.map((h) => h.id);
    for (const id of ['christmas','christmas-eve','new-years-day','new-years-eve','july-4th','halloween','valentines','st-patricks','veterans-day']) {
      expect(ids).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/domain/holidays.test.ts`
Expected: FAIL — `Failed to resolve import "./holidays"` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/domain/holidays.ts` (complete file — rule-based entries are registered now; their date logic lands in Task 2 behind `holidaysFor`'s rule block, which is empty in this task):

```ts
// src/lib/domain/holidays.ts — pure, platform-free (spec §4, master Contract 5)

export interface HolidayDef {
	id: string;
	label: string;
}

/** Full holiday registry. Tag names == ids (lowercase, satisfies tags.name rule). */
export const HOLIDAYS: HolidayDef[] = [
	{ id: 'new-years-day', label: "New Year's Day" },
	{ id: 'valentines', label: "Valentine's Day" },
	{ id: 'st-patricks', label: "St. Patrick's Day" },
	{ id: 'easter', label: 'Easter' },
	{ id: 'mothers-day', label: "Mother's Day" },
	{ id: 'memorial-day', label: 'Memorial Day' },
	{ id: 'fathers-day', label: "Father's Day" },
	{ id: 'july-4th', label: 'July 4th' },
	{ id: 'labor-day', label: 'Labor Day' },
	{ id: 'halloween', label: 'Halloween' },
	{ id: 'veterans-day', label: 'Veterans Day' },
	{ id: 'thanksgiving', label: 'Thanksgiving' },
	{ id: 'christmas-eve', label: 'Christmas Eve' },
	{ id: 'christmas', label: 'Christmas' },
	{ id: 'new-years-eve', label: "New Year's Eve" }
];

const FIXED: Record<string, string> = {
	'01-01': 'new-years-day',
	'02-14': 'valentines',
	'03-17': 'st-patricks',
	'07-04': 'july-4th',
	'10-31': 'halloween',
	'11-11': 'veterans-day',
	'12-24': 'christmas-eve',
	'12-25': 'christmas',
	'12-31': 'new-years-eve'
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Contract 5: holiday ids for an exact ISO date; [] for anything unparseable. */
export function holidaysFor(isoDate: string): string[] {
	const m = ISO_RE.exec(isoDate);
	if (!m) return [];
	const out: string[] = [];
	const fixed = FIXED[`${m[2]}-${m[3]}`];
	if (fixed) out.push(fixed);
	// Rule-based holidays (Thanksgiving, Mother's/Father's/Labor/Memorial Day, Easter)
	// are added in Task 2.
	return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/domain/holidays.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/holidays.ts src/lib/domain/holidays.test.ts
git commit -m "feat: fixed-date holiday derivation (holidaysFor, HOLIDAYS registry)"
```

---

### Task 2: Rule-based holidays + Easter (Anonymous Gregorian algorithm)

**Files:**
- Modify: `src/lib/domain/holidays.ts`
- Test: `src/lib/domain/holidays.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `holidaysFor` skeleton.
- Produces: `export function easterDate(year: number): string` (ISO date); `holidaysFor` now complete: thanksgiving (4th Thu Nov), mothers-day (2nd Sun May), fathers-day (3rd Sun Jun), labor-day (1st Mon Sep), memorial-day (last Mon May), easter.

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/domain/holidays.test.ts`:

```ts
import { easterDate } from './holidays';

describe('holidaysFor — rule-based holidays (known dates)', () => {
	it('Thanksgiving 1994 = Nov 24 (4th Thursday)', () => {
		expect(holidaysFor('1994-11-24')).toContain('thanksgiving');
		expect(holidaysFor('1994-11-17')).not.toContain('thanksgiving'); // 3rd Thursday
	});
	it('Thanksgiving 2023 = Nov 23', () => expect(holidaysFor('2023-11-23')).toContain('thanksgiving'));
	it("Mother's Day 1994 = May 8 (2nd Sunday)", () => {
		expect(holidaysFor('1994-05-08')).toContain('mothers-day');
		expect(holidaysFor('1994-05-01')).not.toContain('mothers-day');
	});
	it("Father's Day 1994 = Jun 19 (3rd Sunday)", () => expect(holidaysFor('1994-06-19')).toContain('fathers-day'));
	it('Labor Day 1994 = Sep 5 (1st Monday)', () => expect(holidaysFor('1994-09-05')).toContain('labor-day'));
	it('Memorial Day 1994 = May 30 (last Monday)', () => {
		expect(holidaysFor('1994-05-30')).toContain('memorial-day');
		expect(holidaysFor('1994-05-23')).not.toContain('memorial-day');
	});
});

describe('easterDate — Anonymous Gregorian algorithm', () => {
	it('Easter 1994 = April 3', () => expect(easterDate(1994)).toBe('1994-04-03'));
	it('Easter 2000 = April 23', () => expect(easterDate(2000)).toBe('2000-04-23'));
	it('Easter 2016 = March 27', () => expect(easterDate(2016)).toBe('2016-03-27'));
	it('Easter 1986 = March 30', () => expect(easterDate(1986)).toBe('1986-03-30'));
	it('Easter 2024 = March 31', () => expect(easterDate(2024)).toBe('2024-03-31'));
	it('holidaysFor tags Easter Sunday', () => expect(holidaysFor('1994-04-03')).toContain('easter'));
	it('holidaysFor does not tag the following Sunday', () => expect(holidaysFor('1994-04-10')).not.toContain('easter'));
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run src/lib/domain/holidays.test.ts`
Expected: FAIL — `easterDate` is not exported; rule-based assertions fail (e.g. `expect(['thanksgiving']).toContain(...)` receives `[]`).

- [ ] **Step 3: Complete the implementation**

In `src/lib/domain/holidays.ts`, replace the `holidaysFor` function and add the helpers below it (keep `HOLIDAYS`, `FIXED`, `ISO_RE` from Task 1):

```ts
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Day of week for Y-M-D (0 = Sunday). UTC-based — no timezone drift. */
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Day-of-month of the nth <weekday> (0=Sun..6=Sat) of month m in year y. */
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
	const offset = (weekday - dow(y, m, 1) + 7) % 7;
	return 1 + offset + (n - 1) * 7;
}

/** Day-of-month of the last <weekday> of month m in year y. */
function lastWeekday(y: number, m: number, weekday: number): number {
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return daysInMonth - ((dow(y, m, daysInMonth) - weekday + 7) % 7);
}

/** Easter Sunday (Gregorian) via the Anonymous Gregorian ("Meeus/Jones/Butcher") algorithm. */
export function easterDate(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return iso(year, month, day);
}

/** Contract 5: holiday ids for an exact ISO date; [] for anything unparseable. */
export function holidaysFor(isoDate: string): string[] {
	const match = ISO_RE.exec(isoDate);
	if (!match) return [];
	const y = Number(match[1]);
	const mo = Number(match[2]);
	const d = Number(match[3]);
	const out: string[] = [];
	const fixed = FIXED[`${match[2]}-${match[3]}`];
	if (fixed) out.push(fixed);
	if (mo === 11 && d === nthWeekday(y, 11, 4, 4)) out.push('thanksgiving');
	if (mo === 5 && d === nthWeekday(y, 5, 0, 2)) out.push('mothers-day');
	if (mo === 6 && d === nthWeekday(y, 6, 0, 3)) out.push('fathers-day');
	if (mo === 9 && d === nthWeekday(y, 9, 1, 1)) out.push('labor-day');
	if (mo === 5 && d === lastWeekday(y, 5, 1)) out.push('memorial-day');
	if (isoDate === easterDate(y)) out.push('easter');
	return out;
}
```

(Delete the Task-1 placeholder `holidaysFor` so there is exactly one export.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/domain/holidays.test.ts`
Expected: PASS (all tests, including Easter 1994-04-03 and Thanksgiving 1994-11-24).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/holidays.ts src/lib/domain/holidays.test.ts
git commit -m "feat: rule-based holidays + Easter (Anonymous Gregorian algorithm)"
```

---

### Task 3: Omnibox parser (`src/lib/domain/search-query.ts`)

**Files:**
- Create: `src/lib/domain/search-query.ts`
- Test: `src/lib/domain/search-query.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces (Contract 5, with one documented extension):
  - `export interface SearchQuery { text: string; people: string[]; tags: string[]; type?: 'video'|'photo'; album?: string; yearFrom?: number; yearTo?: number; age?: { person: string; min: number; max: number }; uploader?: string; }` — verbatim from the master.
  - `export type ParsedOmnibox = SearchQuery & { warnings: string[] }`
  - `export function parseOmnibox(input: string): ParsedOmnibox` — **documented extension of Contract 5**: the master declares the return type as `SearchQuery`; `ParsedOmnibox` is a structural subtype (`SearchQuery & { warnings: string[] }`), so every Contract-5 consumer that expects `SearchQuery` still typechecks unchanged. `warnings` carries non-fatal parse notes (ignored `age:` without exactly one `person:`, duplicate facets, malformed values).
  - `export function serializeQuery(q: SearchQuery): string` — inverse of `parseOmnibox` (canonical order), used by the `/search` chips (Task 12) and the timeline affordance (Task 13).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/domain/search-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseOmnibox, serializeQuery } from './search-query';

describe('parseOmnibox — basics', () => {
	it('empty input', () => {
		expect(parseOmnibox('')).toEqual({ text: '', people: [], tags: [], warnings: [] });
	});
	it('plain words become text', () => {
		expect(parseOmnibox('lake watermelon').text).toBe('lake watermelon');
	});
	it('quoted phrases are preserved in text', () => {
		expect(parseOmnibox('"birthday party" lake').text).toBe('"birthday party" lake');
	});
	it('unknown key:value tokens stay literal text', () => {
		expect(parseOmnibox('re:union').text).toBe('re:union');
	});
});

describe('parseOmnibox — person', () => {
	it('single word', () => expect(parseOmnibox('person:Mom').people).toEqual(['Mom']));
	it('quoted two words', () => expect(parseOmnibox('person:"Grandpa Joe"').people).toEqual(['Grandpa Joe']));
	it('repeatable → AND list', () =>
		expect(parseOmnibox('person:Mom person:"Grandpa Joe"').people).toEqual(['Mom', 'Grandpa Joe']));
	it('key is case-insensitive, value case preserved', () =>
		expect(parseOmnibox('PERSON:Mom').people).toEqual(['Mom']));
	it('exact duplicates are deduped case-insensitively', () =>
		expect(parseOmnibox('person:mom person:Mom').people).toEqual(['mom']));
});

describe('parseOmnibox — tag / type / album / uploader', () => {
	it('tags lowercase and dedupe', () =>
		expect(parseOmnibox('tag:Christmas tag:christmas tag:lake').tags).toEqual(['christmas', 'lake']));
	it('type video', () => expect(parseOmnibox('type:video').type).toBe('video'));
	it('type photo', () => expect(parseOmnibox('type:PHOTO').type).toBe('photo'));
	it('invalid type warns and is dropped', () => {
		const q = parseOmnibox('type:gif');
		expect(q.type).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});
	it('conflicting duplicate type warns, first wins', () => {
		const q = parseOmnibox('type:video type:photo');
		expect(q.type).toBe('video');
		expect(q.warnings).toHaveLength(1);
	});
	it('album quoted', () => expect(parseOmnibox('album:"Summer 94"').album).toBe('Summer 94'));
	it('duplicate album warns, first wins', () => {
		const q = parseOmnibox('album:A album:B');
		expect(q.album).toBe('A');
		expect(q.warnings).toHaveLength(1);
	});
	it('uploader', () => expect(parseOmnibox('uploader:david').uploader).toBe('david'));
});

describe('parseOmnibox — years', () => {
	it('range 1988..1999', () => {
		const q = parseOmnibox('1988..1999');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
	});
	it('bare year 1994 → from=to', () => {
		const q = parseOmnibox('1994');
		expect(q.yearFrom).toBe(1994);
		expect(q.yearTo).toBe(1994);
	});
	it('inverted range is swapped', () => {
		const q = parseOmnibox('1999..1988');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
	});
	it('second year token warns and is dropped', () => {
		const q = parseOmnibox('1994 1996');
		expect(q.yearFrom).toBe(1994);
		expect(q.yearTo).toBe(1994);
		expect(q.warnings).toHaveLength(1);
	});
	it('implausible 4-digit numbers stay text', () => {
		const q = parseOmnibox('0042');
		expect(q.yearFrom).toBeUndefined();
		expect(q.text).toBe('0042');
	});
	it('malformed range stays text', () => expect(parseOmnibox('1988..99').text).toBe('1988..99'));
});

describe('parseOmnibox — age', () => {
	it('age:5-7 with exactly one person', () => {
		expect(parseOmnibox('person:Mom age:5-7').age).toEqual({ person: 'Mom', min: 5, max: 7 });
	});
	it('age:5 → min=max', () => {
		expect(parseOmnibox('person:Mom age:5').age).toEqual({ person: 'Mom', min: 5, max: 5 });
	});
	it('inverted age range is swapped', () => {
		expect(parseOmnibox('person:Mom age:7-5').age).toEqual({ person: 'Mom', min: 5, max: 7 });
	});
	it('age with zero person tokens → warning, no age', () => {
		const q = parseOmnibox('age:5-7');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});
	it('age with two person tokens → warning, no age', () => {
		const q = parseOmnibox('person:Mom person:Dad age:5-7');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});
	it('malformed age → warning, no age', () => {
		const q = parseOmnibox('person:Mom age:abc');
		expect(q.age).toBeUndefined();
		expect(q.warnings).toHaveLength(1);
	});
	it('duplicate age token warns, first wins', () => {
		const q = parseOmnibox('person:Mom age:5 age:9');
		expect(q.age).toEqual({ person: 'Mom', min: 5, max: 5 });
		expect(q.warnings).toHaveLength(1);
	});
});

describe('parseOmnibox — the kitchen sink', () => {
	it('master example: person:Mom age:5-7 tag:christmas type:video 1988..1999', () => {
		const q = parseOmnibox('person:Mom age:5-7 tag:christmas type:video 1988..1999 lake "birthday party"');
		expect(q.people).toEqual(['Mom']);
		expect(q.age).toEqual({ person: 'Mom', min: 5, max: 7 });
		expect(q.tags).toEqual(['christmas']);
		expect(q.type).toBe('video');
		expect(q.yearFrom).toBe(1988);
		expect(q.yearTo).toBe(1999);
		expect(q.text).toBe('lake "birthday party"');
		expect(q.warnings).toEqual([]);
	});
});

describe('serializeQuery', () => {
	it('round-trips the kitchen sink (canonical order)', () => {
		const input = 'person:Mom age:5-7 tag:christmas type:video 1988..1999 lake "birthday party"';
		const q = parseOmnibox(input);
		const s = serializeQuery(q);
		expect(parseOmnibox(s)).toEqual(q);
	});
	it('quotes multi-word values', () => {
		expect(serializeQuery({ text: '', people: ['Grandpa Joe'], tags: [] })).toBe('person:"Grandpa Joe"');
	});
	it('single year serializes bare', () => {
		expect(serializeQuery({ text: '', people: [], tags: [], yearFrom: 1994, yearTo: 1994 })).toBe('1994');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/domain/search-query.test.ts`
Expected: FAIL — `Failed to resolve import "./search-query"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/domain/search-query.ts` (complete file):

```ts
// src/lib/domain/search-query.ts — omnibox chip parser (master Contract 5)

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

/**
 * Documented Contract-5 extension (plan 06): parseOmnibox returns
 * `SearchQuery & { warnings: string[] }`. It is a structural subtype of
 * SearchQuery, so every consumer typed against Contract 5 keeps working.
 * warnings carries non-fatal parse notes (e.g. an `age:` token ignored
 * because the query did not contain exactly one `person:` token).
 */
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
			q.warnings.push(`Ignored "${token}" — a year filter is already set`);
			return;
		}
		if (from > to) [from, to] = [to, from];
		q.yearFrom = from;
		q.yearTo = to;
	};

	for (const m of input.matchAll(TOKEN_RE)) {
		const key = (m[1] ?? m[3])?.toLowerCase();
		const val = m[2] ?? m[4];
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
					if (t !== 'video' && t !== 'photo') q.warnings.push(`Ignored type:${val} — expected video or photo`);
					else if (q.type && q.type !== t) q.warnings.push(`Ignored type:${t} — already filtering type:${q.type}`);
					else q.type = t;
					break;
				}
				case 'album': {
					const v = val.trim();
					if (!v) break;
					if (q.album) q.warnings.push(`Ignored album:${v} — already filtering album:${q.album}`);
					else q.album = v;
					break;
				}
				case 'uploader': {
					const v = val.trim();
					if (!v) break;
					if (q.uploader) q.warnings.push(`Ignored uploader:${v} — already filtering uploader:${q.uploader}`);
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
		if (m[5] !== undefined) {
			// bare quoted phrase — keep quotes so the FTS layer can build a phrase query
			if (m[5].trim()) textParts.push(`"${m[5]}"`);
			continue;
		}
		const word = m[6] ?? m[0]; // plain word, or unknown key:value kept literal
		const range = /^(\d{4})\.\.(\d{4})$/.exec(word);
		if (range) {
			setYears(Number(range[1]), Number(range[2]), word);
			continue;
		}
		if (/^\d{4}$/.test(word)) {
			const y = Number(word);
			if (y >= YEAR_MIN && y <= YEAR_MAX) {
				setYears(y, y, word);
				continue;
			}
		}
		textParts.push(word);
	}

	// dedupe (people case-insensitively, first spelling wins; tags exactly)
	q.people = [...new Map(q.people.map((p) => [p.toLowerCase(), p])).values()];
	q.tags = [...new Set(q.tags)];

	if (ageToken !== null) {
		const am = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(ageToken);
		if (!am) {
			q.warnings.push(`Ignored age:${ageToken} — expected age:N or age:N-M`);
		} else if (q.people.length !== 1) {
			q.warnings.push(`Ignored age:${ageToken} — age needs exactly one person: filter (got ${q.people.length})`);
		} else {
			let min = Number(am[1]);
			let max = am[2] !== undefined ? Number(am[2]) : min;
			if (min > max) [min, max] = [max, min];
			q.age = { person: q.people[0], min, max };
		}
	}

	q.text = textParts.join(' ');
	return q;
}

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

/** Inverse of parseOmnibox (canonical order). warnings are never serialized. */
export function serializeQuery(q: SearchQuery): string {
	const parts: string[] = [];
	for (const p of q.people) parts.push(`person:${quote(p)}`);
	if (q.age) parts.push(q.age.min === q.age.max ? `age:${q.age.min}` : `age:${q.age.min}-${q.age.max}`);
	for (const t of q.tags) parts.push(`tag:${quote(t)}`);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/domain/search-query.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/search-query.ts src/lib/domain/search-query.test.ts
git commit -m "feat: omnibox parser with typed chips, warnings, and serializer"
```

---

### Task 4: FTS5 migration v2 (`contentless_delete=1`) + test DB helper

The master's Contract 1 mandates a contentless (`content=''`) `search_fts` table maintained by a delete+insert pattern. A plain contentless FTS5 table cannot delete a row without replaying the exact old column values — which we don't have after a mutation. SQLite ≥ 3.43 solves this with the `contentless_delete=1` option: `DELETE FROM search_fts WHERE rowid = ?` then a fresh `INSERT` — still delete+insert, no old values needed. We add a migration that recreates the table with that option, and we key `search_fts.rowid` to `items.rowid` (items is a rowid table; its rowid is stable for the life of the row). This is Resolution R1 in "Ambiguities & Resolutions" below.

**Files:**
- Create: `src/lib/server/db/migrations/<NNNN>_search-fts-v2.sql` (numbered by drizzle-kit)
- Create: `src/lib/server/platform/node-test-db.ts` (only if no equivalent exists from phase 01)
- Test: `src/lib/server/db/fts.test.ts`

**Interfaces:**
- Consumes: phase 01's Drizzle migrations dir `src/lib/server/db/migrations/` + `drizzle.config.ts`; phase 01's original `search_fts` migration.
- Produces:
  - `search_fts(item_id UNINDEXED, title, description, people, tags, albums, comments)` with `content=''`, `contentless_delete=1`, `tokenize='unicode61 remove_diacritics 2'`; row keyed by `rowid = items.rowid`.
  - `export function makeTestDb(): { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database; schema: typeof schema }` in `src/lib/server/platform/node-test-db.ts` — used by every server unit test in Tasks 5, 8, 9, 11.

- [ ] **Step 1: Check for an existing test-DB helper from phase 01**

Run: `grep -rn "':memory:'" src --include='*.ts' | grep -v node_modules`
- If a phase-01 helper already builds an in-memory migrated Drizzle DB, reuse it everywhere this plan says `makeTestDb` (adjust the import path in each test file; the factory must run all migrations).
- If nothing is found, create the file in Step 4.

- [ ] **Step 2: Write the failing migration smoke test**

Create `src/lib/server/db/fts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from '../platform/node-test-db';

describe('search_fts v2 migration (contentless + contentless_delete)', () => {
	it('runs on SQLite >= 3.43', () => {
		const { sqlite } = makeTestDb();
		const { v } = sqlite.prepare('select sqlite_version() as v').get() as { v: string };
		const [maj, min] = v.split('.').map(Number);
		expect(maj > 3 || (maj === 3 && min >= 43)).toBe(true);
	});

	it('supports insert, MATCH by rowid, and plain DELETE by rowid', async () => {
		const { db } = makeTestDb();
		await db.run(
			sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments)
			    VALUES (1, 'it_x', 'Lake day', 'eating watermelon', 'Eric', 'summer', 'Summers', 'great clip')`
		);
		const hits = (await db.all(sql`SELECT rowid AS r FROM search_fts WHERE search_fts MATCH '"watermelon"'`)) as { r: number }[];
		expect(hits.map((h) => h.r)).toEqual([1]);

		// Without contentless_delete=1 this DELETE throws
		// "cannot DELETE from contentless fts5 table: search_fts".
		await db.run(sql`DELETE FROM search_fts WHERE rowid = 1`);
		const after = (await db.all(sql`SELECT rowid FROM search_fts WHERE search_fts MATCH '"watermelon"'`)) as unknown[];
		expect(after).toEqual([]);
	});

	it('delete-all command wipes the index', async () => {
		const { db } = makeTestDb();
		await db.run(sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments) VALUES (2, 'it_y', 'Bike', '', '', '', '', '')`);
		await db.run(sql`INSERT INTO search_fts(search_fts) VALUES ('delete-all')`);
		expect((await db.all(sql`SELECT rowid FROM search_fts WHERE search_fts MATCH '"bike"'`)) as unknown[]).toEqual([]);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/db/fts.test.ts`
Expected: FAIL — either `Failed to resolve import "../platform/node-test-db"` or (if a helper exists and the old migration is contentless without `contentless_delete`) `SqliteError: cannot DELETE from contentless fts5 table: search_fts`.

- [ ] **Step 4: Create the test-DB helper (if Step 1 found none)**

Create `src/lib/server/platform/node-test-db.ts` (node-only test helper; the `platform/node*` filename keeps the master's runtime-portability rule satisfied — no runtime module imports this file):

```ts
// src/lib/server/platform/node-test-db.ts — TEST-ONLY. Never import from runtime code.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';

export function makeTestDb() {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
	return { db, sqlite, schema };
}
```

- [ ] **Step 5: Generate and fill the custom migration**

Run: `pnpm drizzle-kit generate --custom --name=search-fts-v2`
Expected output ends with a created file path like `src/lib/server/db/migrations/0006_search-fts-v2.sql` (the number depends on how many migrations phases 01–05 created — use whatever drizzle-kit prints).

Replace that file's contents with exactly:

```sql
DROP TABLE IF EXISTS search_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE search_fts USING fts5(
  item_id UNINDEXED,
  title,
  description,
  people,
  tags,
  albums,
  comments,
  content='',
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
);
```

Note for existing databases: this migration empties the index; `pnpm db:reindex` (Task 7) rebuilds it. Fresh installs are unaffected (writes keep it current via Task 6).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/db/fts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify the whole suite still passes (migration replay)**

Run: `pnpm check && pnpm test`
Expected: both green (existing phase 01–05 tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/db/migrations src/lib/server/platform/node-test-db.ts src/lib/server/db/fts.test.ts
git commit -m "feat: recreate search_fts with contentless_delete=1 keyed to items.rowid"
```

---

### Task 5: `src/lib/server/search.ts` — reindexItem / reindexAll / fan-outs / ftsMatchExpr

**Files:**
- Create: `src/lib/server/search.ts` (if phase 01 stubbed it, replace the stub: check with `cat src/lib/server/search.ts 2>/dev/null`)
- Test: `src/lib/server/search.test.ts`

**Interfaces:**
- Consumes: `search_fts` v2 (Task 4); `Db` type — verify with `grep -n "export type Db" src/lib/server/db/index.ts` (the master defines `Db = ReturnType<typeof drizzle>` in `App.Locals`; if the export lives elsewhere or is named differently, adjust the type-only import — it is erased at runtime).
- Produces (later tasks + phase 07 rely on these exact names):
  - `export async function reindexItem(db: Db, itemId: string): Promise<void>` — delete+insert of the item's FTS row (title, description, people names, tag names, album titles, non-deleted comment bodies). Soft-deleted or missing items are simply removed from the index.
  - `export async function reindexAll(db: Db): Promise<number>` — `'delete-all'` then reindex every non-deleted item; returns the count.
  - `export async function reindexItemsForPerson(db: Db, personId: string): Promise<void>`
  - `export async function reindexItemsForTag(db: Db, tagId: string): Promise<void>`
  - `export async function reindexItemsForAlbum(db: Db, albumId: string): Promise<void>`
  - `export function ftsMatchExpr(text: string): string` — safe FTS5 MATCH string: every token double-quoted (internal `"` doubled), quoted phrases kept as FTS phrases; `''` when nothing usable.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/search.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './platform/node-test-db';
import {
	reindexItem,
	reindexAll,
	reindexItemsForPerson,
	reindexItemsForTag,
	reindexItemsForAlbum,
	ftsMatchExpr
} from './search';

type TestCtx = ReturnType<typeof makeTestDb>;
let ctx: TestCtx;

function seedBase(c: TestCtx) {
	const { db, schema } = c;
	db.insert(schema.users)
		.values({ id: 'u_owner', username: 'owner', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', createdAt: new Date() })
		.run();
}

function seedItem(
	c: TestCtx,
	o: { id: string; title?: string; description?: string; dateStart?: string; precision?: 'day' | 'month' | 'year' | 'range' | 'unknown'; type?: 'video' | 'photo' }
) {
	c.db
		.insert(c.schema.items)
		.values({
			id: o.id,
			type: o.type ?? 'photo',
			title: o.title ?? null,
			description: o.description ?? null,
			dateStart: o.dateStart ?? null,
			dateEnd: o.dateStart ?? null,
			datePrecision: o.precision ?? (o.dateStart ? 'day' : 'unknown'),
			sortDate: o.dateStart ?? null,
			width: 1,
			height: 1,
			sizeBytes: 1,
			sha256: `sha_${o.id}`,
			source: 'upload',
			status: 'ready',
			uploadedBy: 'u_owner',
			createdAt: new Date()
		})
		.run();
}

async function matchIds(c: TestCtx, expr: string): Promise<string[]> {
	const rows = (await c.db.all(
		sql`SELECT i.id AS id FROM items i WHERE i.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ${expr})`
	)) as { id: string }[];
	return rows.map((r) => r.id).sort();
}

beforeEach(() => {
	ctx = makeTestDb();
	seedBase(ctx);
});

describe('ftsMatchExpr', () => {
	it('quotes plain tokens', () => expect(ftsMatchExpr('lake watermelon')).toBe('"lake" "watermelon"'));
	it('keeps quoted phrases as FTS phrases', () => expect(ftsMatchExpr('"birthday party" lake')).toBe('"birthday party" "lake"'));
	it('doubles embedded quotes', () => expect(ftsMatchExpr('say"cheese')).toBe('"say""cheese"'));
	it('drops pure punctuation', () => expect(ftsMatchExpr('--- ...')).toBe(''));
	it('empty in, empty out', () => expect(ftsMatchExpr('   ')).toBe(''));
});

describe('reindexItem — composes every FTS column', () => {
	beforeEach(async () => {
		const { db, schema } = ctx;
		seedItem(ctx, { id: 'it_1', title: 'Lake day', description: 'Eating watermelon at the lake' });
		db.insert(schema.people).values({ id: 'p_eric', name: 'Eric', accentColor: '#A8D8EA', createdAt: new Date() }).run();
		db.insert(schema.itemPeople).values({ itemId: 'it_1', personId: 'p_eric', source: 'manual' }).run();
		db.insert(schema.tags).values({ id: 't_sum', name: 'summer', kind: 'topic' }).run();
		db.insert(schema.itemTags).values({ itemId: 'it_1', tagId: 't_sum' }).run();
		db.insert(schema.albums).values({ id: 'a_94', title: 'Summers', createdBy: 'u_owner', createdAt: new Date() }).run();
		db.insert(schema.albumItems).values({ albumId: 'a_94', itemId: 'it_1', position: 0 }).run();
		db.insert(schema.comments).values({ id: 'c_1', itemId: 'it_1', userId: 'u_owner', body: 'the famous cannonball', createdAt: new Date() }).run();
		await reindexItem(db, 'it_1');
	});

	it('matches title', async () => expect(await matchIds(ctx, '"lake"')).toEqual(['it_1']));
	it('matches description', async () => expect(await matchIds(ctx, '"watermelon"')).toEqual(['it_1']));
	it('matches person name', async () => expect(await matchIds(ctx, '"eric"')).toEqual(['it_1']));
	it('matches tag name', async () => expect(await matchIds(ctx, '"summer"')).toEqual(['it_1']));
	it('matches album title', async () => expect(await matchIds(ctx, '"summers"')).toEqual(['it_1']));
	it('matches comment body', async () => expect(await matchIds(ctx, '"cannonball"')).toEqual(['it_1']));

	it('re-running replaces (no duplicate rows, stale terms gone)', async () => {
		await ctx.db.run(sql`UPDATE items SET description = 'sandcastles all afternoon' WHERE id = 'it_1'`);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"watermelon"')).toEqual([]);
		expect(await matchIds(ctx, '"sandcastles"')).toEqual(['it_1']);
	});

	it('deleted comments are excluded', async () => {
		await ctx.db.run(sql`UPDATE comments SET deleted_at = 1 WHERE id = 'c_1'`);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"cannonball"')).toEqual([]);
	});

	it('soft-deleted item is removed from the index', async () => {
		await ctx.db.run(sql`UPDATE items SET deleted_at = 1 WHERE id = 'it_1'`);
		await reindexItem(ctx.db, 'it_1');
		expect(await matchIds(ctx, '"lake"')).toEqual([]);
	});
});

describe('fan-out reindex helpers', () => {
	beforeEach(async () => {
		const { db, schema } = ctx;
		seedItem(ctx, { id: 'it_a', title: 'A' });
		seedItem(ctx, { id: 'it_b', title: 'B' });
		db.insert(schema.people).values({ id: 'p_x', name: 'Eric', accentColor: '#A8D8EA', createdAt: new Date() }).run();
		db.insert(schema.itemPeople).values([{ itemId: 'it_a', personId: 'p_x', source: 'manual' }, { itemId: 'it_b', personId: 'p_x', source: 'manual' }]).run();
		db.insert(schema.tags).values({ id: 't_x', name: 'boat', kind: 'topic' }).run();
		db.insert(schema.itemTags).values({ itemId: 'it_a', tagId: 't_x' }).run();
		db.insert(schema.albums).values({ id: 'al_x', title: 'Voyages', createdBy: 'u_owner', createdAt: new Date() }).run();
		db.insert(schema.albumItems).values({ albumId: 'al_x', itemId: 'it_b', position: 0 }).run();
		await reindexAll(db);
	});

	it('person rename → reindexItemsForPerson updates all their items', async () => {
		await ctx.db.run(sql`UPDATE people SET name = 'Eric Junior' WHERE id = 'p_x'`);
		await reindexItemsForPerson(ctx.db, 'p_x');
		expect(await matchIds(ctx, '"junior"')).toEqual(['it_a', 'it_b']);
	});

	it('tag rename → reindexItemsForTag', async () => {
		await ctx.db.run(sql`UPDATE tags SET name = 'sailboat' WHERE id = 't_x'`);
		await reindexItemsForTag(ctx.db, 't_x');
		expect(await matchIds(ctx, '"sailboat"')).toEqual(['it_a']);
		expect(await matchIds(ctx, '"boat"')).toEqual([]);
	});

	it('album rename → reindexItemsForAlbum', async () => {
		await ctx.db.run(sql`UPDATE albums SET title = 'Odysseys' WHERE id = 'al_x'`);
		await reindexItemsForAlbum(ctx.db, 'al_x');
		expect(await matchIds(ctx, '"odysseys"')).toEqual(['it_b']);
	});

	it('reindexAll wipes and rebuilds, skipping soft-deleted items', async () => {
		await ctx.db.run(sql`UPDATE items SET deleted_at = 1 WHERE id = 'it_b'`);
		const n = await reindexAll(ctx.db);
		expect(n).toBe(1);
		expect(await matchIds(ctx, '"a"')).toEqual(['it_a']);
		expect(await matchIds(ctx, '"b"')).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/search.test.ts`
Expected: FAIL — `Failed to resolve import "./search"` (or missing exports if a phase-01 stub exists).

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/search.ts` (complete file; **relative imports only** — see Global Constraints):

```ts
// src/lib/server/search.ts — FTS5 index maintenance + query building.
// Contentless search_fts (content='', contentless_delete=1); row keyed by items.rowid.
// Relative imports only: scripts/db-reindex.ts loads this file under tsx, outside Vite.
import { sql } from 'drizzle-orm';
import type { Db } from './db';

type Row = Record<string, unknown>;

const joinNames = (rows: Row[], col: string) => rows.map((r) => String(r[col] ?? '')).join(' ');

/**
 * Rebuild one item's FTS row: DELETE by rowid, then INSERT the freshly composed
 * document (title, description, people names, tag names, album titles, live
 * comment bodies). Missing or soft-deleted items end up absent from the index.
 * Call this AFTER the mutation is committed.
 */
export async function reindexItem(db: Db, itemId: string): Promise<void> {
	const items = (await db.all(
		sql`SELECT rowid AS rid, title, description, deleted_at AS del FROM items WHERE id = ${itemId}`
	)) as Array<{ rid: number; title: string | null; description: string | null; del: number | null }>;
	const item = items[0];
	if (!item) return;

	await db.run(sql`DELETE FROM search_fts WHERE rowid = ${item.rid}`);
	if (item.del != null) return;

	const people = (await db.all(
		sql`SELECT p.name AS v FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ${itemId}`
	)) as Row[];
	const tags = (await db.all(
		sql`SELECT t.name AS v FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ${itemId}`
	)) as Row[];
	const albums = (await db.all(
		sql`SELECT a.title AS v FROM album_items ai JOIN albums a ON a.id = ai.album_id WHERE ai.item_id = ${itemId} AND a.deleted_at IS NULL`
	)) as Row[];
	const comments = (await db.all(
		sql`SELECT c.body AS v FROM comments c WHERE c.item_id = ${itemId} AND c.deleted_at IS NULL`
	)) as Row[];

	await db.run(
		sql`INSERT INTO search_fts (rowid, item_id, title, description, people, tags, albums, comments)
		    VALUES (${item.rid}, ${itemId}, ${item.title ?? ''}, ${item.description ?? ''},
		            ${joinNames(people, 'v')}, ${joinNames(tags, 'v')}, ${joinNames(albums, 'v')}, ${joinNames(comments, 'v')})`
	);
}

/** Wipe the whole index and rebuild it from every non-deleted item. Returns item count. */
export async function reindexAll(db: Db): Promise<number> {
	await db.run(sql`INSERT INTO search_fts(search_fts) VALUES ('delete-all')`);
	const rows = (await db.all(sql`SELECT id FROM items WHERE deleted_at IS NULL`)) as Array<{ id: string }>;
	for (const r of rows) await reindexItem(db, r.id);
	return rows.length;
}

async function reindexIds(db: Db, rows: Array<{ id: string }>): Promise<void> {
	for (const r of rows) await reindexItem(db, r.id);
}

/** After a person rename/delete: rebuild every item they appear in. */
export async function reindexItemsForPerson(db: Db, personId: string): Promise<void> {
	await reindexIds(db, (await db.all(sql`SELECT item_id AS id FROM item_people WHERE person_id = ${personId}`)) as Array<{ id: string }>);
}

/** After a tag rename/delete: rebuild every item carrying it. */
export async function reindexItemsForTag(db: Db, tagId: string): Promise<void> {
	await reindexIds(db, (await db.all(sql`SELECT item_id AS id FROM item_tags WHERE tag_id = ${tagId}`)) as Array<{ id: string }>);
}

/** After an album rename/delete: rebuild every member item. */
export async function reindexItemsForAlbum(db: Db, albumId: string): Promise<void> {
	await reindexIds(db, (await db.all(sql`SELECT item_id AS id FROM album_items WHERE album_id = ${albumId}`)) as Array<{ id: string }>);
}

/**
 * Build a safe FTS5 MATCH expression from free text: each token double-quoted
 * (embedded quotes doubled), quoted input phrases kept as FTS phrases.
 * Returns '' when no usable token remains.
 */
export function ftsMatchExpr(text: string): string {
	const tokens: string[] = [];
	for (const m of text.matchAll(/"([^"]*)"|(\S+)/g)) {
		const raw = (m[1] ?? m[2] ?? '').trim();
		if (!/[0-9A-Za-zÀ-￿]/.test(raw)) continue; // pure punctuation
		tokens.push(`"${raw.replace(/"/g, '""')}"`);
	}
	return tokens.join(' ');
}
```

Verification: `grep -n "export type Db" src/lib/server/db/index.ts` — if the type is exported under another name/path, change the type-only import to match (runtime-safe: type imports are erased).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/search.test.ts src/lib/server/db/fts.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/search.ts src/lib/server/search.test.ts
git commit -m "feat: contentless FTS5 reindexItem/reindexAll + fan-out helpers"
```

---

### Task 6: Wire `reindexItem` into every mutation path (phases 02–05)

Rule this task enforces: **every code path that writes `items`, `item_people`, `item_tags`, `album_items`, `comments`, `people.name`, `tags.name`, or `albums.title` must end by awaiting the matching reindex helper** — after the DB write succeeds, before the response is built.

**Files (Contract-6 route paths are LAW; handler internals come from phases 02–05, so each edit starts with a read step):**
- Modify: `src/routes/api/items/+server.ts` (POST)
- Modify: `src/routes/api/items/[id]/+server.ts` (PATCH, DELETE)
- Modify: `src/routes/api/items/[id]/comments/+server.ts` (POST)
- Modify: comment-delete handler (located in Step 1)
- Modify: `src/routes/api/people/[id]/+server.ts` (PATCH, DELETE)
- Modify: tag rename/delete handler if one exists (located in Step 1)
- Modify: `src/routes/api/albums/[id]/+server.ts` (PATCH, DELETE)
- Modify: `src/routes/api/albums/[id]/items/+server.ts` (membership add/remove/reorder)
- Test: covered by Task 5 unit tests (helpers) + Task 14 e2e (rename-updates-FTS golden path); this task adds the audit in Step 5.

**Interfaces:**
- Consumes: `reindexItem`, `reindexItemsForPerson`, `reindexItemsForTag`, `reindexItemsForAlbum` (Task 5).
- Produces: fully self-maintaining index for phases 02–05 mutation surfaces. (Phase 07 Arrivals must call `applyHolidayTags` + `reindexItem` itself — seam documented in Task 8.)

- [ ] **Step 1: Locate every mutation handler**

Run each and note the hits (these are the wiring worklist — if phases 02–05 centralized mutations in `src/lib/server/{items,people,albums,comments}.ts` functions called by the routes, put each call inside the server-module function instead of the route so it can never be bypassed; one call site per mutation either way):

```bash
grep -rn "export const \(POST\|PATCH\|PUT\|DELETE\)" src/routes/api --include='+server.ts'
grep -rln "itemPeople\|item_people\|itemTags\|item_tags\|albumItems\|album_items" src/lib/server src/routes/api --include='*.ts' | grep -v -e search -e test
grep -rn "export async function" src/lib/server/items.ts src/lib/server/people.ts src/lib/server/albums.ts src/lib/server/comments.ts
```

- [ ] **Step 2: Wire item + comment mutations**

In each file add the import (adjusting nothing else):

```ts
import { reindexItem } from '$lib/server/search';
```

Then insert after the successful write, before the response:

| File | Handler | Insert |
|---|---|---|
| `src/routes/api/items/+server.ts` | `POST` (item create) | `await reindexItem(locals.db, itemId);` (`itemId` = the id of the row just created) |
| `src/routes/api/items/[id]/+server.ts` | `PATCH` (metadata incl. people/tags arrays) | `await reindexItem(locals.db, params.id);` |
| `src/routes/api/items/[id]/+server.ts` | `DELETE` (soft delete) | `await reindexItem(locals.db, params.id);` (drops the FTS row — Task 5 handles soft-deleted) |
| `src/routes/api/items/[id]/comments/+server.ts` | `POST` (comment create) | `await reindexItem(locals.db, params.id);` |
| comment-delete handler (from Step 1; e.g. `src/routes/api/comments/[id]/+server.ts`) | `DELETE` | look up the comment's `item_id` **before** soft-deleting, then `await reindexItem(locals.db, itemIdOfComment);` |

If item people/tag changes go through a dedicated endpoint found in Step 1 (e.g. `/api/items/[id]/people`), add `await reindexItem(locals.db, params.id);` there too.

- [ ] **Step 3: Wire person / tag / album renames and deletes (fan-outs)**

Imports: `import { reindexItemsForPerson, reindexItemsForTag, reindexItemsForAlbum, reindexItem } from '$lib/server/search';`

| File | Handler | Insert |
|---|---|---|
| `src/routes/api/people/[id]/+server.ts` | `PATCH` | after the update, if the request changed `name`: `await reindexItemsForPerson(locals.db, params.id);` |
| `src/routes/api/people/[id]/+server.ts` | `DELETE` | **capture first**: `const affected = await locals.db.all(sql`SELECT item_id AS id FROM item_people WHERE person_id = ${params.id}`);` → perform the delete → `for (const r of affected as {id:string}[]) await reindexItem(locals.db, r.id);` |
| tag rename/delete handler (Step 1; Contract 6 lists only `GET/POST /api/tags` — if phase 05 added `PATCH/DELETE /api/tags/[id]`, wire it; if no such endpoint exists, there is nothing to wire and the audit in Step 5 is the proof) | `PATCH` / `DELETE` | `await reindexItemsForTag(locals.db, params.id);` (for DELETE: capture `item_tags` ids first, delete, then loop `reindexItem` — same pattern as person DELETE) |
| `src/routes/api/albums/[id]/+server.ts` | `PATCH` (rename) | `await reindexItemsForAlbum(locals.db, params.id);` |
| `src/routes/api/albums/[id]/+server.ts` | `DELETE` (soft) | `await reindexItemsForAlbum(locals.db, params.id);` (album now soft-deleted, so each item re-composes without its title) |
| `src/routes/api/albums/[id]/items/+server.ts` | membership `POST`/`DELETE`/`PATCH` | for every itemId added or removed: `await reindexItem(locals.db, thatItemId);` (reorder-only position batches change no FTS content — skip pure reorders) |

- [ ] **Step 4: Typecheck**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 5: Audit — no unwired mutation path**

Run:

```bash
grep -rln "itemPeople\|item_people\|itemTags\|item_tags\|albumItems\|album_items\|comments" src/routes/api src/lib/server --include='*.ts' | grep -v -e search -e '\.test\.' | while read f; do grep -q "reindexItem\|reindexItemsFor" "$f" || echo "UNWIRED: $f"; done; echo AUDIT-DONE
```

Expected: only `AUDIT-DONE` (no `UNWIRED:` lines) — except read-only files (GET-only handlers); inspect any hit and confirm it performs no writes before accepting it.

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/routes/api src/lib/server
git commit -m "feat: reindex FTS on every item/people/tag/album/comment mutation"
```

---

### Task 7: `pnpm db:reindex` maintenance script

**Files:**
- Create: `scripts/db-reindex.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `reindexAll` (Task 5); `DATABASE_PATH` env (Contract 8; default `/data/shoebox.db`).
- Produces: `pnpm db:reindex` — node-only maintenance (Docker deployments and dev). Cloudflare keeps its index current through the Task 6 hooks; a remote rebuild path is out of scope for this phase.

- [ ] **Step 1: Ensure tsx is available**

Run: `pnpm add -D tsx`
Expected: `tsx` in `devDependencies` (no-op if phase plans already added it).

- [ ] **Step 2: Write the script**

Create `scripts/db-reindex.ts`:

```ts
// scripts/db-reindex.ts — rebuild the FTS5 index from scratch (node/Docker maintenance).
// Usage: DATABASE_PATH=/data/shoebox.db pnpm db:reindex
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { reindexAll } from '../src/lib/server/search';

const path = process.env.DATABASE_PATH ?? '/data/shoebox.db';
const sqlite = new Database(path);
const db = drizzle(sqlite);

const started = Date.now();
const count = await reindexAll(db as Parameters<typeof reindexAll>[0]);
console.log(`Reindexed ${count} items in ${path} (${Date.now() - started}ms)`);
sqlite.close();
```

- [ ] **Step 3: Add the pnpm script**

In `package.json`, add to `"scripts"` (keep all existing entries):

```json
"db:reindex": "tsx scripts/db-reindex.ts"
```

- [ ] **Step 4: Verify it runs against a scratch DB**

```bash
mkdir -p .tmp && DATABASE_PATH=.tmp/reindex-check.db pnpm db:migrate && DATABASE_PATH=.tmp/reindex-check.db pnpm db:reindex && rm -rf .tmp
```

Expected output includes: `Reindexed 0 items in .tmp/reindex-check.db` (empty DB → 0). If `pnpm db:migrate` reads a different env var in this repo, mirror how phase 01's script resolves the path.

- [ ] **Step 5: Commit**

```bash
git add scripts/db-reindex.ts package.json pnpm-lock.yaml
git commit -m "feat: pnpm db:reindex full-rebuild maintenance script"
```

---

### Task 8: Holiday auto-tagging (`applyHolidayTags`) + settings seam + item-write wiring

**Files:**
- Modify: `src/lib/server/items.ts` (append `applyHolidayTags` + `enabledHolidaySet`)
- Modify: `src/routes/api/items/+server.ts` (POST), `src/routes/api/items/[id]/+server.ts` (PATCH)
- Test: `src/lib/server/holiday-tags.test.ts`

**Interfaces:**
- Consumes: `holidaysFor`, `HOLIDAYS` (Tasks 1–2); `settings` table (Contract 1); `reindexItem` (already wired in Task 6).
- Produces:
  - `export async function applyHolidayTags(db: Db, itemId: string): Promise<string[]>` in `src/lib/server/items.ts` — **the Arrivals seam**: phase 07's Arrivals apply path MUST call `await applyHolidayTags(db, itemId); await reindexItem(db, itemId);` after each batch-applied item. Returns the holiday ids now on the item.
  - Settings key `'holidaySet'` (JSON array of enabled holiday ids; missing/invalid → all of `HOLIDAYS`), read at tag time — the config seam the Admin settings page (phase 08) writes.

Behavior (exact):
1. If the item is missing → return `[]`.
2. Wanted set = `datePrecision === 'day' && dateStart && !deleted_at` ? `holidaysFor(dateStart)` filtered by the enabled set : `[]` (so month/year/range/unknown dates and soft-deleted items shed all holiday tags).
3. Remove stale: every `item_tags` row whose tag has `kind='holiday'` and whose name is not in the wanted set is deleted.
4. Add missing: for each wanted id, reuse the tag row named `id` if it exists (any kind — `tags.name` is UNIQUE; an existing `topic` tag is reused, never kind-flipped, and being `topic` it is then exempt from step 3's stale removal — Resolution R5); otherwise insert `{ id: nanoid(12), name, kind: 'holiday' }`; then insert the `item_tags` link if absent.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/holiday-tags.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './platform/node-test-db';
import { applyHolidayTags } from './items';

type TestCtx = ReturnType<typeof makeTestDb>;
let ctx: TestCtx;

function seed(c: TestCtx, o: { id: string; dateStart?: string; precision?: string }) {
	const { db, schema } = c;
	db.insert(schema.users)
		.values({ id: 'u1', username: 'o', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', createdAt: new Date() })
		.onConflictDoNothing()
		.run();
	db.insert(schema.items)
		.values({
			id: o.id, type: 'photo', dateStart: o.dateStart ?? null, dateEnd: o.dateStart ?? null,
			datePrecision: (o.precision ?? 'day') as 'day', sortDate: o.dateStart ?? null,
			width: 1, height: 1, sizeBytes: 1, sha256: `s_${o.id}`, source: 'upload',
			status: 'ready', uploadedBy: 'u1', createdAt: new Date()
		})
		.run();
}

async function holidayTagsOf(c: TestCtx, itemId: string): Promise<string[]> {
	const rows = (await c.db.all(
		sql`SELECT t.name AS n FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ${itemId} AND t.kind = 'holiday' ORDER BY t.name`
	)) as { n: string }[];
	return rows.map((r) => r.n);
}

beforeEach(() => {
	ctx = makeTestDb();
});

describe('applyHolidayTags', () => {
	it('tags christmas for a day-precision 12-25 date', async () => {
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual(['christmas']);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['christmas']);
	});

	it('is idempotent', async () => {
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await applyHolidayTags(ctx.db, 'i1');
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['christmas']);
	});

	it('removes stale holiday tags when the date changes', async () => {
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await ctx.db.run(sql`UPDATE items SET date_start = '1994-07-04', date_end = '1994-07-04', sort_date = '1994-07-04' WHERE id = 'i1'`);
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual(['july-4th']);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual(['july-4th']);
	});

	it('non-day precision sheds all holiday tags', async () => {
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		await ctx.db.run(sql`UPDATE items SET date_precision = 'month' WHERE id = 'i1'`);
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual([]);
		expect(await holidayTagsOf(ctx, 'i1')).toEqual([]);
	});

	it("honors the 'holidaySet' settings key", async () => {
		await ctx.db.run(sql`INSERT INTO settings (key, value) VALUES ('holidaySet', '["thanksgiving"]')`);
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		expect(await applyHolidayTags(ctx.db, 'i1')).toEqual([]);
		seed(ctx, { id: 'i2', dateStart: '1994-11-24' });
		expect(await applyHolidayTags(ctx.db, 'i2')).toEqual(['thanksgiving']);
	});

	it('reuses an existing topic tag of the same name without flipping its kind', async () => {
		await ctx.db.run(sql`INSERT INTO tags (id, name, kind) VALUES ('t_c', 'christmas', 'topic')`);
		seed(ctx, { id: 'i1', dateStart: '1994-12-25' });
		await applyHolidayTags(ctx.db, 'i1');
		const kind = (await ctx.db.all(sql`SELECT kind AS k FROM tags WHERE name = 'christmas'`)) as { k: string }[];
		expect(kind).toEqual([{ k: 'topic' }]);
		const linked = (await ctx.db.all(sql`SELECT tag_id AS t FROM item_tags WHERE item_id = 'i1'`)) as { t: string }[];
		expect(linked).toEqual([{ t: 't_c' }]);
	});

	it('missing item returns []', async () => {
		expect(await applyHolidayTags(ctx.db, 'nope')).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/holiday-tags.test.ts`
Expected: FAIL — `applyHolidayTags` is not exported from `./items`.

- [ ] **Step 3: Implement in `src/lib/server/items.ts`**

Read the file first (`sed -n '1,40p' src/lib/server/items.ts`) to see its existing imports; add the missing ones among:

```ts
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { holidaysFor, HOLIDAYS } from '$lib/domain/holidays';
```

(If `items.ts` imports its neighbors relatively, e.g. `../domain/holidays`, follow the file's existing style.) Then append at the end of the file:

```ts
/** settings.holidaySet: JSON array of enabled holiday ids; absent/invalid → all. */
async function enabledHolidaySet(db: Db): Promise<Set<string>> {
	const rows = (await db.all(sql`SELECT value FROM settings WHERE key = 'holidaySet'`)) as Array<{ value: string }>;
	if (rows[0]) {
		try {
			const arr = JSON.parse(rows[0].value);
			if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
		} catch {
			// fall through to default
		}
	}
	return new Set(HOLIDAYS.map((h) => h.id));
}

/**
 * Derive holiday tags from the item's exact date (spec §4) and sync item_tags.
 * - Only datePrecision === 'day' items get holiday tags; anything else sheds them.
 * - Stale kind='holiday' links are removed when the date changes.
 * - Existing tag rows are reused by name (never kind-flipped).
 * Arrivals seam (phase 07): call applyHolidayTags(db, itemId) then reindexItem(db, itemId)
 * after each batch-applied item. Returns the holiday ids now on the item.
 */
export async function applyHolidayTags(db: Db, itemId: string): Promise<string[]> {
	const items = (await db.all(
		sql`SELECT date_start AS ds, date_precision AS dp, deleted_at AS del FROM items WHERE id = ${itemId}`
	)) as Array<{ ds: string | null; dp: string; del: number | null }>;
	const item = items[0];
	if (!item) return [];

	let wanted: string[] = [];
	if (item.del == null && item.dp === 'day' && item.ds) {
		const enabled = await enabledHolidaySet(db);
		wanted = holidaysFor(item.ds).filter((h) => enabled.has(h));
	}
	const wantedSet = new Set(wanted);

	const current = (await db.all(
		sql`SELECT t.id AS id, t.name AS name FROM item_tags it JOIN tags t ON t.id = it.tag_id
		    WHERE it.item_id = ${itemId} AND t.kind = 'holiday'`
	)) as Array<{ id: string; name: string }>;

	for (const c of current) {
		if (!wantedSet.has(c.name)) {
			await db.run(sql`DELETE FROM item_tags WHERE item_id = ${itemId} AND tag_id = ${c.id}`);
		}
	}

	for (const name of wanted) {
		const existing = (await db.all(sql`SELECT id FROM tags WHERE name = ${name}`)) as Array<{ id: string }>;
		let tagId = existing[0]?.id;
		if (!tagId) {
			tagId = nanoid(12);
			await db.run(sql`INSERT INTO tags (id, name, kind) VALUES (${tagId}, ${name}, 'holiday')`);
		}
		await db.run(sql`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (${itemId}, ${tagId})`);
	}

	return wanted;
}
```

(`Db` should already be imported/used by `items.ts`; if not, add `import type { Db } from './db';`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/holiday-tags.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire into the item write paths (before the Task 6 reindex calls)**

In `src/routes/api/items/+server.ts` `POST` and `src/routes/api/items/[id]/+server.ts` `PATCH`, add the import `import { applyHolidayTags } from '$lib/server/items';` and insert **immediately before** the `await reindexItem(locals.db, …)` line Task 6 added (order matters — the FTS row must include the fresh holiday tags):

```ts
await applyHolidayTags(locals.db, itemId); // itemId == params.id in the PATCH handler
```

Run applyHolidayTags on every create/PATCH (it is idempotent and self-corrects stale tags) — do not try to detect "date changed".

- [ ] **Step 6: Typecheck + full unit suite**

Run: `pnpm check && pnpm test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/items.ts src/lib/server/holiday-tags.test.ts src/routes/api/items
git commit -m "feat: holiday auto-tagging on day-precision item writes (holidaySet seam)"
```

---

### Task 9: Query execution — `buildItemConditions` + `executeSearch` (with age windows)

**Files:**
- Modify: `src/lib/server/search.ts` (append)
- Test: `src/lib/server/search-exec.test.ts`

**Interfaces:**
- Consumes: `SearchQuery`/`parseOmnibox` (Task 3); `dateWindowForAge(birthdate, { min, max }): { start: string; end: string }` from `src/lib/domain/ages.ts` (Contract 5, delivered in phase 05); `ftsMatchExpr` (Task 5).
- Produces (Tasks 10–11 rely on these exact names):
  - `export interface ItemFilter { text?: string; personIds?: string[]; personNames?: string[]; tagIds?: string[]; tagNames?: string[]; type?: 'video'|'photo'; albumId?: string; albumTitle?: string; uploaderUsername?: string; yearFrom?: number; yearTo?: number; age?: { personName: string; min: number; max: number }; }`
  - `export function filterFromQuery(q: SearchQuery): ItemFilter`
  - `export interface BuiltConditions { conds: SQL[]; warnings: string[]; impossible: boolean }`
  - `export async function buildItemConditions(db: Db, f: ItemFilter): Promise<BuiltConditions>`
  - `export interface SearchExecResult { itemIds: string[]; nextCursor: string | null; warnings: string[] }`
  - `export async function executeSearch(db: Db, q: SearchQuery & { warnings?: string[] }, opts?: { cursor?: string; limit?: number }): Promise<SearchExecResult>` — items ordered `sort_date DESC, id DESC`; opaque cursor `"<sortDate>~<id>"`.

Semantics (exact): unresolvable structured facets (person/tag/album/uploader name with no row) → `impossible: true` → empty items + warning, never an error. Repeated `person:` filters are AND-composed as stacked `IN (SELECT item_id FROM item_people WHERE person_id = ?)` conditions. Age windows require the age person to resolve with a birthdate; the window from `dateWindowForAge` is intersected with the item's own date range (`date_start <= window.end AND date_end >= window.start`). Year windows apply to `sort_date`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/search-exec.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import { parseOmnibox } from '../domain/search-query';
import { reindexAll, executeSearch } from './search';
import { dateWindowForAge } from '../domain/ages';

type TestCtx = ReturnType<typeof makeTestDb>;
let ctx: TestCtx;

function seedWorld(c: TestCtx) {
	const { db, schema } = c;
	db.insert(schema.users)
		.values({ id: 'u1', username: 'owner', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', createdAt: new Date() })
		.run();
	db.insert(schema.people)
		.values([
			{ id: 'p_eric', name: 'Eric', birthdate: '1988-06-14', accentColor: '#A8D8EA', createdAt: new Date() },
			{ id: 'p_mom', name: 'Mom', accentColor: '#FFD9A8', createdAt: new Date() }
		])
		.run();
	const mk = (id: string, date: string, extra: Partial<{ title: string; description: string; type: 'video' | 'photo' }> = {}) =>
		db.insert(schema.items)
			.values({
				id, type: extra.type ?? 'photo', title: extra.title ?? null, description: extra.description ?? null,
				dateStart: date, dateEnd: date, datePrecision: 'day', sortDate: date,
				width: 1, height: 1, sizeBytes: 1, sha256: `s_${id}`, source: 'upload',
				status: 'ready', uploadedBy: 'u1', createdAt: new Date()
			})
			.run();
	mk('it_93', '1993-08-10', { title: 'Lake day', description: 'Eating watermelon at the lake' });
	mk('it_96', '1996-08-10', { title: 'Bike ride', type: 'video' });
	mk('it_xmas', '1994-12-25', { title: 'Morning presents' });
	mk('it_85', '1985-05-05', { title: 'Old photo' });
	db.insert(schema.itemPeople)
		.values([
			{ itemId: 'it_93', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_96', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_xmas', personId: 'p_eric', source: 'manual' },
			{ itemId: 'it_xmas', personId: 'p_mom', source: 'manual' }
		])
		.run();
	db.insert(schema.tags).values({ id: 't_x', name: 'christmas', kind: 'holiday' }).run();
	db.insert(schema.itemTags).values({ itemId: 'it_xmas', tagId: 't_x' }).run();
}

const run = (q: string, opts?: { cursor?: string; limit?: number }) => executeSearch(ctx.db, parseOmnibox(q), opts);

beforeEach(async () => {
	ctx = makeTestDb();
	seedWorld(ctx);
	await reindexAll(ctx.db);
});

describe('executeSearch', () => {
	it('sanity: dateWindowForAge(1988-06-14, 5..7) spans 1993-06-14 .. 1996-06-13 (Contract 5)', () => {
		expect(dateWindowForAge('1988-06-14', { min: 5, max: 7 })).toEqual({ start: '1993-06-14', end: '1996-06-13' });
	});

	it('free text via FTS', async () => {
		expect((await run('watermelon')).itemIds).toEqual(['it_93']);
	});

	it('AGE-WINDOW PROOF: person:Eric age:5-7 → only the 1993 item (1996 is past the window)', async () => {
		const r = await run('person:Eric age:5-7');
		expect(r.itemIds).toEqual(['it_93']);
		expect(r.warnings).toEqual([]);
	});

	it('person AND person', async () => {
		expect((await run('person:Eric person:Mom')).itemIds).toEqual(['it_xmas']);
	});

	it('person + tag combo', async () => {
		expect((await run('person:Mom tag:christmas')).itemIds).toEqual(['it_xmas']);
	});

	it('year window 1988..1999 excludes 1985', async () => {
		expect((await run('1988..1999')).itemIds).toEqual(['it_96', 'it_xmas', 'it_93']); // sort_date DESC
	});

	it('type filter', async () => {
		expect((await run('type:video')).itemIds).toEqual(['it_96']);
	});

	it('uploader filter', async () => {
		expect((await run('uploader:owner 1985')).itemIds).toEqual(['it_85']);
	});

	it('unknown person → empty + warning, not an error', async () => {
		const r = await run('person:Zorp');
		expect(r.itemIds).toEqual([]);
		expect(r.warnings.some((w) => w.includes('Zorp'))).toBe(true);
	});

	it('age on a person without birthdate → warning, filter dropped', async () => {
		const r = await run('person:Mom age:5');
		expect(r.warnings.some((w) => w.includes('birthdate'))).toBe(true);
		expect(r.itemIds).toEqual(['it_xmas']); // person filter still applies
	});

	it('cursor pagination walks the full result set with no overlap', async () => {
		const page1 = await run('1985..1999', { limit: 2 });
		expect(page1.itemIds).toEqual(['it_96', 'it_xmas']);
		expect(page1.nextCursor).not.toBeNull();
		const page2 = await run('1985..1999', { cursor: page1.nextCursor!, limit: 2 });
		expect(page2.itemIds).toEqual(['it_93', 'it_85']);
		expect(page2.nextCursor).toBeNull();
	});

	it('parse warnings pass through', async () => {
		const r = await run('age:5 watermelon'); // age without person → parse warning
		expect(r.itemIds).toEqual(['it_93']);
		expect(r.warnings).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/search-exec.test.ts`
Expected: FAIL — `executeSearch` (and friends) not exported.

- [ ] **Step 3: Append the implementation to `src/lib/server/search.ts`**

Add `type SQL` to the drizzle import (`import { sql, type SQL } from 'drizzle-orm';`), add `import { dateWindowForAge } from '../domain/ages';` and `import type { SearchQuery } from '../domain/search-query';`, then append:

```ts
// ---------- query execution ----------

export interface ItemFilter {
	text?: string;
	personIds?: string[];
	personNames?: string[];
	tagIds?: string[];
	tagNames?: string[];
	type?: 'video' | 'photo';
	albumId?: string;
	albumTitle?: string;
	uploaderUsername?: string;
	yearFrom?: number;
	yearTo?: number;
	age?: { personName: string; min: number; max: number };
}

export function filterFromQuery(q: SearchQuery): ItemFilter {
	return {
		text: q.text || undefined,
		personNames: q.people.length ? q.people : undefined,
		tagNames: q.tags.length ? q.tags : undefined,
		type: q.type,
		albumTitle: q.album,
		uploaderUsername: q.uploader,
		yearFrom: q.yearFrom,
		yearTo: q.yearTo,
		age: q.age ? { personName: q.age.person, min: q.age.min, max: q.age.max } : undefined
	};
}

export interface BuiltConditions {
	conds: SQL[];
	warnings: string[];
	impossible: boolean;
}

/** WHERE conditions over `items i` for one filter set. Unresolvable names → impossible (empty result, warning). */
export async function buildItemConditions(db: Db, f: ItemFilter): Promise<BuiltConditions> {
	const conds: SQL[] = [sql`i.deleted_at IS NULL`, sql`i.status = 'ready'`];
	const warnings: string[] = [];
	const impossible = (w: string): BuiltConditions => ({ conds, warnings: [...warnings, w], impossible: true });

	if (f.type) conds.push(sql`i.type = ${f.type}`);

	if (f.text) {
		const match = ftsMatchExpr(f.text);
		if (match) conds.push(sql`i.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ${match})`);
	}

	const resolvedPeople: Array<{ id: string; name: string; birthdate: string | null }> = [];
	for (const name of f.personNames ?? []) {
		const rows = (await db.all(
			sql`SELECT id, name, birthdate FROM people WHERE lower(name) = ${name.toLowerCase()} LIMIT 1`
		)) as Array<{ id: string; name: string; birthdate: string | null }>;
		if (!rows[0]) return impossible(`No person named "${name}"`);
		resolvedPeople.push(rows[0]);
		conds.push(sql`i.id IN (SELECT item_id FROM item_people WHERE person_id = ${rows[0].id})`); // stacked = AND
	}
	for (const pid of f.personIds ?? []) {
		conds.push(sql`i.id IN (SELECT item_id FROM item_people WHERE person_id = ${pid})`);
	}

	for (const tname of f.tagNames ?? []) {
		const rows = (await db.all(sql`SELECT id FROM tags WHERE name = ${tname.toLowerCase()} LIMIT 1`)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No tag "${tname}"`);
		conds.push(sql`i.id IN (SELECT item_id FROM item_tags WHERE tag_id = ${rows[0].id})`);
	}
	for (const tid of f.tagIds ?? []) {
		conds.push(sql`i.id IN (SELECT item_id FROM item_tags WHERE tag_id = ${tid})`);
	}

	if (f.albumTitle) {
		const rows = (await db.all(
			sql`SELECT id FROM albums WHERE lower(title) = ${f.albumTitle.toLowerCase()} AND deleted_at IS NULL LIMIT 1`
		)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No album titled "${f.albumTitle}"`);
		conds.push(sql`i.id IN (SELECT item_id FROM album_items WHERE album_id = ${rows[0].id})`);
	}
	if (f.albumId) conds.push(sql`i.id IN (SELECT item_id FROM album_items WHERE album_id = ${f.albumId})`);

	if (f.uploaderUsername) {
		const rows = (await db.all(
			sql`SELECT id FROM users WHERE lower(username) = ${f.uploaderUsername.toLowerCase()} LIMIT 1`
		)) as Array<{ id: string }>;
		if (!rows[0]) return impossible(`No uploader "${f.uploaderUsername}"`);
		conds.push(sql`i.uploaded_by = ${rows[0].id}`);
	}

	if (f.yearFrom != null) {
		const to = f.yearTo ?? f.yearFrom;
		conds.push(sql`i.sort_date IS NOT NULL AND i.sort_date >= ${`${f.yearFrom}-01-01`} AND i.sort_date <= ${`${to}-12-31`}`);
	}

	if (f.age) {
		const person = resolvedPeople.find((p) => p.name.toLowerCase() === f.age!.personName.toLowerCase());
		if (!person) {
			warnings.push(`Ignored age filter — person:"${f.age.personName}" is not part of this query`);
		} else if (!person.birthdate) {
			warnings.push(`Ignored age filter — ${person.name} has no birthdate`);
		} else {
			const w = dateWindowForAge(person.birthdate, { min: f.age.min, max: f.age.max });
			// intersect the age window with the item's own date range
			conds.push(sql`i.date_start IS NOT NULL AND i.date_end IS NOT NULL AND i.date_start <= ${w.end} AND i.date_end >= ${w.start}`);
		}
	}

	return { conds, warnings, impossible: false };
}

export interface SearchExecResult {
	itemIds: string[];
	nextCursor: string | null;
	warnings: string[];
}

/** Run a parsed omnibox query. Cursor is opaque `"<sortDate>~<id>"`, order sort_date DESC, id DESC. */
export async function executeSearch(
	db: Db,
	q: SearchQuery & { warnings?: string[] },
	opts: { cursor?: string; limit?: number } = {}
): Promise<SearchExecResult> {
	const limit = Math.max(1, Math.min(opts.limit ?? 48, 100));
	const built = await buildItemConditions(db, filterFromQuery(q));
	const warnings = [...(q.warnings ?? []), ...built.warnings];
	if (built.impossible) return { itemIds: [], nextCursor: null, warnings };

	const conds = [...built.conds];
	if (opts.cursor) {
		const sep = opts.cursor.lastIndexOf('~');
		const cs = sep >= 0 ? opts.cursor.slice(0, sep) : '';
		const cid = sep >= 0 ? opts.cursor.slice(sep + 1) : opts.cursor;
		conds.push(sql`(coalesce(i.sort_date, '') < ${cs} OR (coalesce(i.sort_date, '') = ${cs} AND i.id < ${cid}))`);
	}

	const where = sql.join(conds, sql` AND `);
	const rows = (await db.all(
		sql`SELECT i.id AS id, coalesce(i.sort_date, '') AS sd FROM items i WHERE ${where}
		    ORDER BY coalesce(i.sort_date, '') DESC, i.id DESC LIMIT ${limit + 1}`
	)) as Array<{ id: string; sd: string }>;

	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = rows.length > limit && last ? `${last.sd}~${last.id}` : null;
	return { itemIds: page.map((r) => r.id), nextCursor, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/search-exec.test.ts src/lib/server/search.test.ts`
Expected: PASS (all tests in both files — including the AGE-WINDOW PROOF test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/search.ts src/lib/server/search-exec.test.ts
git commit -m "feat: search execution with AND people, tags, year and age windows, cursors"
```

---

### Task 10: `GET /api/search` (Contract 6) + people/album cards

**Files:**
- Modify: `src/lib/server/search.ts` (append card queries)
- Modify: `src/lib/server/items.ts` (append `itemDTOsByIds` wrapper)
- Create: `src/routes/api/search/+server.ts`
- Test: `src/lib/server/search-cards.test.ts` (new; card queries) — the route itself is proven in Task 14 e2e.

**Interfaces:**
- Consumes: `parseOmnibox` (Task 3); `executeSearch` (Task 9); `requireRole(locals, 'user')` (Contract 3); phase 02's ItemDTO builder (verified in Step 1).
- Produces:
  - `export interface PersonCard { id: string; name: string; accentColor: string; avatarItemId: string | null }`
  - `export interface AlbumCard { id: string; title: string; coverItemId: string | null; itemCount: number }`
  - `export async function searchPeopleCards(db: Db, text: string, limit?: number): Promise<PersonCard[]>`
  - `export async function searchAlbumCards(db: Db, text: string, limit?: number): Promise<AlbumCard[]>`
  - `export async function itemDTOsByIds(locals: App.Locals, ids: string[]): Promise<ItemDTO[]>` in `src/lib/server/items.ts` (order-preserving).
  - `GET /api/search?q=<omnibox>[&cursor][&limit]` → `{ items: ItemDTO[], people: PersonCard[], albums: AlbumCard[], nextCursor: string | null, query: SearchQuery, warnings: string[] }`. Contract 6 mandates `{ items, people, albums }`; `nextCursor`/`query`/`warnings` are additive (Resolution R3). People/album cards match the **text portion** by name and are returned only on the first page (no `cursor`).

- [ ] **Step 1: Locate phase 02's ItemDTO builder**

Run: `grep -rn "ItemDTO" src/lib/server src/routes/api/items --include='*.ts' | grep -v test`
- Expected: a builder in `src/lib/server/items.ts` that composes the Contract-6 `ItemDTO` (urls via `locals.platform.storage.mediaUrl`, people with ages, tags, albums, blurhash) — the `GET /api/items` and `GET /api/items/[id]` handlers must already produce DTOs, so a builder exists somewhere.
- If it is exported from `items.ts` as a single-item builder (whatever its name — e.g. `getItemDTO`, `toItemDTO`, `buildItemDTO`), wrap it in Step 3 as shown.
- If it lives inline in a route handler, first extract it verbatim into `src/lib/server/items.ts`, export it, and re-import it from that route (pure mechanical move — no behavior change), then proceed.

- [ ] **Step 2: Write the failing card-query tests**

Create `src/lib/server/search-cards.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import { searchPeopleCards, searchAlbumCards } from './search';

type TestCtx = ReturnType<typeof makeTestDb>;
let ctx: TestCtx;

beforeEach(() => {
	ctx = makeTestDb();
	const { db, schema } = ctx;
	db.insert(schema.users)
		.values({ id: 'u1', username: 'o', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', createdAt: new Date() })
		.run();
	db.insert(schema.people)
		.values([
			{ id: 'p1', name: 'Eric', accentColor: '#A8D8EA', createdAt: new Date() },
			{ id: 'p2', name: 'Erica', accentColor: '#FFD9A8', createdAt: new Date() },
			{ id: 'p3', name: 'Mom', accentColor: '#FFD700', createdAt: new Date() }
		])
		.run();
	db.insert(schema.albums)
		.values([
			{ id: 'a1', title: 'Summer at the lake', createdBy: 'u1', createdAt: new Date() },
			{ id: 'a2', title: 'Christmas mornings', createdBy: 'u1', createdAt: new Date(), deletedAt: new Date() }
		])
		.run();
});

describe('searchPeopleCards', () => {
	it('substring name match, case-insensitive', async () => {
		const cards = await searchPeopleCards(ctx.db, 'eric');
		expect(cards.map((c) => c.name)).toEqual(['Eric', 'Erica']);
		expect(cards[0]).toEqual({ id: 'p1', name: 'Eric', accentColor: '#A8D8EA', avatarItemId: null });
	});
	it('any-token match', async () => {
		expect((await searchPeopleCards(ctx.db, 'lake mom')).map((c) => c.name)).toEqual(['Mom']);
	});
	it('empty text → no cards', async () => {
		expect(await searchPeopleCards(ctx.db, '  ')).toEqual([]);
	});
	it('LIKE wildcards in input are escaped', async () => {
		expect(await searchPeopleCards(ctx.db, '%')).toEqual([]);
	});
});

describe('searchAlbumCards', () => {
	it('matches by title token and counts items, skipping soft-deleted albums', async () => {
		const cards = await searchAlbumCards(ctx.db, 'lake');
		expect(cards).toEqual([{ id: 'a1', title: 'Summer at the lake', coverItemId: null, itemCount: 0 }]);
		expect(await searchAlbumCards(ctx.db, 'christmas')).toEqual([]); // a2 is soft-deleted
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/search-cards.test.ts`
Expected: FAIL — `searchPeopleCards` not exported.

- [ ] **Step 4: Append card queries to `src/lib/server/search.ts`**

```ts
// ---------- name-match cards for the /search page ----------

export interface PersonCard {
	id: string;
	name: string;
	accentColor: string;
	avatarItemId: string | null;
}

export interface AlbumCard {
	id: string;
	title: string;
	coverItemId: string | null;
	itemCount: number;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function textTokens(text: string): string[] {
	return text.replace(/"/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5);
}

/** People whose name contains any text token (for the /search people row). */
export async function searchPeopleCards(db: Db, text: string, limit = 8): Promise<PersonCard[]> {
	const tokens = textTokens(text);
	if (!tokens.length) return [];
	const likes = tokens.map((t) => sql`p.name LIKE ${'%' + likeEscape(t) + '%'} ESCAPE '\\'`);
	return (await db.all(
		sql`SELECT p.id AS id, p.name AS name, p.accent_color AS accentColor, p.avatar_item_id AS avatarItemId
		    FROM people p WHERE ${sql.join(likes, sql` OR `)} ORDER BY p.name LIMIT ${limit}`
	)) as PersonCard[];
}

/** Live albums whose title contains any text token (for the /search albums row). */
export async function searchAlbumCards(db: Db, text: string, limit = 8): Promise<AlbumCard[]> {
	const tokens = textTokens(text);
	if (!tokens.length) return [];
	const likes = tokens.map((t) => sql`a.title LIKE ${'%' + likeEscape(t) + '%'} ESCAPE '\\'`);
	return (await db.all(
		sql`SELECT a.id AS id, a.title AS title, a.cover_item_id AS coverItemId,
		           (SELECT COUNT(*) FROM album_items ai WHERE ai.album_id = a.id) AS itemCount
		    FROM albums a WHERE a.deleted_at IS NULL AND (${sql.join(likes, sql` OR `)})
		    ORDER BY a.title LIMIT ${limit}`
	)) as AlbumCard[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/search-cards.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Add `itemDTOsByIds` to `src/lib/server/items.ts`**

Append (replace `getItemDTO` with the actual single-item builder name found in Step 1):

```ts
/** Order-preserving batch DTO loader for search results. */
export async function itemDTOsByIds(locals: App.Locals, ids: string[]): Promise<ItemDTO[]> {
	const out: ItemDTO[] = [];
	for (const id of ids) {
		const dto = await getItemDTO(locals, id); // phase 02's single-item DTO builder
		if (dto) out.push(dto);
	}
	return out;
}
```

(If the phase-02 builder takes `(db, storage, id)` or similar instead of `locals`, keep its signature and adapt this wrapper's body — the exported wrapper signature above stays fixed; Task 12/14 depend only on the route output shape.)

- [ ] **Step 7: Create the route**

Create `src/routes/api/search/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { parseOmnibox } from '$lib/domain/search-query';
import { executeSearch, searchPeopleCards, searchAlbumCards } from '$lib/server/search';
import { itemDTOsByIds } from '$lib/server/items';

/** GET /api/search?q=<omnibox>[&cursor][&limit] — Contract 6 (role: user).
 *  Returns { items, people, albums } plus additive nextCursor/query/warnings. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals, 'user');
	const qs = url.searchParams.get('q') ?? '';
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const limitRaw = Number(url.searchParams.get('limit') ?? '48');
	const limit = Number.isFinite(limitRaw) ? limitRaw : 48;

	const parsed = parseOmnibox(qs);
	const exec = await executeSearch(locals.db, parsed, { cursor, limit });
	const items = await itemDTOsByIds(locals, exec.itemIds);

	// name-matched cards for the text portion — first page only
	const wantCards = !cursor && parsed.text.trim().length > 0;
	const [people, albums] = wantCards
		? await Promise.all([searchPeopleCards(locals.db, parsed.text), searchAlbumCards(locals.db, parsed.text)])
		: [[], []];

	const { warnings: _parseWarnings, ...query } = parsed;
	return json({ items, people, albums, nextCursor: exec.nextCursor, query, warnings: exec.warnings });
};
```

- [ ] **Step 8: Typecheck + full unit suite**

Run: `pnpm check && pnpm test`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/search.ts src/lib/server/search-cards.test.ts src/lib/server/items.ts src/routes/api/search
git commit -m "feat: GET /api/search with item DTOs, person/album cards, cursors"
```

---

### Task 11: Filtered timeline histograms (`/api/timeline` extension)

**Files:**
- Modify: `src/lib/server/search.ts` (append `filteredYearCounts`)
- Modify: `src/routes/api/timeline/+server.ts`
- Test: `src/lib/server/timeline-filter.test.ts`

**Interfaces:**
- Consumes: `buildItemConditions`, `ItemFilter`, `filterFromQuery` (Task 9); `parseOmnibox` (Task 3); phase 03's existing `/api/timeline` fast path (kept verbatim).
- Produces:
  - `export async function filteredYearCounts(db: Db, f: ItemFilter): Promise<{ year: number; count: number }[]>`
  - `GET /api/timeline` now also accepts the same filter params as `/api/items` (`people` csv of person ids, `tags` csv of tag ids, `type`, `album` album id, `q` omnibox string). No filter params → the existing `year_counts` fast path (Contract 6 shape `{ years: { year, count }[], earliest, latest }` unchanged); any filter present → live filtered aggregation, same shape.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/timeline-filter.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './platform/node-test-db';
import { reindexAll, filteredYearCounts, filterFromQuery } from './search';
import { parseOmnibox } from '../domain/search-query';

type TestCtx = ReturnType<typeof makeTestDb>;
let ctx: TestCtx;

beforeEach(async () => {
	ctx = makeTestDb();
	const { db, schema } = ctx;
	db.insert(schema.users)
		.values({ id: 'u1', username: 'o', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', createdAt: new Date() })
		.run();
	const mk = (id: string, date: string, type: 'video' | 'photo', description?: string) =>
		db.insert(schema.items)
			.values({
				id, type, description: description ?? null, dateStart: date, dateEnd: date, datePrecision: 'day', sortDate: date,
				width: 1, height: 1, sizeBytes: 1, sha256: `s_${id}`, source: 'upload', status: 'ready',
				uploadedBy: 'u1', createdAt: new Date()
			})
			.run();
	mk('i1', '1993-08-10', 'photo', 'watermelon at the lake');
	mk('i2', '1993-12-25', 'video');
	mk('i3', '1996-08-10', 'video');
	db.insert(schema.tags).values({ id: 't1', name: 'christmas', kind: 'holiday' }).run();
	db.insert(schema.itemTags).values({ itemId: 'i2', tagId: 't1' }).run();
	await reindexAll(db);
});

describe('filteredYearCounts', () => {
	it('groups by year with no filter beyond ready+live', async () => {
		expect(await filteredYearCounts(ctx.db, {})).toEqual([
			{ year: 1993, count: 2 },
			{ year: 1996, count: 1 }
		]);
	});
	it('type filter', async () => {
		expect(await filteredYearCounts(ctx.db, { type: 'video' })).toEqual([
			{ year: 1993, count: 1 },
			{ year: 1996, count: 1 }
		]);
	});
	it('tagIds filter (timeline chip param)', async () => {
		expect(await filteredYearCounts(ctx.db, { tagIds: ['t1'] })).toEqual([{ year: 1993, count: 1 }]);
	});
	it('omnibox q → filterFromQuery → FTS-filtered histogram', async () => {
		expect(await filteredYearCounts(ctx.db, filterFromQuery(parseOmnibox('watermelon')))).toEqual([
			{ year: 1993, count: 1 }
		]);
	});
	it('impossible filter → empty histogram', async () => {
		expect(await filteredYearCounts(ctx.db, { tagNames: ['nope'] })).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/timeline-filter.test.ts`
Expected: FAIL — `filteredYearCounts` not exported.

- [ ] **Step 3: Append to `src/lib/server/search.ts`**

```ts
/** Filtered histogram for /api/timeline: year → count over the same conditions as search. */
export async function filteredYearCounts(db: Db, f: ItemFilter): Promise<{ year: number; count: number }[]> {
	const built = await buildItemConditions(db, f);
	if (built.impossible) return [];
	const where = sql.join(built.conds, sql` AND `);
	return (await db.all(
		sql`SELECT CAST(substr(i.sort_date, 1, 4) AS INTEGER) AS year, COUNT(*) AS count
		    FROM items i WHERE ${where} AND i.sort_date IS NOT NULL
		    GROUP BY year ORDER BY year`
	)) as { year: number; count: number }[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/timeline-filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Extend the route**

Read the current handler first: `cat src/routes/api/timeline/+server.ts`. Keep its existing body **verbatim** as the no-filter fast path, and restructure the GET to:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseOmnibox } from '$lib/domain/search-query';
import { filterFromQuery, filteredYearCounts, type ItemFilter } from '$lib/server/search';
// … keep every existing import of the current file …

export const GET: RequestHandler = async (event) => {
	const { locals, url } = event;
	// … keep the existing session/role validation lines exactly as they are …

	const p = url.searchParams;
	const hasFilters = ['people', 'tags', 'type', 'album', 'q', 'uploader'].some((k) => p.get(k));

	if (hasFilters) {
		const f: ItemFilter = p.get('q') ? filterFromQuery(parseOmnibox(p.get('q')!)) : {};
		if (p.get('people')) f.personIds = p.get('people')!.split(',').filter(Boolean);
		if (p.get('tags')) f.tagIds = p.get('tags')!.split(',').filter(Boolean);
		const t = p.get('type');
		if (t === 'video' || t === 'photo') f.type = t;
		if (p.get('album')) f.albumId = p.get('album')!;
		if (p.get('uploader')) f.uploaderUsername = p.get('uploader')!;

		const years = await filteredYearCounts(locals.db, f);
		return json({
			years,
			earliest: years[0]?.year ?? null,
			latest: years[years.length - 1]?.year ?? null
		});
	}

	// … existing year_counts fast path, unchanged, returning the same
	// { years, earliest, latest } shape it returns today …
};
```

If the existing handler returns extra fields beyond Contract 6's `{ years, earliest, latest }` (phase 03 internals), mirror those fields in the filtered branch with values computed from `years` the same way the fast path computes them.

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm check && pnpm test`
Expected: green (phase 03 timeline tests must still pass — the fast path is untouched).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/search.ts src/lib/server/timeline-filter.test.ts src/routes/api/timeline
git commit -m "feat: filtered timeline histograms for any items filter or omnibox query"
```

---

### Task 12: `/search` page — omnibox, chips, people/albums rows, results grid

**Files:**
- Create: `src/routes/search/+page.ts`
- Create: `src/routes/search/+page.svelte`

**Interfaces:**
- Consumes: `GET /api/search` (Task 10); `serializeQuery`, `SearchQuery` (Task 3); `MasonryGrid` (phase 03 — verify its props with `grep -n "let {" src/lib/ui/MasonryGrid.svelte`; this plan assumes an `items` prop of ItemDTO[]; if the prop name differs, adjust the single usage below); tokens from `src/lib/ui/tokens.ts`.
- Produces: `/search?q=…` — URL is the single source of truth (sharable); plain submit only (no search-as-you-type). Big serif omnibox in a sharp filled field (same treatment as the comment box: cream tint on dark, no border, no underline, generous padding); parsed chips rendered beneath (sharp, removable, canonicalized, warnings included); people row → albums row → `MasonryGrid`; empty state "Nothing found in the shoebox for …".

- [ ] **Step 1: Create the loader**

Create `src/routes/search/+page.ts`:

```ts
import type { PageLoad } from './$types';
import type { SearchQuery } from '$lib/domain/search-query';

// Local mirrors of the /api/search response (server types can't be imported client-side).
export interface SearchPersonCard {
	id: string;
	name: string;
	accentColor: string;
	avatarItemId: string | null;
}
export interface SearchAlbumCard {
	id: string;
	title: string;
	coverItemId: string | null;
	itemCount: number;
}
export interface SearchResultDTO {
	items: Array<{ id: string } & Record<string, unknown>>; // ItemDTO — passed through to MasonryGrid
	people: SearchPersonCard[];
	albums: SearchAlbumCard[];
	nextCursor: string | null;
	query: SearchQuery;
	warnings: string[];
}

export const load: PageLoad = async ({ url, fetch }) => {
	const q = url.searchParams.get('q') ?? '';
	if (!q.trim()) return { q, result: null as SearchResultDTO | null };
	const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
	if (!res.ok) return { q, result: null as SearchResultDTO | null };
	return { q, result: (await res.json()) as SearchResultDTO };
};
```

- [ ] **Step 2: Create the page**

Create `src/routes/search/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import { FONT, INK, CREAM, DAWN } from '$lib/ui/tokens';
	import { serializeQuery, type SearchQuery } from '$lib/domain/search-query';
	import type { PageData } from './$types';
	import type { SearchResultDTO } from './+page';

	let { data }: { data: PageData } = $props();

	let draft = $state('');
	let extraItems = $state<SearchResultDTO['items']>([]);
	let nextCursor = $state<string | null>(null);

	$effect(() => {
		draft = data.q;
		extraItems = [];
		nextCursor = data.result?.nextCursor ?? null;
	});

	const result = $derived(data.result);
	const items = $derived(result ? [...result.items, ...extraItems] : []);

	type Chip = { label: string; q?: string; warning?: boolean };

	const chips = $derived.by<Chip[]>(() => {
		if (!result) return [];
		const base: SearchQuery = result.query;
		const out: Chip[] = [];
		const without = (mutate: (c: SearchQuery) => void): string => {
			const c: SearchQuery = JSON.parse(JSON.stringify(base));
			mutate(c);
			return serializeQuery(c);
		};
		for (const p of base.people)
			out.push({
				label: `person: ${p}`,
				q: without((c) => {
					c.people = c.people.filter((x) => x !== p);
					if (c.age?.person === p) delete c.age;
				})
			});
		if (base.age)
			out.push({
				label: base.age.min === base.age.max ? `age: ${base.age.min}` : `age: ${base.age.min}–${base.age.max}`,
				q: without((c) => delete c.age)
			});
		for (const t of base.tags) out.push({ label: `tag: ${t}`, q: without((c) => (c.tags = c.tags.filter((x) => x !== t))) });
		if (base.type) out.push({ label: `type: ${base.type}`, q: without((c) => delete c.type) });
		if (base.album) out.push({ label: `album: ${base.album}`, q: without((c) => delete c.album) });
		if (base.uploader) out.push({ label: `uploader: ${base.uploader}`, q: without((c) => delete c.uploader) });
		if (base.yearFrom != null)
			out.push({
				label: base.yearFrom === base.yearTo ? `${base.yearFrom}` : `${base.yearFrom}–${base.yearTo}`,
				q: without((c) => {
					delete c.yearFrom;
					delete c.yearTo;
				})
			});
		for (const w of result.warnings) out.push({ label: w, warning: true });
		return out;
	});

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const v = draft.trim();
		goto(v ? `/search?q=${encodeURIComponent(v)}` : '/search');
	}

	function removeChip(chip: Chip) {
		if (chip.q === undefined) return;
		goto(chip.q ? `/search?q=${encodeURIComponent(chip.q)}` : '/search');
	}

	async function loadMore() {
		if (!nextCursor) return;
		const res = await fetch(`/api/search?q=${encodeURIComponent(data.q)}&cursor=${encodeURIComponent(nextCursor)}`);
		if (!res.ok) return;
		const body = (await res.json()) as SearchResultDTO;
		extraItems = [...extraItems, ...body.items];
		nextCursor = body.nextCursor;
	}
</script>

<svelte:head><title>Search — Shoebox</title></svelte:head>

<div
	class="search-room"
	style={`--serif:${FONT.serif};--sans:${FONT.sans};--ink:${INK};--cream:${CREAM};--dawn:${DAWN}`}
>
	<form class="omnibox" role="search" onsubmit={submit}>
		<input
			class="omnibox-input"
			type="search"
			name="q"
			placeholder="Search the shoebox…"
			aria-label="Search the shoebox"
			autocomplete="off"
			data-testid="omnibox"
			bind:value={draft}
		/>
		<button class="omnibox-go" type="submit">Search</button>
	</form>

	{#if chips.length}
		<div class="chips" data-testid="chips">
			{#each chips as chip (chip.label)}
				{#if chip.warning}
					<span class="chip chip-warning">{chip.label}</span>
				{:else}
					<button class="chip" type="button" onclick={() => removeChip(chip)}>
						{chip.label}<span class="chip-x" aria-hidden="true">×</span>
					</button>
				{/if}
			{/each}
		</div>
	{/if}

	{#if result}
		{#if result.people.length}
			<section class="row-section">
				<h2 class="row-label">People</h2>
				<div class="card-row" data-testid="people-row">
					{#each result.people as p (p.id)}
						<a class="person-card" href={`/people/${p.id}`} style={`--accent:${p.accentColor}`}>
							<span class="person-block">{p.name.slice(0, 1)}</span>
							<span class="card-name">{p.name}</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if result.albums.length}
			<section class="row-section">
				<h2 class="row-label">Albums</h2>
				<div class="card-row" data-testid="albums-row">
					{#each result.albums as a (a.id)}
						<a class="album-card" href={`/albums/${a.id}`}>
							<span class="card-name">{a.title}</span>
							<span class="card-count">{a.itemCount} {a.itemCount === 1 ? 'moment' : 'moments'}</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if items.length}
			<section class="results" data-testid="search-results">
				<MasonryGrid {items} />
			</section>
			{#if nextCursor}
				<button class="more" type="button" onclick={loadMore}>More</button>
			{/if}
		{:else if !result.people.length && !result.albums.length}
			<p class="empty" data-testid="search-empty">Nothing found in the shoebox for “{data.q}”.</p>
		{/if}
	{:else}
		<p class="hint">
			Try <span class="hint-example">person:Mom tag:christmas 1988..1999</span> — or just type a memory.
		</p>
	{/if}
</div>

<style>
	.search-room {
		max-width: 1200px;
		margin: 0 auto;
		padding: 48px 24px 96px;
	}
	.omnibox {
		display: flex;
		gap: 12px;
	}
	/* Sharp filled field — same treatment as the comment box: cream tint, no border, no underline. */
	.omnibox-input {
		flex: 1;
		min-height: 64px;
		padding: 12px 20px;
		font-family: var(--serif);
		font-size: 28px;
		color: var(--cream);
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		border: none;
		outline-offset: 2px;
	}
	.omnibox-input::placeholder {
		color: color-mix(in srgb, var(--cream) 55%, transparent);
	}
	.omnibox-go {
		min-height: 64px;
		min-width: 44px;
		padding: 0 28px;
		font-family: var(--sans);
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--ink);
		background: var(--cream);
		border: none;
		cursor: pointer;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 16px;
		font-family: var(--sans);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--cream);
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		border: none;
		cursor: pointer;
	}
	.chip-x {
		font-size: 16px;
	}
	.chip-warning {
		color: var(--dawn);
		background: color-mix(in srgb, var(--dawn) 12%, transparent);
		cursor: default;
		text-transform: none;
		letter-spacing: 0.02em;
	}
	.row-section {
		margin-top: 40px;
	}
	.row-label {
		font-family: var(--sans);
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		margin: 0 0 14px;
	}
	.card-row {
		display: flex;
		gap: 16px;
		overflow-x: auto;
		padding-bottom: 8px;
	}
	.person-card,
	.album-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 120px;
		text-decoration: none;
	}
	.person-block {
		display: grid;
		place-items: center;
		width: 120px;
		height: 120px;
		font-family: var(--serif);
		font-size: 52px;
		color: var(--ink);
		background: var(--accent);
	}
	.album-card {
		justify-content: flex-end;
		min-height: 120px;
		padding: 16px;
		background: color-mix(in srgb, var(--cream) 10%, transparent);
	}
	.card-name {
		font-family: var(--serif);
		font-size: 18px;
		color: var(--cream);
	}
	.card-count {
		font-family: var(--sans);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: color-mix(in srgb, var(--cream) 65%, transparent);
	}
	.results {
		margin-top: 40px;
	}
	.more {
		display: block;
		margin: 40px auto 0;
		min-height: 44px;
		padding: 0 32px;
		font-family: var(--sans);
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--cream);
		background: color-mix(in srgb, var(--cream) 14%, transparent);
		border: none;
		cursor: pointer;
	}
	.empty,
	.hint {
		margin-top: 56px;
		font-family: var(--serif);
		font-size: 24px;
		color: color-mix(in srgb, var(--cream) 80%, transparent);
	}
	.hint-example {
		font-family: var(--sans);
		font-size: 15px;
		letter-spacing: 0.04em;
		color: var(--dawn);
	}
</style>
```

Notes: `--accent` comes from the person's stored accent (assigned from `ACCENTS` in tokens — not a hard-coded hex). Person/album card text colors use the cream anchor; if the surrounding layout room is a light decade in light mode, reuse the page-level chrome-flip mechanism phase 03 established for captions (check `src/routes/+layout.svelte` for the pattern) — the structural markup above does not change.

- [ ] **Step 3: Typecheck + smoke it in the dev server**

Run: `pnpm check`
Expected: 0 errors.

Run: `pnpm dev` and open `http://localhost:5173/search?q=person%3AMom%20tag%3Achristmas%201988..1999` — chips render beneath the omnibox (person: Mom / tag: christmas / 1988–1999); submitting new text navigates and updates `?q=`. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/routes/search
git commit -m "feat: /search page with omnibox, removable chips, people/albums rows, results grid"
```

---

### Task 13: Timeline omnibox affordance (compact search on the home filter row)

**Files:**
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: phase 03's timeline home (filter chips row + active-year state); `parseOmnibox` (Task 3).
- Produces: a compact 44px search field in the timeline's filter-chips row; submitting navigates to `/search?q=…`, appending the timeline's active year as a bare year token **only when the query has no year token of its own** (preserves year context). `data-testid="timeline-search"` for Task 14.

- [ ] **Step 1: Locate the insertion points**

```bash
grep -n "searchParams.get('y')\|?y=" src/routes/+page.svelte src/routes/+page.ts src/routes/+page.server.ts 2>/dev/null
grep -n "chip" src/routes/+page.svelte
```

Note (a) the variable/store holding the active year (the one the year band renders — call sites of `?y=`), and (b) the filter-chips row container markup.

- [ ] **Step 2: Add the script logic**

In the `<script lang="ts">` block of `src/routes/+page.svelte`, add (replace `activeYear` with the actual year variable found in Step 1):

```ts
import { goto } from '$app/navigation';
import { parseOmnibox } from '$lib/domain/search-query';

let timelineSearchDraft = $state('');

function onTimelineSearch(e: SubmitEvent) {
	e.preventDefault();
	const v = timelineSearchDraft.trim();
	if (!v) {
		goto('/search');
		return;
	}
	// preserve the year the visitor is looking at, unless they typed their own year window
	const parsed = parseOmnibox(v);
	const q = parsed.yearFrom == null ? `${v} ${activeYear}` : v;
	goto(`/search?q=${encodeURIComponent(q)}`);
}
```

(If `goto` or `parseOmnibox` are already imported, don't duplicate.)

- [ ] **Step 3: Add the markup inside the filter-chips row container**

Append as the last child of the chips-row container found in Step 1:

```svelte
<form class="tl-search" role="search" onsubmit={onTimelineSearch}>
	<input
		class="tl-search-input"
		type="search"
		placeholder="Search"
		aria-label="Search the shoebox"
		autocomplete="off"
		data-testid="timeline-search"
		bind:value={timelineSearchDraft}
	/>
</form>
```

And in the page's `<style>` block (uses the page's existing token custom properties if the chips row already defines them; otherwise reuse the same `--cream`/`--sans` custom-property wiring the chips row uses):

```css
.tl-search {
	margin-left: auto;
	display: flex;
}
.tl-search-input {
	min-height: 44px;
	min-width: 180px;
	padding: 0 16px;
	font-family: var(--sans);
	font-size: 13px;
	letter-spacing: 0.06em;
	color: var(--cream);
	background: color-mix(in srgb, var(--cream) 14%, transparent);
	border: none;
}
.tl-search-input::placeholder {
	color: color-mix(in srgb, var(--cream) 55%, transparent);
	text-transform: uppercase;
	letter-spacing: 0.14em;
}
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `pnpm check`
Expected: 0 errors.

Run: `pnpm dev`, open `http://localhost:5173/?y=1994`, type `presents` in the compact field, press Enter.
Expected: navigation to `/search?q=presents%201994` (year token appended). Typing `presents 1996` instead navigates without appending `1994`. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: timeline omnibox affordance navigating to /search with year context"
```

---

### Task 14: Playwright e2e — search golden paths

**Files:**
- Create: `e2e/search.spec.ts`

**Interfaces:**
- Consumes: the whole phase — plus phase 01 setup/login pages, phase 02 upload + item APIs, phase 05 people API. Contract-6 request/response shapes are LAW; two internals need verification first (Step 1).
- Produces: e2e proof of — text search by description; `person:X tag:christmas` AND-combo; `1988..1999` window; holiday auto-tag (`1994-12-25` → `tag:christmas`); `person:Eric age:5-7` age window; person rename updating FTS; timeline affordance carrying year context.

Precondition: phase 01's Playwright config starts the app against a **fresh database** per run (its own first-run e2e requires that). This spec creates the owner at `/setup` itself.

- [ ] **Step 1: Verify the two phase-02/05 internals the spec consumes**

```bash
sed -n '1,80p' src/routes/api/upload/complete/+server.ts
grep -n "people" src/routes/api/items/\[id\]/+server.ts | head -20
grep -n "getByLabel\|label" src/routes/setup/+page.svelte | head -10
```

Confirm (and adapt the constants/fields in Step 2 if they differ):
- `POST /api/upload/complete` multipart field names (`uploadId`, `poster`, `thumb_400`, `thumb_800`, `thumb_1600`, `blurhash`, `meta`) and that its JSON response carries the created item id (expected key `itemId`).
- `PATCH /api/items/[id]` accepts a `people: string[]` (person ids) field alongside date/title/description metadata.
- The `/setup` form labels its fields Username / Password (adjust the `getByLabel` regexes otherwise).

- [ ] **Step 2: Write the spec**

Create `e2e/search.spec.ts`:

```ts
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';

// 1×1 transparent PNG; a unique trailing byte per item keeps sha256 distinct (dedupe check).
const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);
const USERNAME = 'e2e-owner';
const PASSWORD = 'shoebox-e2e-pass-1';

test.describe.configure({ mode: 'serial' });

let page: Page;
let api: APIRequestContext;
let ericId: string;
let momId: string;
const item = { lake: '', bike: '', xmas: '', old: '' };

async function createOwnerOrLogin() {
	await page.goto('/');
	if (page.url().includes('/setup')) {
		await page.getByLabel(/username/i).fill(USERNAME);
		await page.getByLabel(/^password/i).first().fill(PASSWORD);
		const confirm = page.getByLabel(/confirm/i);
		if (await confirm.count()) await confirm.fill(PASSWORD);
		await page.getByRole('button', { name: /create|continue|set ?up|start/i }).click();
	}
	if (page.url().includes('/login')) {
		await page.getByLabel(/username/i).fill(USERNAME);
		await page.getByLabel(/^password/i).first().fill(PASSWORD);
		await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
	}
	await page.waitForURL((u) => !u.pathname.startsWith('/setup') && !u.pathname.startsWith('/login'));
}

async function createPerson(data: { name: string; birthdate?: string }): Promise<string> {
	const res = await api.post('/api/people', { data });
	expect(res.ok()).toBe(true);
	return (await res.json()).id;
}

async function uploadPhoto(n: number): Promise<string> {
	const bytes = Buffer.concat([PNG_1PX, Buffer.from([n])]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const init = await api.post('/api/upload/init', {
		data: { sha256, sizeBytes: bytes.length, mime: 'image/png', filename: `e2e-${n}.png` }
	});
	expect(init.ok()).toBe(true);
	const { uploadId } = await init.json();
	const chunk = await api.put(`/api/upload/chunk?uploadId=${uploadId}&index=0`, {
		data: bytes,
		headers: { 'content-type': 'application/octet-stream' }
	});
	expect(chunk.ok()).toBe(true);
	const webp = (name: string) => ({ name, mimeType: 'image/webp', buffer: bytes });
	const complete = await api.post('/api/upload/complete', {
		multipart: {
			uploadId,
			meta: JSON.stringify({ type: 'photo', width: 1, height: 1 }),
			blurhash: 'LEHV6nWB2yk8',
			poster: webp('poster.webp'),
			thumb_400: webp('thumb_400.webp'),
			thumb_800: webp('thumb_800.webp'),
			thumb_1600: webp('thumb_1600.webp')
		}
	});
	expect(complete.ok()).toBe(true);
	return (await complete.json()).itemId;
}

async function patchItem(id: string, data: Record<string, unknown>) {
	const res = await api.patch(`/api/items/${id}`, { data });
	expect(res.ok()).toBe(true);
}

async function search(q: string) {
	await page.goto(`/search?q=${encodeURIComponent(q)}`);
}

const itemLink = (id: string) => page.locator(`a[href*="/item/${id}"]`);

test.beforeAll(async ({ browser }) => {
	const ctx = await browser.newContext();
	page = await ctx.newPage();
	api = ctx.request; // shares session cookies with the page

	await createOwnerOrLogin();
	ericId = await createPerson({ name: 'Eric', birthdate: '1988-06-14' });
	momId = await createPerson({ name: 'Mom' });

	item.lake = await uploadPhoto(1);
	await patchItem(item.lake, {
		title: 'Lake day',
		description: 'Eating watermelon at the lake',
		dateStart: '1993-08-10',
		dateEnd: '1993-08-10',
		datePrecision: 'day',
		people: [ericId]
	});

	item.bike = await uploadPhoto(2);
	await patchItem(item.bike, {
		title: 'Bike ride',
		dateStart: '1996-08-10',
		dateEnd: '1996-08-10',
		datePrecision: 'day',
		people: [ericId]
	});

	item.xmas = await uploadPhoto(3);
	await patchItem(item.xmas, {
		title: 'Morning presents',
		dateStart: '1994-12-25', // day precision → holiday auto-tagging on the PATCH write path
		dateEnd: '1994-12-25',
		datePrecision: 'day',
		people: [ericId, momId]
	});

	item.old = await uploadPhoto(4);
	await patchItem(item.old, {
		title: 'Old photo',
		dateStart: '1985-05-05',
		dateEnd: '1985-05-05',
		datePrecision: 'day'
	});
});

test('text search finds an item by its description', async () => {
	await search('watermelon');
	await expect(itemLink(item.lake)).toBeVisible();
	await expect(itemLink(item.bike)).toHaveCount(0);
});

test('holiday auto-tag: item dated 1994-12-25 is searchable via tag:christmas', async () => {
	await search('tag:christmas');
	await expect(itemLink(item.xmas)).toBeVisible();
	await expect(itemLink(item.lake)).toHaveCount(0);
});

test('person + tag AND-combo: person:Mom tag:christmas', async () => {
	await search('person:Mom tag:christmas');
	await expect(itemLink(item.xmas)).toBeVisible();
	await expect(itemLink(item.lake)).toHaveCount(0);
	await expect(itemLink(item.bike)).toHaveCount(0);
});

test('year window 1988..1999 excludes the 1985 item', async () => {
	await search('1988..1999');
	await expect(itemLink(item.lake)).toBeVisible();
	await expect(itemLink(item.bike)).toBeVisible();
	await expect(itemLink(item.xmas)).toBeVisible();
	await expect(itemLink(item.old)).toHaveCount(0);
});

test('age window: person:Eric age:5-7 returns only the 1993 item', async () => {
	await search('person:Eric age:5-7');
	await expect(itemLink(item.lake)).toBeVisible();
	await expect(itemLink(item.bike)).toHaveCount(0);
	await expect(itemLink(item.xmas)).toHaveCount(0);
});

test('renaming a person updates the FTS index (searchable by new name)', async () => {
	const res = await api.patch(`/api/people/${ericId}`, { data: { name: 'Eric Junior' } });
	expect(res.ok()).toBe(true);
	await search('Junior');
	await expect(itemLink(item.lake)).toBeVisible();
	await expect(itemLink(item.bike)).toBeVisible();
	await expect(itemLink(item.xmas)).toBeVisible();
});

test('empty state copy', async () => {
	await search('zzzqqqxyzzy');
	await expect(page.getByTestId('search-empty')).toContainText('Nothing found in the shoebox');
});

test('omnibox is plain-submit and updates the URL', async () => {
	await page.goto('/search');
	await page.getByTestId('omnibox').fill('watermelon');
	await page.getByTestId('omnibox').press('Enter');
	await page.waitForURL(/\/search\?q=watermelon/);
	await expect(itemLink(item.lake)).toBeVisible();
});

test('timeline compact search carries the active year as a token', async () => {
	await page.goto('/?y=1994');
	await page.getByTestId('timeline-search').fill('presents');
	await page.getByTestId('timeline-search').press('Enter');
	await page.waitForURL(/\/search\?q=/);
	const q = decodeURIComponent(new URL(page.url()).searchParams.get('q') ?? '');
	expect(q).toContain('presents');
	expect(q).toContain('1994');
	await expect(itemLink(item.xmas)).toBeVisible();
});
```

- [ ] **Step 3: Run the spec to verify it fails before a rebuild** (the app must be rebuilt so the new routes exist in the Playwright webServer build)

Run: `pnpm playwright test e2e/search.spec.ts`
Expected on the first run against a stale build: failures (missing `/search` route or 404s). If the Playwright config builds fresh on each run, skip to Step 4.

- [ ] **Step 4: Run green**

Run: `pnpm playwright test e2e/search.spec.ts`
Expected: **9 passed**.

- [ ] **Step 5: Full phase gate**

Run: `pnpm check && pnpm test && pnpm test:e2e`
Expected: everything green (all phases' suites).

- [ ] **Step 6: Commit**

```bash
git add e2e/search.spec.ts
git commit -m "test: e2e search golden paths (text, combos, windows, holiday tags, rename)"
```

---

## Ambiguities & Resolutions (self-review)

Scope coverage was checked against spec §8 (FTS5 columns, composable structured filters, omnibox chips, filtered timeline histograms) and §4 (holiday derivation at write time → `kind=holiday` system tags; age windows from birthdate) — every bullet maps to a task (index: T4–T6; holidays: T1–T2, T8; parser: T3; filters/age: T9; API: T10; histograms: T11; UI: T12–T13; e2e: T14). Placeholder scan and signature-consistency pass done; the following judgment calls were made and are binding for implementers:

- **R1 — contentless delete.** The master's "delete+insert" note cannot literally work on a plain `content=''` table (deleting requires replaying the old column values, which are gone after a mutation). Resolved with a phase-06 migration recreating `search_fts` with `contentless_delete=1` (SQLite ≥ 3.43; bundled SQLite in better-sqlite3 and D1 both qualify — Task 4 tests the version at runtime). The pattern remains delete+insert (`DELETE … WHERE rowid = ?` then `INSERT`), and `search_fts.rowid` is keyed to `items.rowid` because contentless tables cannot return stored column values (all reads except rowid yield NULL) — so all query joins go through rowid, and `item_id UNINDEXED` is retained purely to honor the Contract-1 column list.
- **R2 — `parseOmnibox` return type.** Contract 5 declares `SearchQuery`; this phase returns `ParsedOmnibox = SearchQuery & { warnings: string[] }` — a structural subtype, so all Contract-5 consumers typecheck unchanged. Documented in the source docblock (Task 3).
- **R3 — `/api/search` response.** Contract 6 mandates `{ items, people, albums }`; `nextCursor` (required by this phase's cursor-pagination scope), `query` (canonicalized chips), and `warnings` are additive fields. Person/album cards are name matches on the text portion, first page only.
- **R4 — unresolvable structured facets** (`person:`/`tag:`/`album:`/`uploader:` naming nothing) return an empty item set plus a warning — never an HTTP error. An `age:` facet whose person lacks a birthdate (or isn't the single person facet) is dropped with a warning while the rest of the query runs.
- **R5 — holiday/topic tag name collision.** `tags.name` is UNIQUE; if a topic tag already uses a holiday name (e.g. user-created `christmas`), the auto-tagger reuses it and never flips its kind. Consequence: such a tag is exempt from stale-removal (which targets `kind='holiday'` only) — treated as user data.
- **R6 — timeline filter params** `people`/`tags`/`album` are interpreted as ID csv values (matching `/api/items`'s `people (csv)` reading and phase 03's chip state); free-form queries go through `q` as an omnibox string. The no-filter fast path from `year_counts` is preserved byte-for-byte.
- **R7 — phase 01–05 internals** (single-item DTO builder name, upload-complete multipart field names, `PATCH /api/items/[id]` people field, `/setup` form labels, MasonryGrid props, timeline active-year variable, possible existing test-DB helper, possible tag-rename endpoint): the master fixes the route paths and payload shapes, but not these internal names. Each consuming task opens with an exact grep/read verification step and a one-line adaptation rule; the names assumed in code blocks are the canonical fallback.
- **R8 — `db:reindex` is node-only** (better-sqlite3 script). Cloudflare deployments keep the index current via the Task 6 hooks; the Task 4 migration note (index emptied → reindex) applies to Docker upgrades, and fresh CF installs never have a populated pre-v2 index.
- **R9 — holiday tag names are the holiday ids** (`christmas`, `july-4th`, …) — lowercase, satisfying the schema's tag-name rule and making `tag:christmas` work with zero mapping.
- **R10 — cursor format** is the opaque string `"<sortDate>~<id>"` over `ORDER BY sort_date DESC, id DESC` (undated items sort last via `coalesce(sort_date,'')`). If phase 02's `/api/items` established a different cursor encoding, `/api/search`'s cursor remains independent — it is only ever produced and consumed by `/api/search` itself.
