# Shoebox Phase 02 — Media Core (upload pipeline, item CRUD, streaming, aggregates, trash)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver working media ingestion through the browser: the precision date model, resumable chunked uploads with SHA-256 dedupe, client-side derivative generation (poster / thumbs / blurhash / EXIF), item CRUD with the master ItemDTO, `/media` streaming with HTTP Range, `year_counts` aggregates + `/api/timeline`, trash semantics, and a `/upload` page — proven end-to-end by Playwright.

**Architecture:** All server logic lives in runtime-portable modules under `src/lib/server/` (`upload.ts`, `dedupe.ts`, `items.ts`, `aggregates.ts`, `shares.ts`, `http-range.ts`) that receive `db`, `StorageAdapter`, and `JobQueueAdapter` from `locals` — never importing `node:*`, `sharp`, `ffmpeg`, or `better-sqlite3`. API routes are thin wrappers doing role checks + payload validation. Upload state is content-addressed in storage itself (`tmp/<sha256>/…`) so resume works identically on filesystem and R2 without new tables. All derivatives are generated in the browser (`src/lib/upload/`); the server only stores them and enqueues `derivatives`/`sprite` jobs for phase 07's worker.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM, Vitest, Playwright, `@noble/hashes` (incremental SHA-256 in browser), `blurhash`, `exifr`, pnpm.

**Depends on:** Phase 01 (schema + migrations, platform adapters, auth/sessions/roles, hooks populating `locals { user, platform, db }`, layout shell, tokens).

## Global Constraints

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
- Master contracts: `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its schema, platform interfaces, DTO shapes, and signatures are LAW. On any conflict, the master wins.

**Exception note (test files only):** `src/lib/server/testing/memory-db.ts` imports `better-sqlite3`. It is imported ONLY from `*.test.ts` files and is never reachable from app code; this mirrors phase 01's adapter contract tests and does not violate the runtime-portability rule (which governs code shipped in the app bundle).

## Phase-boundary decisions (read before implementing)

Resolved ambiguities — these are the binding choices for this phase:

1. **Blurhash storage** — the master schema has no blurhash column and may not be extended. Blurhash strings are persisted in the `settings` table under key `blurhash:<itemId>` (value = JSON-encoded string), batch-fetched with one `IN` query per DTO page.
2. **`items_sha` unique index vs "allow anyway"** — a second copy of the same bytes cannot share the sha256 value. On duplicate-override, the stored value becomes `<sha256>#dup-<nanoid(6)>`. Dedupe lookups match `sha256 = ? OR sha256 LIKE ? || '#%'`.
3. **`uploadId` = the file's sha256 hex** — content-addressed temp area `tmp/<sha256>/…` gives resumability for free: re-running init reports `receivedChunks` and the client only sends missing chunks.
4. **`/api/upload/complete` vs `POST /api/items`** — `complete` (multipart) assembles chunks, stores derivatives, and creates the item + item_files rows (this phase's browser path). `POST /api/items` (JSON) is the shared creation primitive over already-stored storage keys — both call `createItem()`; phase 07 ingestion reuses it.
5. **`q` filter** — FTS is phase 06 (forbidden here). Until then `q` does a `LIKE '%q%'` match on title/description; phase 06 replaces the implementation without changing the API shape.
6. **List order & cursor** — `sortDate ASC`, `NULL`s last, `id ASC` tiebreak. Cursor = base64url of `{"s": sortDate|null, "id": lastId}`.
7. **`people[].age` in ItemDTO** — `ages.ts` is phase 05; `age` (optional in the master DTO) is omitted until then.
8. **Photos also get `poster.webp`** (max-1600 WebP, distinct object from thumb_1600) so `urls.poster` is always present for both media types.
9. **StorageAdapter.get range semantics** — `end` is an inclusive byte offset (HTTP semantics). Total size for `Content-Range` always comes from `head()`, never from the ranged `get()`.
10. **Node media URLs** — the master defines `mediaUrl(key) = '/media/' + key` and keys start with `media/`, so browser URLs look like `/media/media/<itemId>/poster.webp`. Contract-literal; keep it.
11. **`shortDate` range across a century boundary** renders the full end year: `c. 1998–2003`.
12. **`sprite` job** is enqueued only for videos; `derivatives` for both types. Both are no-ops on Cloudflare (queue-noop) and processed in phase 07 — this phase only enqueues.
13. **GET /api/items params** — `people` = csv of person **ids**; `tags` = csv of tag **names** (normalized lowercase).
14. **Restore** = `POST /api/items/[id]` with body `{"action":"restore"}`, editor+ (master lists GET/PATCH/DELETE; the restore verb is this phase's scope directive).
15. **`/api/timeline` counts** sum video+photo per year (master shape `{ year, count }` has no type split).
16. **Incremental hashing** — `crypto.subtle.digest` has no streaming API, so the browser hashes 8 MiB `file.slice()` reads through `@noble/hashes`' incremental sha256 (pure JS, portable).
17. **e2e fixtures** are checked-in base64 files (a real 2.9 KB H.264 MP4 and a real 350 B JPEG, pre-generated with ffmpeg); a regeneration script is provided but ffmpeg is NOT required to run the suite.
18. **e2e server** = `pnpm dev` (vite) so session cookies are non-Secure over http. Note for phase 10: adapter-node needs `BODY_SIZE_LIMIT` raised (its default 512 KB rejects 8 MiB chunks); dev server has no such limit.

**Phase-01 seam assumptions** (not defined by the master; the e2e helper isolates them as constants at the top of `e2e/media-core.spec.ts`): `/setup` and `/login` render `input[name="username"]`, `input[name="password"]` and a `button[type="submit"]`. If phase 01 named them differently, fix ONLY the selector constants in that one file.

## File Structure

```
src/lib/types.ts                                    # shared client/server DTO types (ItemDTO, UploadMeta, PersonListDTO)
src/lib/domain/dates.ts                             # Contract 5 date model (+ itemDateFrom, isValidItemDate helpers)
src/lib/domain/dates.test.ts                        # exhaustive precision/circa unit tests
src/lib/domain/dims.ts                              # fitWithin() derivative dimension math (client + server)
src/lib/domain/dims.test.ts
src/lib/server/testing/memory-db.ts                 # in-memory sqlite + migrations for unit tests (test-only)
src/lib/server/testing/memory-platform.ts           # MemoryStorage / MemoryQueue fakes implementing Contract 2
src/lib/server/testing/memory-platform.test.ts
src/lib/server/aggregates.ts                        # recomputeYearCounts + bumpYearCount
src/lib/server/aggregates.test.ts
src/lib/server/dedupe.ts                            # findDuplicate, duplicateSha
src/lib/server/upload.ts                            # init/chunk/assemble/complete upload pipeline + meta validation
src/lib/server/upload.test.ts
src/lib/server/items.ts                             # createItem, DTO builder, listItems, update/delete/restore
src/lib/server/items.test.ts
src/lib/server/shares.ts                            # canAccessMedia() seam (phase 08 adds resolveShare)
src/lib/server/http-range.ts                        # parseRange() for HTTP Range headers
src/lib/server/http-range.test.ts
src/routes/api/upload/init/+server.ts               # POST → InitUploadResult
src/routes/api/upload/init/init.test.ts
src/routes/api/upload/chunk/+server.ts              # PUT raw chunk body
src/routes/api/upload/chunk/chunk.test.ts
src/routes/api/upload/complete/+server.ts           # POST multipart → { item: ItemDTO }
src/routes/api/upload/complete/complete.test.ts
src/routes/api/items/+server.ts                     # GET list (filters+cursor) / POST create
src/routes/api/items/items-route.test.ts
src/routes/api/items/[id]/+server.ts                # GET / PATCH / DELETE / POST(restore)
src/routes/api/items/[id]/item-route.test.ts
src/routes/api/timeline/+server.ts                  # GET year histogram from year_counts
src/routes/api/timeline/timeline.test.ts
src/routes/api/people/+server.ts                    # GET real people list (phase 05 adds write verbs)
src/routes/api/people/people-route.test.ts
src/routes/media/[...key]/+server.ts                # node: Range streaming; CF: 302 signed URL
src/routes/media/media-route.test.ts
src/lib/upload/hash.ts                              # incremental sha256File()
src/lib/upload/hash.test.ts
src/lib/upload/uploader.ts                          # apiInitUpload / uploadChunks / apiCompleteUpload
src/lib/upload/uploader.test.ts
src/lib/upload/derive-photo.ts                      # canvas thumbs + blurhash + exifr date (browser only)
src/lib/upload/derive-video.ts                      # <video> seek → poster + thumbs + metadata (browser only)
src/lib/ui/DatePicker.svelte                        # precision-aware date entry (Contract spec §4)
src/routes/upload/+page.server.ts                   # uploader gate + people list for the form
src/routes/upload/+page.svelte                      # drag-drop multi-file UI, progress, dedupe warning, metadata form
e2e/fixtures/tiny.mp4.b64                           # checked-in base64 of a real 1 s 192×108 H.264 MP4
e2e/fixtures/tiny.jpg.b64                           # checked-in base64 of a real 192×108 JPEG
e2e/fixtures/generate-fixtures.sh                   # optional ffmpeg regeneration script (documentation)
e2e/media-core.spec.ts                              # golden path: login → upload → DTO → Range 206 → dedupe warn → trash
playwright.config.ts                                # (create only if phase 01 did not) dev-server e2e config
```

---

### Task 1: Domain date model (`dates.ts`) and dimension math (`dims.ts`)

**Files:**
- Create: `src/lib/domain/dates.test.ts`, `src/lib/domain/dates.ts`, `src/lib/domain/dims.test.ts`, `src/lib/domain/dims.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces (Contract 5, verbatim — later phases import these):
  - `export type DatePrecision = 'day'|'month'|'year'|'range'|'unknown'`
  - `export interface ItemDate { dateStart: string|null; dateEnd: string|null; precision: DatePrecision; }`
  - `export function sortDate(d: ItemDate): string | null`
  - `export function displayDate(d: ItemDate): string`
  - `export function shortDate(d: ItemDate): string`
  - `export function yearOf(d: ItemDate): number | null`
  - Extras this phase adds (used by DatePicker + server validation): `isValidItemDate(d: ItemDate): boolean`, `itemDateFrom(input): ItemDate`, `daysInMonth(year, month): number`, `MONTHS_LONG`, `MONTHS_SHORT`
  - `fitWithin(width: number, height: number, maxWidth: number): { width: number; height: number }` from `dims.ts`

**Steps:**

- [ ] Step 1.1 — Write the failing test `src/lib/domain/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  displayDate,
  isValidItemDate,
  itemDateFrom,
  shortDate,
  sortDate,
  yearOf,
  type ItemDate,
} from './dates';

const d = (
  dateStart: string | null,
  dateEnd: string | null,
  precision: ItemDate['precision'],
): ItemDate => ({ dateStart, dateEnd, precision });

describe('sortDate', () => {
  it('day → the day itself', () => {
    expect(sortDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('1994-06-14');
  });
  it('month → midpoint of the month', () => {
    expect(sortDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('1994-06-15');
  });
  it('year → midpoint of the year', () => {
    expect(sortDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('1994-07-02');
  });
  it('range → midpoint across years', () => {
    expect(sortDate(d('1992-01-01', '1995-12-31', 'range'))).toBe('1993-12-31');
  });
  it('unknown → null', () => {
    expect(sortDate(d(null, null, 'unknown'))).toBeNull();
  });
});

describe('displayDate', () => {
  it('day', () => expect(displayDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('June 14, 1994'));
  it('month', () => expect(displayDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('June 1994'));
  it('year', () => expect(displayDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('1994'));
  it('range', () =>
    expect(displayDate(d('1992-01-01', '1995-12-31', 'range'))).toBe('Between 1992 and 1995'));
  it('unknown', () => expect(displayDate(d(null, null, 'unknown'))).toBe('Undated'));
});

describe('shortDate', () => {
  it('day', () => expect(shortDate(d('1994-06-14', '1994-06-14', 'day'))).toBe('Jun 14'));
  it('month', () => expect(shortDate(d('1994-06-01', '1994-06-30', 'month'))).toBe('Jun'));
  it('year → circa', () => expect(shortDate(d('1994-01-01', '1994-12-31', 'year'))).toBe('c. 1994'));
  it('range, same century → short circa with en dash', () =>
    expect(shortDate(d('1992-01-01', '1995-12-31', 'range'))).toBe('c. 1992–95'));
  it('range across a century → full end year', () =>
    expect(shortDate(d('1998-01-01', '2003-12-31', 'range'))).toBe('c. 1998–2003'));
  it('unknown → em dash', () => expect(shortDate(d(null, null, 'unknown'))).toBe('—'));
});

describe('yearOf', () => {
  it('year of the computed sort date', () =>
    expect(yearOf(d('1992-01-01', '1995-12-31', 'range'))).toBe(1993));
  it('plain year', () => expect(yearOf(d('1994-01-01', '1994-12-31', 'year'))).toBe(1994));
  it('null when unknown', () => expect(yearOf(d(null, null, 'unknown'))).toBeNull());
});

describe('isValidItemDate', () => {
  it('accepts each canonical shape', () => {
    expect(isValidItemDate(d('1994-06-14', '1994-06-14', 'day'))).toBe(true);
    expect(isValidItemDate(d('1994-06-01', '1994-06-30', 'month'))).toBe(true);
    expect(isValidItemDate(d('1992-02-01', '1992-02-29', 'month'))).toBe(true); // leap Feb
    expect(isValidItemDate(d('1994-01-01', '1994-12-31', 'year'))).toBe(true);
    expect(isValidItemDate(d('1992-01-01', '1995-12-31', 'range'))).toBe(true);
    expect(isValidItemDate(d(null, null, 'unknown'))).toBe(true);
  });
  it('rejects malformed shapes', () => {
    expect(isValidItemDate(d('1994-06-14', '1994-06-15', 'day'))).toBe(false);   // day must be equal
    expect(isValidItemDate(d('1994-06-01', '1994-06-29', 'month'))).toBe(false); // month must end on last day
    expect(isValidItemDate(d('1994-02-01', '1994-03-31', 'month'))).toBe(false); // month must be one month
    expect(isValidItemDate(d('1994-02-01', '1994-12-31', 'year'))).toBe(false);  // year must span Jan1–Dec31
    expect(isValidItemDate(d('1994-01-01', '1994-12-31', 'range'))).toBe(false); // range needs end year > start
    expect(isValidItemDate(d('1994-02-30', '1994-02-30', 'day'))).toBe(false);   // impossible date
    expect(isValidItemDate(d('junk', 'junk', 'day'))).toBe(false);
    expect(isValidItemDate(d('1994-06-14', null, 'day'))).toBe(false);
    expect(isValidItemDate(d('1994-06-14', '1994-06-14', 'unknown'))).toBe(false);
  });
});

describe('itemDateFrom', () => {
  it('day', () =>
    expect(itemDateFrom({ precision: 'day', day: '1994-06-14' })).toEqual(
      d('1994-06-14', '1994-06-14', 'day'),
    ));
  it('month expands to full month (leap-aware)', () =>
    expect(itemDateFrom({ precision: 'month', year: 1992, month: 2 })).toEqual(
      d('1992-02-01', '1992-02-29', 'month'),
    ));
  it('year expands to Jan 1 – Dec 31', () =>
    expect(itemDateFrom({ precision: 'year', year: 1994 })).toEqual(
      d('1994-01-01', '1994-12-31', 'year'),
    ));
  it('range expands both years', () =>
    expect(itemDateFrom({ precision: 'range', year: 1992, yearEnd: 1995 })).toEqual(
      d('1992-01-01', '1995-12-31', 'range'),
    ));
  it('unknown is all-null', () =>
    expect(itemDateFrom({ precision: 'unknown' })).toEqual(d(null, null, 'unknown')));
  it('throws on missing inputs', () => {
    expect(() => itemDateFrom({ precision: 'day' })).toThrow();
    expect(() => itemDateFrom({ precision: 'month', year: 1994 })).toThrow();
    expect(() => itemDateFrom({ precision: 'range', year: 1995, yearEnd: 1992 })).toThrow();
  });
});

describe('daysInMonth', () => {
  it('handles leap years', () => {
    expect(daysInMonth(1992, 2)).toBe(29);
    expect(daysInMonth(1994, 2)).toBe(28);
    expect(daysInMonth(1994, 6)).toBe(30);
    expect(daysInMonth(1994, 12)).toBe(31);
  });
});
```

- [ ] Step 1.2 — Run `pnpm vitest run src/lib/domain/dates.test.ts`. **Expected: FAIL** — `Failed to resolve import "./dates"` (module does not exist yet).

- [ ] Step 1.3 — Implement `src/lib/domain/dates.ts` (complete file):

```ts
// Contract 5 date model. Pure, platform-free. See master plan §Contract 5.

export type DatePrecision = 'day' | 'month' | 'year' | 'range' | 'unknown';

export interface ItemDate {
  dateStart: string | null;
  dateEnd: string | null;
  precision: DatePrecision;
}

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Parse a strict ISO 'YYYY-MM-DD' into parts, or null if malformed/impossible. */
function parts(iso: string): Ymd | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // e.g. 1994-02-30 rolls over — reject
  }
  return { y, m: mo, d };
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of `month` (1-based).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/** True when the ItemDate matches the canonical shape for its precision. */
export function isValidItemDate(d: ItemDate): boolean {
  if (d.precision === 'unknown') return d.dateStart === null && d.dateEnd === null;
  if (!d.dateStart || !d.dateEnd) return false;
  const a = parts(d.dateStart);
  const b = parts(d.dateEnd);
  if (!a || !b) return false;
  switch (d.precision) {
    case 'day':
      return d.dateStart === d.dateEnd;
    case 'month':
      return a.y === b.y && a.m === b.m && a.d === 1 && b.d === daysInMonth(b.y, b.m);
    case 'year':
      return a.y === b.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31;
    case 'range':
      return b.y > a.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31;
  }
}

/** Build a canonical ItemDate from picker-style input. Throws Error on invalid input. */
export function itemDateFrom(input: {
  precision: DatePrecision;
  day?: string;
  year?: number;
  month?: number;
  yearEnd?: number;
}): ItemDate {
  switch (input.precision) {
    case 'unknown':
      return { dateStart: null, dateEnd: null, precision: 'unknown' };
    case 'day': {
      if (!input.day || !parts(input.day)) throw new Error('day precision requires a valid ISO day');
      return { dateStart: input.day, dateEnd: input.day, precision: 'day' };
    }
    case 'month': {
      if (
        input.year === undefined || input.month === undefined ||
        input.month < 1 || input.month > 12 || input.year < 1
      ) {
        throw new Error('month precision requires year and month');
      }
      return {
        dateStart: `${pad4(input.year)}-${pad2(input.month)}-01`,
        dateEnd: `${pad4(input.year)}-${pad2(input.month)}-${pad2(daysInMonth(input.year, input.month))}`,
        precision: 'month',
      };
    }
    case 'year': {
      if (input.year === undefined || input.year < 1) throw new Error('year precision requires year');
      return { dateStart: `${pad4(input.year)}-01-01`, dateEnd: `${pad4(input.year)}-12-31`, precision: 'year' };
    }
    case 'range': {
      if (input.year === undefined || input.yearEnd === undefined || input.yearEnd <= input.year) {
        throw new Error('range precision requires yearEnd > year');
      }
      return {
        dateStart: `${pad4(input.year)}-01-01`,
        dateEnd: `${pad4(input.yearEnd)}-12-31`,
        precision: 'range',
      };
    }
  }
}

/** Midpoint ISO date between dateStart and dateEnd; null when unknown. */
export function sortDate(d: ItemDate): string | null {
  if (d.precision === 'unknown' || !d.dateStart || !d.dateEnd) return null;
  const a = parts(d.dateStart);
  const b = parts(d.dateEnd);
  if (!a || !b) return null;
  const ms = (Date.UTC(a.y, a.m - 1, a.d) + Date.UTC(b.y, b.m - 1, b.d)) / 2;
  return new Date(ms).toISOString().slice(0, 10);
}

/** "June 14, 1994" | "June 1994" | "1994" | "Between 1992 and 1995" | "Undated" */
export function displayDate(d: ItemDate): string {
  if (d.precision === 'unknown' || !d.dateStart || !d.dateEnd) return 'Undated';
  const a = parts(d.dateStart);
  const b = parts(d.dateEnd);
  if (!a || !b) return 'Undated';
  switch (d.precision) {
    case 'day':
      return `${MONTHS_LONG[a.m - 1]} ${a.d}, ${a.y}`;
    case 'month':
      return `${MONTHS_LONG[a.m - 1]} ${a.y}`;
    case 'year':
      return String(a.y);
    case 'range':
      return `Between ${a.y} and ${b.y}`;
  }
}

/** "Jun 14" | "Jun" | "c. 1994" | "c. 1992–95" | "—" (circa treatment per spec §4). */
export function shortDate(d: ItemDate): string {
  if (d.precision === 'unknown' || !d.dateStart || !d.dateEnd) return '—';
  const a = parts(d.dateStart);
  const b = parts(d.dateEnd);
  if (!a || !b) return '—';
  switch (d.precision) {
    case 'day':
      return `${MONTHS_SHORT[a.m - 1]} ${a.d}`;
    case 'month':
      return MONTHS_SHORT[a.m - 1];
    case 'year':
      return `c. ${a.y}`;
    case 'range': {
      if (a.y === b.y) return `c. ${a.y}`;
      const sameCentury = Math.floor(a.y / 100) === Math.floor(b.y / 100);
      return sameCentury ? `c. ${a.y}–${String(b.y).slice(2)}` : `c. ${a.y}–${b.y}`;
    }
  }
}

/** Year of the computed sort date; null when unknown. */
export function yearOf(d: ItemDate): number | null {
  const sd = sortDate(d);
  return sd ? Number(sd.slice(0, 4)) : null;
}
```

- [ ] Step 1.4 — Run `pnpm vitest run src/lib/domain/dates.test.ts`. **Expected: PASS** (7 describe blocks, all tests green).

- [ ] Step 1.5 — Write the failing test `src/lib/domain/dims.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fitWithin } from './dims';

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(192, 108, 400)).toEqual({ width: 192, height: 108 });
    expect(fitWithin(400, 300, 400)).toEqual({ width: 400, height: 300 });
  });
  it('downscales landscape preserving aspect', () => {
    expect(fitWithin(1920, 1080, 400)).toEqual({ width: 400, height: 225 });
    expect(fitWithin(1920, 1080, 800)).toEqual({ width: 800, height: 450 });
    expect(fitWithin(1920, 1080, 1600)).toEqual({ width: 1600, height: 900 });
  });
  it('downscales portrait by width', () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1600, height: 2133 });
  });
  it('height never collapses to 0', () => {
    expect(fitWithin(10000, 1, 400).height).toBe(1);
  });
});
```

- [ ] Step 1.6 — Run `pnpm vitest run src/lib/domain/dims.test.ts`. **Expected: FAIL** — `Failed to resolve import "./dims"`.

- [ ] Step 1.7 — Implement `src/lib/domain/dims.ts` (complete file):

```ts
/** Scale (width, height) to fit maxWidth, preserving aspect. Never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return {
    width: maxWidth,
    height: Math.max(1, Math.round((height * maxWidth) / width)),
  };
}
```

- [ ] Step 1.8 — Run `pnpm vitest run src/lib/domain` — **Expected: PASS** (both files). Then run `pnpm check` — **Expected: 0 errors**.
- [ ] Step 1.9 — Commit: `git add -A && git commit -m "feat: date precision model and derivative dimension math (contract 5)"`

---

### Task 2: Shared DTO types + in-memory test platform (db, storage, queue)

**Files:**
- Create: `src/lib/types.ts`, `src/lib/server/testing/memory-db.ts`, `src/lib/server/testing/memory-platform.ts`, `src/lib/server/testing/memory-platform.test.ts`

**Interfaces:**
- Consumes (master Contract 1 & 2): `src/lib/server/db/schema.ts` tables; `StorageAdapter { put(key, data, opts): Promise<void>; get(key, range?): Promise<{stream,size,contentType}|null>; head(key): Promise<{size,contentType}|null>; delete(key): Promise<void>; mediaUrl(key): Promise<string> }`; `JobQueueAdapter { enqueue(kind, payload, runAfter?): Promise<void> }` from `$lib/server/platform/types`; `App.Locals` from phase 01 `app.d.ts`.
- Produces: `ItemDTO`, `UploadMeta`, `PersonListDTO` types (client-safe, imported by server AND browser code); `memoryDb()`, `seedUser()`, `seedPerson()`; `MemoryStorage`, `MemoryQueue` classes used by every server test in this phase.

**Steps:**

- [ ] Step 2.1 — Create `src/lib/types.ts` (complete file). These shapes are the master's Contract 6 `ItemDTO` verbatim (with `date: ItemDate` from Contract 5) — do not rename fields:

```ts
// Client-safe shared types. NO imports from $lib/server here — this file is
// bundled into browser code. ItemDTO shape is master Contract 6, verbatim.
import type { ItemDate } from '$lib/domain/dates';

export interface ItemDTO {
  id: string;
  type: 'video' | 'photo';
  title: string | null;
  description: string | null;
  date: ItemDate;
  displayDate: string;
  shortDate: string;
  duration: number | null;
  width: number;
  height: number;
  status: 'processing' | 'needs_review' | 'ready';
  urls: {
    poster: string;
    thumb400: string;
    thumb800: string;
    thumb1600: string;
    original?: string;
    sprite?: string;
  };
  blurhash: string | null;
  people: { id: string; name: string; accentColor: string; age?: number }[];
  tags: { id: string; name: string; kind: 'topic' | 'holiday' }[];
  albums: { id: string; title: string }[];
  uploadedBy: string;
  tapeLabel: string | null;
}

/** JSON payload carried in the `meta` multipart field of /api/upload/complete. */
export interface UploadMeta {
  type: 'video' | 'photo';
  width: number;
  height: number;
  duration: number | null;
  title: string | null;
  description: string | null;
  tapeLabel: string | null;
  date: ItemDate;
  people: string[]; // person ids
  tags: string[];   // free-entry tag names (topic tags created on write)
}

/** GET /api/people list row (read-only until phase 05 adds write verbs). */
export interface PersonListDTO {
  id: string;
  name: string;
  birthdate: string | null;
  deathDate: string | null;
  birthPlace: string | null;
  accentColor: string;
  avatarItemId: string | null;
}
```

- [ ] Step 2.2 — Write the failing test `src/lib/server/testing/memory-platform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemoryQueue, MemoryStorage } from './memory-platform';
import { memoryDb, seedPerson, seedUser } from './memory-db';
import { users } from '$lib/server/db/schema';

describe('MemoryStorage', () => {
  it('put/head/get/delete roundtrip with Uint8Array', async () => {
    const s = new MemoryStorage();
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await s.put('media/x/original.mp4', data, { contentType: 'video/mp4' });
    expect(await s.head('media/x/original.mp4')).toEqual({ size: 10, contentType: 'video/mp4' });
    const got = await s.get('media/x/original.mp4');
    expect(got).not.toBeNull();
    expect(new Uint8Array(await new Response(got!.stream).arrayBuffer())).toEqual(data);
    await s.delete('media/x/original.mp4');
    expect(await s.head('media/x/original.mp4')).toBeNull();
    expect(await s.get('missing')).toBeNull();
  });

  it('accepts a ReadableStream body', async () => {
    const s = new MemoryStorage();
    const stream = new Blob([new Uint8Array([9, 9, 9])]).stream();
    await s.put('k', stream, { contentType: 'application/octet-stream', sizeHint: 3 });
    expect((await s.head('k'))!.size).toBe(3);
  });

  it('serves inclusive byte ranges (HTTP semantics)', async () => {
    const s = new MemoryStorage();
    await s.put('k', new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { contentType: 'x/y' });
    const ranged = await s.get('k', { start: 2, end: 4 });
    expect(new Uint8Array(await new Response(ranged!.stream).arrayBuffer())).toEqual(
      new Uint8Array([2, 3, 4]),
    );
    const openEnd = await s.get('k', { start: 8 });
    expect(new Uint8Array(await new Response(openEnd!.stream).arrayBuffer())).toEqual(
      new Uint8Array([8, 9]),
    );
    expect(ranged!.size).toBe(10); // size = TOTAL object size (decision 9)
  });

  it('mediaUrl follows the node contract: /media/<key>', async () => {
    const s = new MemoryStorage();
    expect(await s.mediaUrl('media/abc/poster.webp')).toBe('/media/media/abc/poster.webp');
  });
});

describe('MemoryQueue', () => {
  it('records enqueued jobs', async () => {
    const q = new MemoryQueue();
    await q.enqueue('derivatives', { itemId: 'i1' });
    await q.enqueue('sprite', { itemId: 'i1' });
    expect(q.enqueued).toEqual([
      { kind: 'derivatives', payload: { itemId: 'i1' } },
      { kind: 'sprite', payload: { itemId: 'i1' } },
    ]);
  });
});

describe('memoryDb', () => {
  it('runs migrations and seeds users/people', async () => {
    const db = memoryDb();
    const user = await seedUser(db, { role: 'uploader' });
    expect(user.role).toBe('uploader');
    const person = await seedPerson(db, { name: 'Mom' });
    expect(person.name).toBe('Mom');
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] Step 2.3 — Run `pnpm vitest run src/lib/server/testing`. **Expected: FAIL** — cannot resolve `./memory-platform` / `./memory-db`.

- [ ] Step 2.4 — Implement `src/lib/server/testing/memory-platform.ts` (complete file):

```ts
// Test-only fakes implementing master Contract 2 exactly.
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';

async function collect(data: Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await new Response(data).arrayBuffer());
}

export class MemoryStorage implements StorageAdapter {
  files = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType: string; sizeHint?: number },
  ): Promise<void> {
    this.files.set(key, { data: await collect(data), contentType: opts.contentType });
  }

  async get(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null> {
    const f = this.files.get(key);
    if (!f) return null;
    // Decision 9: range.end is INCLUSIVE; returned size is the TOTAL object size.
    const bytes = range
      ? f.data.slice(range.start, range.end === undefined ? f.data.length : range.end + 1)
      : f.data;
    return { stream: new Blob([bytes]).stream(), size: f.data.length, contentType: f.contentType };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const f = this.files.get(key);
    return f ? { size: f.data.length, contentType: f.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async mediaUrl(key: string): Promise<string> {
    return `/media/${key}`; // node contract (master Contract 2)
  }
}

export class MemoryQueue implements JobQueueAdapter {
  enqueued: { kind: string; payload: Record<string, unknown> }[] = [];

  async enqueue(
    kind: 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan',
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.enqueued.push({ kind, payload });
  }
}

/** Fake App.Locals for route-handler tests. */
export function makeLocals(
  db: App.Locals['db'],
  user: App.Locals['user'],
  storage = new MemoryStorage(),
  queue = new MemoryQueue(),
  name: 'node' | 'cloudflare' = 'node',
): { locals: App.Locals; storage: MemoryStorage; queue: MemoryQueue } {
  const locals = {
    db,
    user,
    platform: {
      name,
      storage,
      queue,
      features: { ingestion: false, faces: false, serverDerivatives: false },
    },
  } as unknown as App.Locals;
  return { locals, storage, queue };
}
```

- [ ] Step 2.5 — Implement `src/lib/server/testing/memory-db.ts` (complete file). Test-only exception to the portability rule (see Global Constraints note):

```ts
// TEST-ONLY. Imported exclusively from *.test.ts files.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import * as schema from '$lib/server/db/schema';
import { people, users } from '$lib/server/db/schema';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;
type Role = SessionUser['role'];

export function memoryDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
  return db as unknown as Db;
}

export async function seedUser(
  db: Db,
  over: Partial<{ id: string; username: string; role: Role }> = {},
): Promise<SessionUser> {
  const id = over.id ?? `u_${nanoid(8)}`;
  const username = over.username ?? `user_${id}`;
  const role = over.role ?? 'uploader';
  await db.insert(users).values({
    id,
    username,
    passwordHash: 'pbkdf2$310000$dGVzdA$dGVzdA', // never verified in these tests
    role,
    accentColor: '#FA7B62',
    comfortMode: false,
    theme: 'system',
    createdAt: new Date(),
  });
  return {
    id,
    username,
    role,
    accentColor: '#FA7B62',
    personId: null,
    comfortMode: false,
    theme: 'system',
  };
}

export async function seedPerson(
  db: Db,
  over: Partial<{ id: string; name: string; birthdate: string }> = {},
): Promise<{ id: string; name: string }> {
  const id = over.id ?? `p_${nanoid(8)}`;
  const name = over.name ?? `Person ${id}`;
  await db.insert(people).values({
    id,
    name,
    birthdate: over.birthdate ?? null,
    accentColor: '#A8D8EA',
    createdAt: new Date(),
  });
  return { id, name };
}
```

- [ ] Step 2.6 — Run `pnpm vitest run src/lib/server/testing`. **Expected: PASS.** (If `migrationsFolder` errors, verify phase 01 generated migrations into `src/lib/server/db/migrations` — that path is the master's layout; fix the constant only if phase 01's `drizzle.config.ts` says otherwise.)
- [ ] Step 2.7 — Run `pnpm check` — **Expected: 0 errors** — then commit: `git add -A && git commit -m "test: shared DTO types and in-memory db/storage/queue test platform"`

---

### Task 3: Year-count aggregates (`aggregates.ts`)

**Files:**
- Create: `src/lib/server/aggregates.test.ts`, `src/lib/server/aggregates.ts`

**Interfaces:**
- Consumes: `items`, `yearCounts` tables (Contract 1); `memoryDb`/`seedUser` (Task 2).
- Produces (consumed by Task 6/9 item writes and Task 12 `/api/timeline`; phase 03 reads `/api/timeline`):
  - `recomputeYearCounts(db: Db): Promise<void>`
  - `bumpYearCount(db: Db, year: number | null, type: 'video'|'photo', delta: 1 | -1): Promise<void>`

**Steps:**

- [ ] Step 3.1 — Write the failing test `src/lib/server/aggregates.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { bumpYearCount, recomputeYearCounts } from './aggregates';
import { memoryDb, seedUser } from './testing/memory-db';
import { items, yearCounts } from '$lib/server/db/schema';
import { nanoid } from 'nanoid';

type Db = App.Locals['db'];

let db: Db;
let userId: string;

async function insertItem(over: {
  type: 'video' | 'photo';
  sortDate: string | null;
  deletedAt?: Date | null;
}) {
  await db.insert(items).values({
    id: nanoid(12),
    type: over.type,
    dateStart: over.sortDate,
    dateEnd: over.sortDate,
    datePrecision: over.sortDate ? 'day' : 'unknown',
    sortDate: over.sortDate,
    width: 192,
    height: 108,
    sizeBytes: 1000,
    sha256: nanoid(32),
    source: 'upload',
    status: over.sortDate ? 'ready' : 'needs_review',
    uploadedBy: userId,
    deletedAt: over.deletedAt ?? null,
    createdAt: new Date(),
  });
}

beforeEach(async () => {
  db = memoryDb();
  userId = (await seedUser(db)).id;
});

describe('recomputeYearCounts', () => {
  it('groups live, dated items by year and type', async () => {
    await insertItem({ type: 'video', sortDate: '1994-06-14' });
    await insertItem({ type: 'video', sortDate: '1994-12-25' });
    await insertItem({ type: 'photo', sortDate: '1994-01-01' });
    await insertItem({ type: 'photo', sortDate: '1988-07-04' });
    await insertItem({ type: 'photo', sortDate: null });                        // undated: excluded
    await insertItem({ type: 'video', sortDate: '1994-03-03', deletedAt: new Date() }); // trashed: excluded
    await recomputeYearCounts(db);
    const rows = (await db.select().from(yearCounts)).sort(
      (a, b) => a.year - b.year || a.type.localeCompare(b.type),
    );
    expect(rows).toEqual([
      { year: 1988, type: 'photo', count: 1 },
      { year: 1994, type: 'photo', count: 1 },
      { year: 1994, type: 'video', count: 2 },
    ]);
  });

  it('replaces stale rows', async () => {
    await db.insert(yearCounts).values({ year: 1970, type: 'video', count: 99 });
    await recomputeYearCounts(db);
    expect(await db.select().from(yearCounts)).toEqual([]);
  });
});

describe('bumpYearCount', () => {
  it('inserts on first bump, increments after', async () => {
    await bumpYearCount(db, 1994, 'video', 1);
    await bumpYearCount(db, 1994, 'video', 1);
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 2 }]);
  });

  it('decrements and floors at zero', async () => {
    await bumpYearCount(db, 1994, 'photo', 1);
    await bumpYearCount(db, 1994, 'photo', -1);
    await bumpYearCount(db, 1994, 'photo', -1); // extra decrement must not go negative
    const rows = await db.select().from(yearCounts);
    expect(rows).toEqual([{ year: 1994, type: 'photo', count: 0 }]);
  });

  it('is a no-op for null year (undated items)', async () => {
    await bumpYearCount(db, null, 'video', 1);
    expect(await db.select().from(yearCounts)).toEqual([]);
  });
});
```

- [ ] Step 3.2 — Run `pnpm vitest run src/lib/server/aggregates.test.ts`. **Expected: FAIL** — cannot resolve `./aggregates`.

- [ ] Step 3.3 — Implement `src/lib/server/aggregates.ts` (complete file):

```ts
// year_counts maintenance. recompute = full rebuild; bump = incremental delta
// applied on item create / soft-delete / restore / date-change.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { items, yearCounts } from '$lib/server/db/schema';

type Db = App.Locals['db'];

export async function recomputeYearCounts(db: Db): Promise<void> {
  await db.delete(yearCounts);
  const rows = await db
    .select({
      year: sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`,
      type: items.type,
      count: sql<number>`count(*)`,
    })
    .from(items)
    .where(and(isNull(items.deletedAt), sql`${items.sortDate} is not null`))
    .groupBy(sql`substr(${items.sortDate}, 1, 4)`, items.type);
  if (rows.length) {
    await db.insert(yearCounts).values(rows);
  }
}

export async function bumpYearCount(
  db: Db,
  year: number | null,
  type: 'video' | 'photo',
  delta: 1 | -1,
): Promise<void> {
  if (year === null) return;
  if (delta === 1) {
    await db
      .insert(yearCounts)
      .values({ year, type, count: 1 })
      .onConflictDoUpdate({
        target: [yearCounts.year, yearCounts.type],
        set: { count: sql`${yearCounts.count} + 1` },
      });
  } else {
    await db
      .update(yearCounts)
      .set({ count: sql`max(${yearCounts.count} - 1, 0)` })
      .where(and(eq(yearCounts.year, year), eq(yearCounts.type, type)));
  }
}
```

- [ ] Step 3.4 — Run `pnpm vitest run src/lib/server/aggregates.test.ts`. **Expected: PASS** (5 tests).
- [ ] Step 3.5 — Commit: `git add -A && git commit -m "feat: year_counts aggregates with incremental bump and full recompute"`

---

### Task 4: Dedupe + upload init/chunk server logic

**Files:**
- Create: `src/lib/server/dedupe.ts`, `src/lib/server/upload.test.ts`, `src/lib/server/upload.ts` (init/chunk half; Task 6 appends complete/assemble)

**Interfaces:**
- Consumes: `StorageAdapter` (Contract 2), `items` table, SvelteKit `error()`.
- Produces (consumed by upload routes in Task 9 and by `completeUpload` in Task 6):
  - `CHUNK_SIZE = 8 * 1024 * 1024`
  - `initUpload(db, storage, userId, input: InitUploadInput): Promise<InitUploadResult>` where `InitUploadResult = { uploadId, chunkSize, totalChunks, receivedChunks: number[], duplicateItemId: string | null }`
  - `saveChunk(storage, uploadId, index, data: Uint8Array): Promise<{ received: true }>`
  - `readManifest(storage, uploadId): Promise<UploadManifest>`, `chunkKey(uploadId, index)`, `expectedChunkSize(sizeBytes, index, chunkSize)`, `ALLOWED_MIME`
  - `findDuplicate(db, sha256): Promise<{ itemId: string } | null>`, `duplicateSha(sha256, suffix): string` from `dedupe.ts`

**Steps:**

- [ ] Step 4.1 — Ensure `nanoid` is a dependency (phase 01 uses it for ids; this is idempotent): run `pnpm add nanoid`.

- [ ] Step 4.2 — Write the failing test `src/lib/server/upload.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import {
  CHUNK_SIZE,
  chunkKey,
  expectedChunkSize,
  initUpload,
  readManifest,
  saveChunk,
} from './upload';
import { findDuplicate, duplicateSha } from './dedupe';
import { memoryDb, seedUser } from './testing/memory-db';
import { MemoryStorage } from './testing/memory-platform';
import { items } from '$lib/server/db/schema';

type Db = App.Locals['db'];

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

let db: Db;
let storage: MemoryStorage;
let userId: string;

async function insertItemWithSha(sha256: string, deletedAt: Date | null = null): Promise<string> {
  const id = nanoid(12);
  await db.insert(items).values({
    id,
    type: 'video',
    datePrecision: 'unknown',
    width: 192,
    height: 108,
    sizeBytes: 10,
    sha256,
    source: 'upload',
    status: 'needs_review',
    uploadedBy: userId,
    deletedAt,
    createdAt: new Date(),
  });
  return id;
}

beforeEach(async () => {
  db = memoryDb();
  storage = new MemoryStorage();
  userId = (await seedUser(db)).id;
});

describe('findDuplicate', () => {
  it('matches exact sha and #dup-suffixed sha, ignores trash', async () => {
    expect(await findDuplicate(db, SHA)).toBeNull();
    const id = await insertItemWithSha(duplicateSha(SHA, 'abc123'));
    expect(await findDuplicate(db, SHA)).toEqual({ itemId: id });
    await insertItemWithSha(SHA_B, new Date()); // trashed
    expect(await findDuplicate(db, SHA_B)).toBeNull();
  });
});

describe('initUpload', () => {
  const input = { sha256: SHA, sizeBytes: 20, mime: 'video/mp4', filename: 'clip.mp4' };

  it('rejects bad input with 400', async () => {
    for (const bad of [
      { ...input, sha256: 'nothex' },
      { ...input, sizeBytes: 0 },
      { ...input, sizeBytes: 1.5 },
      { ...input, mime: 'application/zip' },
      { ...input, filename: '' },
    ]) {
      await expect(initUpload(db, storage, userId, bad)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('creates a manifest keyed by sha256 and reports chunk plan', async () => {
    const res = await initUpload(db, storage, userId, input);
    expect(res).toEqual({
      uploadId: SHA,
      chunkSize: CHUNK_SIZE,
      totalChunks: 1,
      receivedChunks: [],
      duplicateItemId: null,
    });
    const manifest = await readManifest(storage, SHA);
    expect(manifest).toMatchObject({
      sha256: SHA, sizeBytes: 20, mime: 'video/mp4', filename: 'clip.mp4',
      chunkSize: CHUNK_SIZE, totalChunks: 1, createdBy: userId,
    });
  });

  it('computes multi-chunk plans', async () => {
    const res = await initUpload(db, storage, userId, {
      ...input,
      sizeBytes: CHUNK_SIZE * 2 + 5,
    });
    expect(res.totalChunks).toBe(3);
    expect(expectedChunkSize(CHUNK_SIZE * 2 + 5, 2, CHUNK_SIZE)).toBe(5);
  });

  it('reports the duplicate item id', async () => {
    const id = await insertItemWithSha(SHA);
    const res = await initUpload(db, storage, userId, input);
    expect(res.duplicateItemId).toBe(id);
  });

  it('re-init reports already-received chunks (resume)', async () => {
    await initUpload(db, storage, userId, input);
    await saveChunk(storage, SHA, 0, new Uint8Array(20));
    const again = await initUpload(db, storage, userId, input);
    expect(again.receivedChunks).toEqual([0]);
  });
});

describe('saveChunk', () => {
  it('validates uploadId, index and exact chunk size', async () => {
    await expect(saveChunk(storage, SHA, 0, new Uint8Array(1))).rejects.toMatchObject({ status: 404 });
    await initUpload(db, storage, userId, { sha256: SHA, sizeBytes: 20, mime: 'video/mp4', filename: 'c.mp4' });
    await expect(saveChunk(storage, SHA, 1, new Uint8Array(20))).rejects.toMatchObject({ status: 400 });
    await expect(saveChunk(storage, SHA, 0, new Uint8Array(19))).rejects.toMatchObject({ status: 400 });
    expect(await saveChunk(storage, SHA, 0, new Uint8Array(20))).toEqual({ received: true });
    expect((await storage.head(chunkKey(SHA, 0)))!.size).toBe(20);
  });
});
```

- [ ] Step 4.3 — Run `pnpm vitest run src/lib/server/upload.test.ts`. **Expected: FAIL** — cannot resolve `./upload` / `./dedupe`.

- [ ] Step 4.4 — Implement `src/lib/server/dedupe.ts` (complete file):

```ts
// SHA-256 dedupe. Decision 2: the master's items_sha unique index forbids two
// rows with the same sha256, so a user-approved duplicate stores
// '<sha>#dup-<suffix>'. Lookups therefore match both forms; trash is ignored.
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { items } from '$lib/server/db/schema';

type Db = App.Locals['db'];

export async function findDuplicate(db: Db, sha256: string): Promise<{ itemId: string } | null> {
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        isNull(items.deletedAt),
        or(eq(items.sha256, sha256), like(items.sha256, `${sha256}#%`)),
      ),
    )
    .limit(1);
  return rows.length ? { itemId: rows[0].id } : null;
}

export function duplicateSha(sha256: string, suffix: string): string {
  return `${sha256}#dup-${suffix}`;
}
```

- [ ] Step 4.5 — Implement `src/lib/server/upload.ts` (complete file as of this task; Task 6 appends the complete/assemble half):

```ts
// Resumable chunked upload pipeline (master Contracts 6 & 7).
// Upload state is content-addressed in storage: tmp/<sha256>/manifest.json +
// tmp/<sha256>/<chunkIndex>. No extra tables (decision 3). Runtime-portable.
import { error } from '@sveltejs/kit';
import type { StorageAdapter } from '$lib/server/platform/types';
import { findDuplicate } from '$lib/server/dedupe';

type Db = App.Locals['db'];

export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB (master Contract 6)

export const ALLOWED_MIME: Record<string, { ext: string; type: 'video' | 'photo' }> = {
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'image/jpeg': { ext: 'jpg', type: 'photo' },
  'image/png': { ext: 'png', type: 'photo' },
  'image/webp': { ext: 'webp', type: 'photo' },
  'image/avif': { ext: 'avif', type: 'photo' },
};

export interface UploadManifest {
  sha256: string;
  sizeBytes: number;
  mime: string;
  filename: string;
  chunkSize: number;
  totalChunks: number;
  createdBy: string;
  createdAt: string;
}

export interface InitUploadInput {
  sha256: string;
  sizeBytes: number;
  mime: string;
  filename: string;
}

export interface InitUploadResult {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  duplicateItemId: string | null;
}

const SHA_RE = /^[0-9a-f]{64}$/;

export function chunkKey(uploadId: string, index: number): string {
  return `tmp/${uploadId}/${index}`;
}

function manifestKey(uploadId: string): string {
  return `tmp/${uploadId}/manifest.json`;
}

export function expectedChunkSize(sizeBytes: number, index: number, chunkSize: number): number {
  return Math.min(chunkSize, sizeBytes - index * chunkSize);
}

async function writeManifest(storage: StorageAdapter, m: UploadManifest): Promise<void> {
  await storage.put(manifestKey(m.sha256), new TextEncoder().encode(JSON.stringify(m)), {
    contentType: 'application/json',
  });
}

export async function readManifest(storage: StorageAdapter, uploadId: string): Promise<UploadManifest> {
  const got = await storage.get(manifestKey(uploadId));
  if (!got) throw error(404, 'unknown uploadId');
  return JSON.parse(await new Response(got.stream).text()) as UploadManifest;
}

export async function initUpload(
  db: Db,
  storage: StorageAdapter,
  userId: string,
  input: InitUploadInput,
): Promise<InitUploadResult> {
  if (typeof input.sha256 !== 'string' || !SHA_RE.test(input.sha256)) {
    throw error(400, 'invalid sha256 (expect 64 lowercase hex chars)');
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw error(400, 'invalid sizeBytes');
  }
  if (!ALLOWED_MIME[input.mime]) throw error(400, `unsupported mime: ${input.mime}`);
  if (typeof input.filename !== 'string' || input.filename.length === 0) {
    throw error(400, 'missing filename');
  }

  const dup = await findDuplicate(db, input.sha256);
  const uploadId = input.sha256; // decision 3: content-addressed resume
  const totalChunks = Math.ceil(input.sizeBytes / CHUNK_SIZE);

  const existing = await storage.head(manifestKey(uploadId));
  if (!existing) {
    await writeManifest(storage, {
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      mime: input.mime,
      filename: input.filename,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });
  } else {
    const m = await readManifest(storage, uploadId);
    if (m.sizeBytes !== input.sizeBytes || m.mime !== input.mime || m.chunkSize !== CHUNK_SIZE) {
      // Stale manifest for the same hash (e.g. aborted upload with older code) — reset.
      await writeManifest(storage, { ...m, ...input, chunkSize: CHUNK_SIZE, totalChunks });
    }
  }

  const receivedChunks: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const h = await storage.head(chunkKey(uploadId, i));
    if (h && h.size === expectedChunkSize(input.sizeBytes, i, CHUNK_SIZE)) receivedChunks.push(i);
  }

  return {
    uploadId,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    receivedChunks,
    duplicateItemId: dup?.itemId ?? null,
  };
}

export async function saveChunk(
  storage: StorageAdapter,
  uploadId: string,
  index: number,
  data: Uint8Array,
): Promise<{ received: true }> {
  const manifest = await readManifest(storage, uploadId);
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    throw error(400, `chunk index ${index} out of range (0..${manifest.totalChunks - 1})`);
  }
  const expected = expectedChunkSize(manifest.sizeBytes, index, manifest.chunkSize);
  if (data.byteLength !== expected) {
    throw error(400, `chunk ${index}: expected ${expected} bytes, got ${data.byteLength}`);
  }
  await storage.put(chunkKey(uploadId, index), data, {
    contentType: 'application/octet-stream',
    sizeHint: data.byteLength,
  });
  return { received: true };
}
```

- [ ] Step 4.6 — Run `pnpm vitest run src/lib/server/upload.test.ts`. **Expected: PASS** (8 tests).
- [ ] Step 4.7 — Commit: `git add -A && git commit -m "feat: resumable upload init/chunk with content-addressed tmp area and sha dedupe"`

---

### Task 5: `createItem` + ItemDTO builder (`items.ts`)

**Files:**
- Create: `src/lib/server/items.test.ts`, `src/lib/server/items.ts`

**Interfaces:**
- Consumes: Contract 1 tables (`items`, `itemFiles`, `itemPeople`, `itemTags`, `tags`, `albums`, `albumItems`, `people`, `settings`); `StorageAdapter.mediaUrl` (Contract 2); `JobQueueAdapter.enqueue`; Task 1 date functions; Task 3 `bumpYearCount`; `ROLE_RANK` from `$lib/server/roles` (Contract 3).
- Produces (consumed by Tasks 6–11, phase 03 timeline, phase 04 player, phase 07 ingestion):
  - `createItem(db, storage, queue, input: CreateItemInput): Promise<ItemDTO>`
  - `getItemDTO(db, storage, id, opts?): Promise<ItemDTO | null>`
  - `buildItemDTOs(db, storage, rows): Promise<ItemDTO[]>`
  - `setItemPeople(db, itemId, personIds)`, `setItemTags(db, itemId, names)`, `normalizeTagName(name)`
  - `canModifyItem(user, row): boolean`

**Steps:**

- [ ] Step 5.1 — Write the failing test `src/lib/server/items.test.ts` (this file grows in Tasks 7–8; start with exactly this):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createItem, getItemDTO, normalizeTagName, type CreateItemInput } from './items';
import { memoryDb, seedPerson, seedUser } from './testing/memory-db';
import { MemoryQueue, MemoryStorage } from './testing/memory-platform';
import { settings, tags, yearCounts } from '$lib/server/db/schema';

type Db = App.Locals['db'];

let db: Db;
let storage: MemoryStorage;
let queue: MemoryQueue;
let userId: string;

export function baseInput(over: Partial<CreateItemInput> = {}): CreateItemInput {
  const id = over.id ?? 'itm000000001';
  return {
    id,
    type: 'video',
    title: 'Backyard sprinkler',
    description: null,
    tapeLabel: 'Tape 04',
    date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
    duration: 12.4,
    width: 1440,
    height: 1080,
    sizeBytes: 1000,
    sha256: 'c'.repeat(64),
    source: 'upload',
    blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    files: [
      { kind: 'original', storageKey: `media/${id}/original.mp4`, mime: 'video/mp4', width: 1440, height: 1080 },
      { kind: 'poster', storageKey: `media/${id}/poster.webp`, mime: 'image/webp', width: 1440, height: 1080 },
      { kind: 'thumb_400', storageKey: `media/${id}/thumb_400.webp`, mime: 'image/webp', width: 400, height: 300 },
      { kind: 'thumb_800', storageKey: `media/${id}/thumb_800.webp`, mime: 'image/webp', width: 800, height: 600 },
      { kind: 'thumb_1600', storageKey: `media/${id}/thumb_1600.webp`, mime: 'image/webp', width: 1440, height: 1080 },
    ],
    people: [],
    tags: [],
    uploadedBy: userId,
    ...over,
  };
}

beforeEach(async () => {
  db = memoryDb();
  storage = new MemoryStorage();
  queue = new MemoryQueue();
  userId = (await seedUser(db)).id;
});

describe('createItem', () => {
  it('creates a ready item with the full master DTO shape', async () => {
    const dto = await createItem(db, storage, queue, baseInput());
    expect(dto).toMatchObject({
      id: 'itm000000001',
      type: 'video',
      title: 'Backyard sprinkler',
      description: null,
      date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
      displayDate: '1994',
      shortDate: 'c. 1994',
      duration: 12.4,
      width: 1440,
      height: 1080,
      status: 'ready',
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      people: [],
      tags: [],
      albums: [],
      uploadedBy: userId,
      tapeLabel: 'Tape 04',
    });
    expect(dto.urls).toEqual({
      original: '/media/media/itm000000001/original.mp4',
      poster: '/media/media/itm000000001/poster.webp',
      thumb400: '/media/media/itm000000001/thumb_400.webp',
      thumb800: '/media/media/itm000000001/thumb_800.webp',
      thumb1600: '/media/media/itm000000001/thumb_1600.webp',
    });
  });

  it('undated items land in needs_review', async () => {
    const dto = await createItem(
      db, storage, queue,
      baseInput({ date: { dateStart: null, dateEnd: null, precision: 'unknown' } }),
    );
    expect(dto.status).toBe('needs_review');
    expect(dto.displayDate).toBe('Undated');
    expect(await db.select().from(yearCounts)).toEqual([]); // no year bump when undated
  });

  it('rejects malformed dates with 400', async () => {
    await expect(
      createItem(db, storage, queue, baseInput({
        date: { dateStart: '1994-06-14', dateEnd: null, precision: 'day' },
      })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('bumps year_counts and enqueues derivatives + sprite for videos', async () => {
    await createItem(db, storage, queue, baseInput());
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 1 }]);
    expect(queue.enqueued).toEqual([
      { kind: 'derivatives', payload: { itemId: 'itm000000001' } },
      { kind: 'sprite', payload: { itemId: 'itm000000001' } },
    ]);
  });

  it('photos enqueue derivatives only', async () => {
    await createItem(db, storage, queue, baseInput({ type: 'photo', duration: null }));
    expect(queue.enqueued.map((j) => j.kind)).toEqual(['derivatives']);
  });

  it('upserts topic tags case-insensitively and links people', async () => {
    const mom = await seedPerson(db, { name: 'Mom' });
    const dto = await createItem(
      db, storage, queue,
      baseInput({ tags: ['  Christmas ', 'sprinkler', 'christmas'], people: [mom.id] }),
    );
    expect(dto.tags.map((t) => t.name).sort()).toEqual(['christmas', 'sprinkler']);
    expect(dto.tags.every((t) => t.kind === 'topic')).toBe(true);
    expect(dto.people).toEqual([{ id: mom.id, name: 'Mom', accentColor: '#A8D8EA' }]);

    // second item reuses the existing tag row
    await createItem(db, storage, queue, baseInput({
      id: 'itm000000002', sha256: 'd'.repeat(64), tags: ['CHRISTMAS'],
    }));
    const tagRows = await db.select().from(tags);
    expect(tagRows.filter((t) => t.name === 'christmas')).toHaveLength(1);
  });

  it('rejects unknown person ids with 400', async () => {
    await expect(
      createItem(db, storage, queue, baseInput({ people: ['p_nope'] })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('persists blurhash under settings key blurhash:<id>', async () => {
    await createItem(db, storage, queue, baseInput());
    const rows = await db.select().from(settings);
    expect(rows).toEqual([
      { key: 'blurhash:itm000000001', value: JSON.stringify('LKO2?U%2Tw=w]~RBVZRi};RPxuwH') },
    ]);
  });
});

describe('getItemDTO', () => {
  it('returns null for missing ids', async () => {
    expect(await getItemDTO(db, storage, 'nope')).toBeNull();
  });
});

describe('normalizeTagName', () => {
  it('lowercases and trims', () => {
    expect(normalizeTagName('  Christmas Morning ')).toBe('christmas morning');
  });
});
```

- [ ] Step 5.2 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: FAIL** — cannot resolve `./items`.

- [ ] Step 5.3 — Implement `src/lib/server/items.ts` (complete file as of this task; Tasks 7–8 append list/update/delete):

```ts
// Item domain: creation, DTO assembly (master Contract 6 ItemDTO), and — added
// in later tasks of this phase — list/update/soft-delete/restore.
// Runtime-portable: no node:* imports.
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  albumItems,
  albums,
  itemFiles,
  itemPeople,
  items,
  itemTags,
  people,
  settings,
  tags,
} from '$lib/server/db/schema';
import {
  displayDate,
  isValidItemDate,
  shortDate,
  sortDate as computeSortDate,
  yearOf,
  type ItemDate,
} from '$lib/domain/dates';
import { bumpYearCount } from '$lib/server/aggregates';
import { ROLE_RANK } from '$lib/server/roles';
import type { JobQueueAdapter, StorageAdapter } from '$lib/server/platform/types';
import type { ItemDTO } from '$lib/types';

type Db = App.Locals['db'];
type SessionUser = NonNullable<App.Locals['user']>;
type ItemRow = typeof items.$inferSelect;

export type { ItemDTO } from '$lib/types';

export type FileKind = 'original' | 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite';

export interface ItemFileInput {
  kind: FileKind;
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface CreateItemInput {
  id?: string;
  type: 'video' | 'photo';
  title: string | null;
  description: string | null;
  tapeLabel: string | null;
  date: ItemDate;
  duration: number | null;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  source: 'upload' | 'ingest';
  blurhash: string | null;
  files: ItemFileInput[];
  people: string[];
  tags: string[];
  uploadedBy: string;
}

const blurhashKey = (itemId: string) => `blurhash:${itemId}`;

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export function canModifyItem(user: SessionUser, row: { uploadedBy: string }): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK.editor || row.uploadedBy === user.id;
}

export async function setItemPeople(db: Db, itemId: string, personIds: string[]): Promise<void> {
  const ids = [...new Set(personIds)];
  if (ids.length) {
    const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, ids));
    if (found.length !== ids.length) throw error(400, 'unknown person id');
  }
  await db.delete(itemPeople).where(eq(itemPeople.itemId, itemId));
  if (ids.length) {
    await db
      .insert(itemPeople)
      .values(ids.map((personId) => ({ itemId, personId, source: 'manual' as const })));
  }
}

export async function setItemTags(db: Db, itemId: string, names: string[]): Promise<void> {
  const norm = [...new Set(names.map(normalizeTagName).filter((n) => n.length > 0))];
  await db.delete(itemTags).where(eq(itemTags.itemId, itemId));
  if (!norm.length) return;
  await db
    .insert(tags)
    .values(norm.map((name) => ({ id: nanoid(12), name, kind: 'topic' as const })))
    .onConflictDoNothing();
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, norm));
  await db.insert(itemTags).values(rows.map((r) => ({ itemId, tagId: r.id })));
}

export async function createItem(
  db: Db,
  storage: StorageAdapter,
  queue: JobQueueAdapter,
  input: CreateItemInput,
): Promise<ItemDTO> {
  if (!isValidItemDate(input.date)) throw error(400, 'invalid date');
  const id = input.id ?? nanoid(12);
  const sd = computeSortDate(input.date);
  const status = input.date.precision === 'unknown' ? 'needs_review' : 'ready';

  // Validate people BEFORE inserting the item row so failures leave no orphan.
  const personIds = [...new Set(input.people)];
  if (personIds.length) {
    const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, personIds));
    if (found.length !== personIds.length) throw error(400, 'unknown person id');
  }

  await db.insert(items).values({
    id,
    type: input.type,
    title: input.title,
    description: input.description,
    dateStart: input.date.dateStart,
    dateEnd: input.date.dateEnd,
    datePrecision: input.date.precision,
    sortDate: sd,
    duration: input.duration,
    width: input.width,
    height: input.height,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    source: input.source,
    tapeLabel: input.tapeLabel,
    status,
    uploadedBy: input.uploadedBy,
    createdAt: new Date(),
  });

  if (input.files.length) {
    await db.insert(itemFiles).values(
      input.files.map((f) => ({
        id: nanoid(12),
        itemId: id,
        kind: f.kind,
        storageKey: f.storageKey,
        mime: f.mime,
        width: f.width,
        height: f.height,
      })),
    );
  }

  await setItemPeople(db, id, personIds);
  await setItemTags(db, id, input.tags);

  if (input.blurhash) {
    const value = JSON.stringify(input.blurhash);
    await db
      .insert(settings)
      .values({ key: blurhashKey(id), value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  await bumpYearCount(db, yearOf(input.date), input.type, 1);

  // Phase 07 worker consumes these; queue-noop on Cloudflare. Enqueue only —
  // server-side derivative generation is explicitly out of scope here.
  await queue.enqueue('derivatives', { itemId: id });
  if (input.type === 'video') await queue.enqueue('sprite', { itemId: id });

  const dto = await getItemDTO(db, storage, id);
  if (!dto) throw error(500, 'item creation failed');
  return dto;
}

export async function buildItemDTOs(
  db: Db,
  storage: StorageAdapter,
  rows: ItemRow[],
): Promise<ItemDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const files = await db.select().from(itemFiles).where(inArray(itemFiles.itemId, ids));
  const ppl = await db
    .select({
      itemId: itemPeople.itemId,
      id: people.id,
      name: people.name,
      accentColor: people.accentColor,
    })
    .from(itemPeople)
    .innerJoin(people, eq(itemPeople.personId, people.id))
    .where(inArray(itemPeople.itemId, ids));
  const tgs = await db
    .select({ itemId: itemTags.itemId, id: tags.id, name: tags.name, kind: tags.kind })
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(inArray(itemTags.itemId, ids));
  const albs = await db
    .select({ itemId: albumItems.itemId, id: albums.id, title: albums.title })
    .from(albumItems)
    .innerJoin(albums, eq(albumItems.albumId, albums.id))
    .where(and(inArray(albumItems.itemId, ids), isNull(albums.deletedAt)));
  const blur = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, ids.map(blurhashKey)));
  const blurMap = new Map(blur.map((b) => [b.key, JSON.parse(b.value) as string]));

  const out: ItemDTO[] = [];
  for (const row of rows) {
    const date: ItemDate = {
      dateStart: row.dateStart,
      dateEnd: row.dateEnd,
      precision: row.datePrecision,
    };
    const urls: ItemDTO['urls'] = { poster: '', thumb400: '', thumb800: '', thumb1600: '' };
    for (const f of files.filter((f) => f.itemId === row.id)) {
      const url = await storage.mediaUrl(f.storageKey);
      if (f.kind === 'poster') urls.poster = url;
      else if (f.kind === 'thumb_400') urls.thumb400 = url;
      else if (f.kind === 'thumb_800') urls.thumb800 = url;
      else if (f.kind === 'thumb_1600') urls.thumb1600 = url;
      else if (f.kind === 'original') urls.original = url;
      else if (f.kind === 'sprite') urls.sprite = url;
    }
    out.push({
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      date,
      displayDate: displayDate(date),
      shortDate: shortDate(date),
      duration: row.duration,
      width: row.width,
      height: row.height,
      status: row.status,
      urls,
      blurhash: blurMap.get(blurhashKey(row.id)) ?? null,
      // people[].age is wired in phase 05 when ages.ts lands (decision 7).
      people: ppl
        .filter((p) => p.itemId === row.id)
        .map(({ itemId: _i, ...p }) => p),
      tags: tgs.filter((t) => t.itemId === row.id).map(({ itemId: _i, ...t }) => t),
      albums: albs.filter((a) => a.itemId === row.id).map(({ itemId: _i, ...a }) => a),
      uploadedBy: row.uploadedBy,
      tapeLabel: row.tapeLabel,
    });
  }
  return out;
}

export async function getItemDTO(
  db: Db,
  storage: StorageAdapter,
  id: string,
  opts?: { includeDeleted?: boolean },
): Promise<ItemDTO | null> {
  const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!rows.length) return null;
  if (rows[0].deletedAt && !opts?.includeDeleted) return null;
  return (await buildItemDTOs(db, storage, rows))[0];
}
```

- [ ] Step 5.4 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: PASS** (11 tests). Then `pnpm check` — 0 errors.
- [ ] Step 5.5 — Commit: `git add -A && git commit -m "feat: createItem with tags/people/blurhash, aggregates bump, job enqueue, master ItemDTO builder"`

---

### Task 6: Chunk assembly + `completeUpload`

**Files:**
- Modify: `src/lib/server/upload.ts` (append), `src/lib/server/upload.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 manifest/chunk helpers, Task 5 `createItem`, `fitWithin` (Task 1), `findDuplicate`/`duplicateSha` (Task 4).
- Produces (consumed by the complete route in Task 9):
  - `completeUpload(db, storage, queue, user: SessionUser, input: CompleteUploadInput): Promise<ItemDTO>`
  - `validateUploadMeta(raw: unknown): UploadMeta`
  - `concatChunks(storage, uploadId, totalChunks): ReadableStream<Uint8Array>`

**Steps:**

- [ ] Step 6.1 — Append to `src/lib/server/upload.test.ts`. First adjust imports: add `completeUpload, validateUploadMeta` to the `./upload` import; add `MemoryQueue` to the `./testing/memory-platform` import; replace the schema import line with `import { itemFiles, items, items as itemsTable } from '$lib/server/db/schema';`; add `import type { UploadMeta } from '$lib/types';` and `import { eq } from 'drizzle-orm';`. Then add this describe block at the end of the file:

```ts
describe('completeUpload', () => {
  const queue = () => new MemoryQueue();

  function meta(over: Partial<UploadMeta> = {}): UploadMeta {
    return {
      type: 'video',
      width: 192,
      height: 108,
      duration: 1.0,
      title: 'Tiny clip',
      description: null,
      tapeLabel: null,
      date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
      people: [],
      tags: [],
      ...over,
    };
  }

  const webp = (n: number) => ({ data: new Uint8Array(n).fill(7), mime: 'image/webp' });

  function derivatives() {
    return {
      poster: webp(40),
      thumb_400: webp(10),
      thumb_800: webp(20),
      thumb_1600: webp(30),
    };
  }

  async function uploadAll(bytes: Uint8Array, sha: string) {
    const u = await seedUser(db, { id: 'u_up', username: 'up' });
    const init = await initUpload(db, storage, u.id, {
      sha256: sha, sizeBytes: bytes.length, mime: 'video/mp4', filename: 'tiny.mp4',
    });
    await saveChunk(storage, init.uploadId, 0, bytes);
    return { user: u, uploadId: init.uploadId };
  }

  it('assembles chunks into media/<itemId>/original.<ext> and creates the item', async () => {
    const bytes = new Uint8Array(24).map((_, i) => i);
    const { user, uploadId } = await uploadAll(bytes, SHA);
    const q = queue();
    const dto = await completeUpload(db, storage, q, user, {
      uploadId, allowDuplicate: false, meta: meta(), blurhash: 'LKO2?U%2Tw', derivatives: derivatives(),
    });
    expect(dto.status).toBe('ready');
    expect(dto.urls.original).toBe(`/media/media/${dto.id}/original.mp4`);
    const stored = await storage.get(`media/${dto.id}/original.mp4`);
    expect(new Uint8Array(await new Response(stored!.stream).arrayBuffer())).toEqual(bytes);
    for (const k of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600']) {
      expect(await storage.head(`media/${dto.id}/${k}.webp`)).not.toBeNull();
    }
    // derivative dims recorded via fitWithin
    const t400 = (await db.select().from(itemFiles).where(eq(itemFiles.itemId, dto.id)))
      .find((f) => f.kind === 'thumb_400');
    expect([t400!.width, t400!.height]).toEqual([192, 108]); // source smaller than 400: no upscale
    // tmp area cleaned
    expect(await storage.head(`tmp/${uploadId}/manifest.json`)).toBeNull();
    expect(await storage.head(`tmp/${uploadId}/0`)).toBeNull();
    expect(q.enqueued.map((j) => j.kind)).toEqual(['derivatives', 'sprite']);
  });

  it('multi-chunk assembly preserves byte order (manifest-driven chunk size)', async () => {
    // Hand-craft a tiny manifest so the test does not allocate 8 MiB buffers.
    const user = await seedUser(db, { id: 'u_mc', username: 'mc' });
    const m = {
      sha256: SHA_B, sizeBytes: 10, mime: 'video/mp4', filename: 't.mp4',
      chunkSize: 4, totalChunks: 3, createdBy: user.id, createdAt: new Date().toISOString(),
    };
    await storage.put(`tmp/${SHA_B}/manifest.json`, new TextEncoder().encode(JSON.stringify(m)), { contentType: 'application/json' });
    await saveChunk(storage, SHA_B, 0, new Uint8Array([0, 1, 2, 3]));
    await saveChunk(storage, SHA_B, 1, new Uint8Array([4, 5, 6, 7]));
    await saveChunk(storage, SHA_B, 2, new Uint8Array([8, 9]));
    const dto = await completeUpload(db, storage, queue(), user, {
      uploadId: SHA_B, allowDuplicate: false, meta: meta(), blurhash: null, derivatives: derivatives(),
    });
    const stored = await storage.get(`media/${dto.id}/original.mp4`);
    expect(new Uint8Array(await new Response(stored!.stream).arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
  });

  it('409s when chunks are missing', async () => {
    const user = await seedUser(db, { id: 'u_ms', username: 'ms' });
    await initUpload(db, storage, user.id, { sha256: SHA, sizeBytes: 20, mime: 'video/mp4', filename: 'c.mp4' });
    await expect(
      completeUpload(db, storage, queue(), user, {
        uploadId: SHA, allowDuplicate: false, meta: meta(), blurhash: null, derivatives: derivatives(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('409s on duplicate unless allowDuplicate, then stores a #dup sha', async () => {
    const bytes = new Uint8Array(24).fill(1);
    const { user, uploadId } = await uploadAll(bytes, SHA);
    const first = await completeUpload(db, storage, queue(), user, {
      uploadId, allowDuplicate: false, meta: meta(), blurhash: null, derivatives: derivatives(),
    });
    // same content again
    const init2 = await initUpload(db, storage, user.id, {
      sha256: SHA, sizeBytes: bytes.length, mime: 'video/mp4', filename: 'tiny.mp4',
    });
    expect(init2.duplicateItemId).toBe(first.id);
    await saveChunk(storage, uploadId, 0, bytes);
    await expect(
      completeUpload(db, storage, queue(), user, {
        uploadId, allowDuplicate: false, meta: meta(), blurhash: null, derivatives: derivatives(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const second = await completeUpload(db, storage, queue(), user, {
      uploadId, allowDuplicate: true, meta: meta(), blurhash: null, derivatives: derivatives(),
    });
    const row = (await db.select().from(itemsTable).where(eq(itemsTable.id, second.id)))[0];
    expect(row.sha256.startsWith(`${SHA}#dup-`)).toBe(true);
  });

  it('rejects meta whose type contradicts the uploaded mime', async () => {
    const bytes = new Uint8Array(8).fill(2);
    const { user, uploadId } = await uploadAll(bytes, SHA);
    await expect(
      completeUpload(db, storage, queue(), user, {
        uploadId, allowDuplicate: false, meta: meta({ type: 'photo' }), blurhash: null, derivatives: derivatives(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('validateUploadMeta', () => {
  const good = {
    type: 'photo', width: 640, height: 480, duration: null,
    title: ' Hello ', description: null, tapeLabel: null,
    date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
    people: [], tags: ['xmas'],
  };
  it('normalizes strings and passes valid meta', () => {
    const m = validateUploadMeta(good);
    expect(m.title).toBe('Hello');
    expect(m.tags).toEqual(['xmas']);
  });
  it('rejects invalid payloads with 400', () => {
    for (const bad of [
      null,
      { ...good, type: 'gif' },
      { ...good, width: 0 },
      { ...good, height: -5 },
      { ...good, duration: -1 },
      { ...good, date: { dateStart: '1994-06-14', dateEnd: '1994-06-15', precision: 'day' } },
      { ...good, date: undefined },
    ]) {
      expect(() => validateUploadMeta(bad)).toThrow();
    }
  });
});
```

- [ ] Step 6.2 — Run `pnpm vitest run src/lib/server/upload.test.ts`. **Expected: FAIL** — `completeUpload`/`validateUploadMeta` are not exported.

- [ ] Step 6.3 — Append to `src/lib/server/upload.ts`. Add these imports at the top of the file: `import { nanoid } from 'nanoid';`, `import { fitWithin } from '$lib/domain/dims';`, `import { isValidItemDate, type ItemDate } from '$lib/domain/dates';`, `import { duplicateSha } from '$lib/server/dedupe';` (extend the existing dedupe import), `import { createItem, type ItemFileInput } from '$lib/server/items';`, `import type { JobQueueAdapter } from '$lib/server/platform/types';`, `import type { ItemDTO, UploadMeta } from '$lib/types';`. Then append:

```ts
type SessionUser = NonNullable<App.Locals['user']>;

export interface DerivativeBlob {
  data: Uint8Array;
  mime: string;
}

export interface CompleteUploadInput {
  uploadId: string;
  allowDuplicate: boolean;
  meta: UploadMeta;
  blurhash: string | null;
  derivatives: Record<'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600', DerivativeBlob>;
}

/** Sequentially replays stored chunks as one stream (no full-file buffering). */
export function concatChunks(
  storage: StorageAdapter,
  uploadId: string,
  totalChunks: number,
): ReadableStream<Uint8Array> {
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (index >= totalChunks) {
            controller.close();
            return;
          }
          const got = await storage.get(chunkKey(uploadId, index));
          if (!got) throw new Error(`chunk ${index} disappeared during assembly`);
          reader = got.stream.getReader();
          index++;
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        controller.enqueue(value);
        return;
      }
    },
  });
}

/** Validates the JSON `meta` multipart field. Throws SvelteKit error(400). */
export function validateUploadMeta(raw: unknown): UploadMeta {
  if (typeof raw !== 'object' || raw === null) throw error(400, 'invalid meta');
  const m = raw as Record<string, unknown>;
  if (m.type !== 'video' && m.type !== 'photo') throw error(400, 'meta.type must be video|photo');
  if (!Number.isInteger(m.width) || (m.width as number) <= 0) throw error(400, 'meta.width invalid');
  if (!Number.isInteger(m.height) || (m.height as number) <= 0) throw error(400, 'meta.height invalid');
  const duration =
    m.duration === null || m.duration === undefined ? null : Number(m.duration);
  if (duration !== null && !(Number.isFinite(duration) && duration > 0)) {
    throw error(400, 'meta.duration invalid');
  }
  const date = m.date as ItemDate | undefined;
  if (!date || !isValidItemDate(date)) throw error(400, 'meta.date invalid');
  const strOrNull = (v: unknown) =>
    typeof v === 'string' && v.trim().length ? v.trim() : null;
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    type: m.type,
    width: m.width as number,
    height: m.height as number,
    duration,
    title: strOrNull(m.title),
    description: strOrNull(m.description),
    tapeLabel: strOrNull(m.tapeLabel),
    date: { dateStart: date.dateStart, dateEnd: date.dateEnd, precision: date.precision },
    people: strArr(m.people),
    tags: strArr(m.tags),
  };
}

export async function completeUpload(
  db: Db,
  storage: StorageAdapter,
  queue: JobQueueAdapter,
  user: SessionUser,
  input: CompleteUploadInput,
): Promise<ItemDTO> {
  const manifest = await readManifest(storage, input.uploadId);

  const missing: number[] = [];
  for (let i = 0; i < manifest.totalChunks; i++) {
    const h = await storage.head(chunkKey(input.uploadId, i));
    if (!h || h.size !== expectedChunkSize(manifest.sizeBytes, i, manifest.chunkSize)) {
      missing.push(i);
    }
  }
  if (missing.length) throw error(409, `missing chunks: ${missing.join(',')}`);

  const dup = await findDuplicate(db, manifest.sha256);
  if (dup && !input.allowDuplicate) {
    throw error(409, `duplicate of item ${dup.itemId}`);
  }
  const sha = dup ? duplicateSha(manifest.sha256, nanoid(6)) : manifest.sha256;

  const kind = ALLOWED_MIME[manifest.mime];
  if (!kind) throw error(400, `unsupported mime: ${manifest.mime}`);
  if (input.meta.type !== kind.type) {
    throw error(400, `meta.type '${input.meta.type}' does not match uploaded mime '${manifest.mime}'`);
  }

  const itemId = nanoid(12);
  const originalKey = `media/${itemId}/original.${kind.ext}`;
  await storage.put(originalKey, concatChunks(storage, input.uploadId, manifest.totalChunks), {
    contentType: manifest.mime,
    sizeHint: manifest.sizeBytes,
  });

  const files: ItemFileInput[] = [
    {
      kind: 'original',
      storageKey: originalKey,
      mime: manifest.mime,
      width: input.meta.width,
      height: input.meta.height,
    },
  ];
  const DERIVS = [
    { field: 'poster', max: null },
    { field: 'thumb_400', max: 400 },
    { field: 'thumb_800', max: 800 },
    { field: 'thumb_1600', max: 1600 },
  ] as const;
  for (const d of DERIVS) {
    const blob = input.derivatives[d.field];
    const key = `media/${itemId}/${d.field}.webp`;
    await storage.put(key, blob.data, { contentType: blob.mime, sizeHint: blob.data.byteLength });
    const dims =
      d.max === null
        ? { width: input.meta.width, height: input.meta.height }
        : fitWithin(input.meta.width, input.meta.height, d.max);
    files.push({ kind: d.field, storageKey: key, mime: blob.mime, width: dims.width, height: dims.height });
  }

  const dto = await createItem(db, storage, queue, {
    id: itemId,
    type: input.meta.type,
    title: input.meta.title,
    description: input.meta.description,
    tapeLabel: input.meta.tapeLabel,
    date: input.meta.date,
    duration: input.meta.duration,
    width: input.meta.width,
    height: input.meta.height,
    sizeBytes: manifest.sizeBytes,
    sha256: sha,
    source: 'upload',
    blurhash: input.blurhash,
    files,
    people: input.meta.people,
    tags: input.meta.tags,
    uploadedBy: user.id,
  });

  for (let i = 0; i < manifest.totalChunks; i++) {
    await storage.delete(chunkKey(input.uploadId, i));
  }
  await storage.delete(`tmp/${input.uploadId}/manifest.json`);

  return dto;
}
```

- [ ] Step 6.4 — Run `pnpm vitest run src/lib/server/upload.test.ts`. **Expected: PASS** (15 tests). Then `pnpm check` — 0 errors.
- [ ] Step 6.5 — Commit: `git add -A && git commit -m "feat: upload completion — streamed chunk assembly, derivative storage, dedupe override, item creation"`

---

### Task 7: `listItems` with filters + cursor pagination

**Files:**
- Modify: `src/lib/server/items.ts` (append), `src/lib/server/items.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 `buildItemDTOs`; Contract 6 GET `/api/items` param list (`year, month, people (csv), tags, type, album, status, q, cursor, limit≤100`).
- Produces (consumed by the items route in Task 10, phase 03 timeline grid, phase 04 prev/next context):
  - `listItems(db, storage, query: ListItemsQuery): Promise<{ items: ItemDTO[]; nextCursor: string | null }>`
  - `encodeCursor({ s, id })` / `decodeCursor(cursor)` (exported for tests)

**Steps:**

- [ ] Step 7.1 — Append to `src/lib/server/items.test.ts` (extend the first import line with `listItems, decodeCursor, encodeCursor` and add `albums as albumsTable, albumItems as albumItemsTable` to the schema import), then add:

```ts
describe('listItems', () => {
  async function seedSix() {
    const mom = await seedPerson(db, { id: 'p_mom', name: 'Mom' });
    const dad = await seedPerson(db, { id: 'p_dad', name: 'Dad' });
    // NOTE: title defaults to null here so the q-filter test matches exactly one item.
    const mk = (id: string, over: Parameters<typeof baseInput>[0]) =>
      createItem(db, storage, queue, baseInput({ id, sha256: id.padEnd(64, '0'), title: null, ...over }));
    await mk('itm_a1', { date: { dateStart: '1988-07-04', dateEnd: '1988-07-04', precision: 'day' }, type: 'photo', duration: null, tags: ['fireworks'] });
    await mk('itm_a2', { date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' }, people: [mom.id], title: 'Sprinkler day' });
    await mk('itm_a3', { date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' }, people: [mom.id, dad.id] });
    await mk('itm_a4', { date: { dateStart: '1994-12-01', dateEnd: '1994-12-31', precision: 'month' }, tags: ['christmas'] });
    await mk('itm_a5', { date: { dateStart: null, dateEnd: null, precision: 'unknown' } });
    await mk('itm_a6', { date: { dateStart: null, dateEnd: null, precision: 'unknown' } });
    return { mom, dad };
  }

  it('orders by sortDate asc, undated last, and paginates with a stable cursor', async () => {
    await seedSix();
    const page1 = await listItems(db, storage, { limit: 3 });
    expect(page1.items.map((i) => i.id)).toEqual(['itm_a1', 'itm_a2', 'itm_a3']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listItems(db, storage, { limit: 3, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(['itm_a4', 'itm_a5', 'itm_a6']);
    expect(page2.nextCursor).toBeNull();
  });

  it('filters by year, month, type, status, people (AND), tags, q', async () => {
    const { mom, dad } = await seedSix();
    expect((await listItems(db, storage, { year: 1994 })).items).toHaveLength(3);
    expect((await listItems(db, storage, { year: 1994, month: 6 })).items).toHaveLength(2);
    expect((await listItems(db, storage, { type: 'photo' })).items.map((i) => i.id)).toEqual(['itm_a1']);
    expect((await listItems(db, storage, { status: 'needs_review' })).items).toHaveLength(2);
    expect((await listItems(db, storage, { people: [mom.id] })).items).toHaveLength(2);
    expect((await listItems(db, storage, { people: [mom.id, dad.id] })).items.map((i) => i.id)).toEqual(['itm_a3']);
    expect((await listItems(db, storage, { tags: ['Christmas'] })).items.map((i) => i.id)).toEqual(['itm_a4']);
    expect((await listItems(db, storage, { q: 'sprinkler' })).items.map((i) => i.id)).toEqual(['itm_a2']);
  });

  it('filters by album membership', async () => {
    await seedSix();
    await db.insert(albumsTable).values({ id: 'alb1', title: 'Summer', createdBy: userId, createdAt: new Date() });
    await db.insert(albumItemsTable).values({ albumId: 'alb1', itemId: 'itm_a2', position: 0 });
    expect((await listItems(db, storage, { album: 'alb1' })).items.map((i) => i.id)).toEqual(['itm_a2']);
  });

  it('clamps limit to 100', async () => {
    await seedSix();
    const res = await listItems(db, storage, { limit: 5000 });
    expect(res.items).toHaveLength(6);
  });

  it('cursor survives encode/decode roundtrip including null sortDate', () => {
    for (const c of [{ s: '1994-06-14', id: 'itm_a2' }, { s: null, id: 'itm_a5' }]) {
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    }
  });
});
```

- [ ] Step 7.2 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: FAIL** — `listItems` not exported.

- [ ] Step 7.3 — Append to `src/lib/server/items.ts` (extend the drizzle import with `asc, sql` and `type SQL`):

```ts
export interface ListItemsQuery {
  year?: number;
  month?: number;
  people?: string[]; // person ids, AND-combined (decision 13)
  tags?: string[];   // tag names, AND-combined
  type?: 'video' | 'photo';
  album?: string;
  status?: 'processing' | 'needs_review' | 'ready';
  q?: string;        // LIKE match until phase 06 swaps in FTS (decision 5)
  cursor?: string;
  limit?: number;
}

// Cursor: base64url(JSON {s: sortDate|null, id}) — decision 6. btoa/atob exist
// in both Node ≥ 22 and Workers; payload is pure ASCII.
export function encodeCursor(c: { s: string | null; id: string }): string {
  return btoa(JSON.stringify(c)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string): { s: string | null; id: string } {
  try {
    const parsed = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))) as {
      s: string | null;
      id: string;
    };
    if (typeof parsed.id !== 'string' || (parsed.s !== null && typeof parsed.s !== 'string')) {
      throw new Error('bad cursor');
    }
    return parsed;
  } catch {
    throw error(400, 'invalid cursor');
  }
}

export async function listItems(
  db: Db,
  storage: StorageAdapter,
  query: ListItemsQuery,
): Promise<{ items: ItemDTO[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const conds: SQL[] = [isNull(items.deletedAt) as SQL];
  if (query.type) conds.push(eq(items.type, query.type) as SQL);
  if (query.status) conds.push(eq(items.status, query.status) as SQL);
  if (query.year !== undefined) {
    conds.push(sql`substr(${items.sortDate}, 1, 4) = ${String(query.year).padStart(4, '0')}`);
  }
  if (query.month !== undefined) {
    conds.push(sql`substr(${items.sortDate}, 6, 2) = ${String(query.month).padStart(2, '0')}`);
  }
  if (query.q) {
    const pat = `%${query.q}%`;
    conds.push(sql`(${items.title} LIKE ${pat} OR ${items.description} LIKE ${pat})`);
  }
  if (query.album) {
    conds.push(sql`${items.id} IN (SELECT item_id FROM album_items WHERE album_id = ${query.album})`);
  }
  for (const pid of query.people ?? []) {
    conds.push(sql`${items.id} IN (SELECT item_id FROM item_people WHERE person_id = ${pid})`);
  }
  for (const name of (query.tags ?? []).map(normalizeTagName)) {
    conds.push(
      sql`${items.id} IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE t.name = ${name})`,
    );
  }
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    if (c.s === null) {
      conds.push(sql`${items.sortDate} IS NULL AND ${items.id} > ${c.id}`);
    } else {
      conds.push(
        sql`(${items.sortDate} > ${c.s} OR (${items.sortDate} = ${c.s} AND ${items.id} > ${c.id}) OR ${items.sortDate} IS NULL)`,
      );
    }
  }

  const rows = await db
    .select()
    .from(items)
    .where(and(...conds))
    .orderBy(sql`${items.sortDate} IS NULL`, asc(items.sortDate), asc(items.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit ? encodeCursor({ s: last.sortDate, id: last.id }) : null;
  return { items: await buildItemDTOs(db, storage, page), nextCursor };
}
```

- [ ] Step 7.4 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: PASS** (17 tests).
- [ ] Step 7.5 — Commit: `git add -A && git commit -m "feat: item listing with year/month/people/tags/type/album/status/q filters and keyset cursor"`

---

### Task 8: Item update, soft delete, restore

**Files:**
- Modify: `src/lib/server/items.ts` (append), `src/lib/server/items.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 helpers, `bumpYearCount`, `canModifyItem` (uploader-own / editor-any rule per Contract 6 role column).
- Produces (consumed by `[id]` route in Task 10, phase 08 admin trash):
  - `updateItem(db, storage, user, id, patch: UpdateItemInput): Promise<ItemDTO>`
  - `softDeleteItem(db, user, id): Promise<{ ok: true }>`
  - `restoreItem(db, storage, id): Promise<ItemDTO>` (role gate lives in the route: editor+)

**Steps:**

- [ ] Step 8.1 — Append to `src/lib/server/items.test.ts` (extend the `./items` import with `restoreItem, softDeleteItem, updateItem`):

```ts
describe('update / soft delete / restore', () => {
  it('uploader edits own item; other uploaders 403; editors edit any', async () => {
    const owner = await seedUser(db, { id: 'u_owner2', role: 'uploader' });
    const other = await seedUser(db, { id: 'u_other', role: 'uploader' });
    const editor = await seedUser(db, { id: 'u_editor', role: 'editor' });
    const dto = await createItem(db, storage, queue, baseInput({ id: 'itm_perm', sha256: 'e'.repeat(64), uploadedBy: owner.id }));
    await expect(updateItem(db, storage, other, dto.id, { title: 'nope' })).rejects.toMatchObject({ status: 403 });
    expect((await updateItem(db, storage, owner, dto.id, { title: 'mine' })).title).toBe('mine');
    expect((await updateItem(db, storage, editor, dto.id, { title: 'edited' })).title).toBe('edited');
  });

  it('date change recomputes sortDate/status and moves year_counts', async () => {
    const user = await seedUser(db, { id: 'u_dc', role: 'editor' });
    const dto = await createItem(db, storage, queue, baseInput({ id: 'itm_date', sha256: 'f'.repeat(64), uploadedBy: user.id, date: { dateStart: null, dateEnd: null, precision: 'unknown' } }));
    expect(dto.status).toBe('needs_review');
    const updated = await updateItem(db, storage, user, dto.id, {
      date: { dateStart: '1988-01-01', dateEnd: '1988-12-31', precision: 'year' },
    });
    expect(updated.status).toBe('ready');
    expect(updated.shortDate).toBe('c. 1988');
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1988, type: 'video', count: 1 }]);
    const cleared = await updateItem(db, storage, user, dto.id, {
      date: { dateStart: null, dateEnd: null, precision: 'unknown' },
    });
    expect(cleared.status).toBe('needs_review');
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1988, type: 'video', count: 0 }]);
  });

  it('replaces people and tags when provided', async () => {
    const user = await seedUser(db, { id: 'u_pt', role: 'editor' });
    const mom = await seedPerson(db, { id: 'p_mom2', name: 'Mom' });
    const dto = await createItem(db, storage, queue, baseInput({ id: 'itm_pt', sha256: '1'.repeat(64), uploadedBy: user.id, tags: ['old'] }));
    const updated = await updateItem(db, storage, user, dto.id, { people: [mom.id], tags: ['new'] });
    expect(updated.people.map((p) => p.id)).toEqual([mom.id]);
    expect(updated.tags.map((t) => t.name)).toEqual(['new']);
  });

  it('soft delete hides from list/get, bumps counts; restore brings it back', async () => {
    const user = await seedUser(db, { id: 'u_del', role: 'uploader' });
    const dto = await createItem(db, storage, queue, baseInput({ id: 'itm_del', sha256: '2'.repeat(64), uploadedBy: user.id }));
    expect(await softDeleteItem(db, user, dto.id)).toEqual({ ok: true });
    expect(await getItemDTO(db, storage, dto.id)).toBeNull();
    expect((await listItems(db, storage, {})).items).toHaveLength(0);
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 0 }]);
    await expect(softDeleteItem(db, user, dto.id)).rejects.toMatchObject({ status: 404 });
    const restored = await restoreItem(db, storage, dto.id);
    expect(restored.id).toBe(dto.id);
    expect(await db.select().from(yearCounts)).toEqual([{ year: 1994, type: 'video', count: 1 }]);
    await expect(restoreItem(db, storage, dto.id)).rejects.toMatchObject({ status: 404 });
  });

  it('delete requires ownership or editor', async () => {
    const owner = await seedUser(db, { id: 'u_do', role: 'uploader' });
    const other = await seedUser(db, { id: 'u_dx', role: 'uploader' });
    const dto = await createItem(db, storage, queue, baseInput({ id: 'itm_dp', sha256: '3'.repeat(64), uploadedBy: owner.id }));
    await expect(softDeleteItem(db, other, dto.id)).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] Step 8.2 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: FAIL** — `updateItem` not exported.

- [ ] Step 8.3 — Append to `src/lib/server/items.ts`:

```ts
export interface UpdateItemInput {
  title?: string | null;
  description?: string | null;
  tapeLabel?: string | null;
  date?: ItemDate;
  people?: string[];
  tags?: string[];
}

async function getLiveRow(db: Db, id: string): Promise<ItemRow> {
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)))
    .limit(1);
  if (!rows.length) throw error(404, 'item not found');
  return rows[0];
}

export async function updateItem(
  db: Db,
  storage: StorageAdapter,
  user: SessionUser,
  id: string,
  patch: UpdateItemInput,
): Promise<ItemDTO> {
  const row = await getLiveRow(db, id);
  if (!canModifyItem(user, row)) throw error(403, 'not allowed to modify this item');

  const set: Partial<typeof items.$inferInsert> = {};
  if ('title' in patch) set.title = patch.title ?? null;
  if ('description' in patch) set.description = patch.description ?? null;
  if ('tapeLabel' in patch) set.tapeLabel = patch.tapeLabel ?? null;

  if (patch.date !== undefined) {
    if (!isValidItemDate(patch.date)) throw error(400, 'invalid date');
    const newSort = computeSortDate(patch.date);
    set.dateStart = patch.date.dateStart;
    set.dateEnd = patch.date.dateEnd;
    set.datePrecision = patch.date.precision;
    set.sortDate = newSort;
    if (row.status !== 'processing') {
      set.status = patch.date.precision === 'unknown' ? 'needs_review' : 'ready';
    }
    const oldYear = row.sortDate ? Number(row.sortDate.slice(0, 4)) : null;
    const newYear = yearOf(patch.date);
    if (oldYear !== newYear) {
      await bumpYearCount(db, oldYear, row.type, -1);
      await bumpYearCount(db, newYear, row.type, 1);
    }
  }

  if (Object.keys(set).length) {
    await db.update(items).set(set).where(eq(items.id, id));
  }
  if (patch.people !== undefined) await setItemPeople(db, id, patch.people);
  if (patch.tags !== undefined) await setItemTags(db, id, patch.tags);

  const dto = await getItemDTO(db, storage, id);
  if (!dto) throw error(500, 'update failed');
  return dto;
}

export async function softDeleteItem(
  db: Db,
  user: SessionUser,
  id: string,
): Promise<{ ok: true }> {
  const row = await getLiveRow(db, id);
  if (!canModifyItem(user, row)) throw error(403, 'not allowed to delete this item');
  await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, id));
  const year = row.sortDate ? Number(row.sortDate.slice(0, 4)) : null;
  await bumpYearCount(db, year, row.type, -1);
  return { ok: true };
}

/** Role gate (editor+) is enforced by the route via requireRole. */
export async function restoreItem(db: Db, storage: StorageAdapter, id: string): Promise<ItemDTO> {
  const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!rows.length || rows[0].deletedAt === null) throw error(404, 'item not in trash');
  await db.update(items).set({ deletedAt: null }).where(eq(items.id, id));
  const year = rows[0].sortDate ? Number(rows[0].sortDate.slice(0, 4)) : null;
  await bumpYearCount(db, year, rows[0].type, 1);
  const dto = await getItemDTO(db, storage, id);
  if (!dto) throw error(500, 'restore failed');
  return dto;
}
```

- [ ] Step 8.4 — Run `pnpm vitest run src/lib/server/items.test.ts`. **Expected: PASS** (22 tests). Then `pnpm check` — 0 errors.
- [ ] Step 8.5 — Commit: `git add -A && git commit -m "feat: item update/soft-delete/restore with permission rules and aggregate maintenance"`

---

### Task 9: Upload API routes (`/api/upload/init`, `/chunk`, `/complete`)

**Files:**
- Create: `src/routes/api/upload/init/+server.ts`, `src/routes/api/upload/init/init.test.ts`, `src/routes/api/upload/chunk/+server.ts`, `src/routes/api/upload/chunk/chunk.test.ts`, `src/routes/api/upload/complete/+server.ts`, `src/routes/api/upload/complete/complete.test.ts`

**Interfaces:**
- Consumes: `requireRole(locals, min): SessionUser` (Contract 3), Tasks 4/6 upload functions, `makeLocals` (Task 2).
- Produces: the three HTTP endpoints exactly per master Contract 6 (roles: uploader): `POST /api/upload/init { sha256, sizeBytes, mime, filename } → { uploadId, duplicateItemId?, chunkSize, … }`; `PUT /api/upload/chunk?uploadId&index` raw body; `POST /api/upload/complete` multipart fields `poster, thumb_400, thumb_800, thumb_1600, blurhash, meta` (+ `uploadId`, `allowDuplicate`) → `{ item: ItemDTO }`.

**Steps:**

- [ ] Step 9.1 — Write failing test `src/routes/api/upload/init/init.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals } from '$lib/server/testing/memory-platform';

type Db = App.Locals['db'];
let db: Db;

beforeEach(() => {
  db = memoryDb();
});

function call(locals: App.Locals, body: unknown) {
  const request = new Request('http://test/api/upload/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST({ locals, request } as unknown as Parameters<typeof POST>[0]);
}

const good = { sha256: 'a'.repeat(64), sizeBytes: 10, mime: 'video/mp4', filename: 't.mp4' };

describe('POST /api/upload/init', () => {
  it('401 when logged out, 403 for viewer role', async () => {
    await expect(call(makeLocals(db, null).locals, good)).rejects.toMatchObject({ status: 401 });
    const viewer = await seedUser(db, { role: 'user' });
    await expect(call(makeLocals(db, viewer).locals, good)).rejects.toMatchObject({ status: 403 });
  });

  it('uploader gets an upload plan', async () => {
    const up = await seedUser(db, { role: 'uploader' });
    const res = await call(makeLocals(db, up).locals, good);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      uploadId: 'a'.repeat(64),
      chunkSize: 8 * 1024 * 1024,
      totalChunks: 1,
      receivedChunks: [],
      duplicateItemId: null,
    });
  });
});
```

- [ ] Step 9.2 — Run `pnpm vitest run src/routes/api/upload/init`. **Expected: FAIL** — `./+server` missing. (Route tests import handlers that reference `./$types`; those are generated by `pnpm check` / `svelte-kit sync` — run `pnpm check` first if Vitest ever reports `Cannot find module './$types'`. Phase 01's Vitest config already runs through the `sveltekit()` Vite plugin, which resolves them.)

- [ ] Step 9.3 — Implement `src/routes/api/upload/init/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { initUpload, type InitUploadInput } from '$lib/server/upload';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireRole(locals, 'uploader');
  let body: InitUploadInput;
  try {
    body = (await request.json()) as InitUploadInput;
  } catch {
    throw error(400, 'invalid JSON body');
  }
  return json(await initUpload(locals.db, locals.platform.storage, user.id, body));
};
```

- [ ] Step 9.4 — Write failing test `src/routes/api/upload/chunk/chunk.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PUT } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals, MemoryStorage } from '$lib/server/testing/memory-platform';
import { initUpload } from '$lib/server/upload';

type Db = App.Locals['db'];
let db: Db;
let storage: MemoryStorage;

beforeEach(() => {
  db = memoryDb();
  storage = new MemoryStorage();
});

function call(locals: App.Locals, qs: string, bytes: Uint8Array) {
  const url = new URL(`http://test/api/upload/chunk${qs}`);
  const request = new Request(url, { method: 'PUT', body: bytes });
  return PUT({ locals, request, url } as unknown as Parameters<typeof PUT>[0]);
}

describe('PUT /api/upload/chunk', () => {
  it('requires uploader role and query params', async () => {
    await expect(call(makeLocals(db, null, storage).locals, '?uploadId=x&index=0', new Uint8Array(1)))
      .rejects.toMatchObject({ status: 401 });
    const up = await seedUser(db);
    const { locals } = makeLocals(db, up, storage);
    await expect(call(locals, '', new Uint8Array(1))).rejects.toMatchObject({ status: 400 });
    await expect(call(locals, '?uploadId=abc&index=zero', new Uint8Array(1))).rejects.toMatchObject({ status: 400 });
  });

  it('stores a valid chunk', async () => {
    const up = await seedUser(db);
    const { locals } = makeLocals(db, up, storage);
    const sha = 'b'.repeat(64);
    await initUpload(db, storage, up.id, { sha256: sha, sizeBytes: 4, mime: 'video/mp4', filename: 't.mp4' });
    const res = await call(locals, `?uploadId=${sha}&index=0`, new Uint8Array([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect((await storage.head(`tmp/${sha}/0`))!.size).toBe(4);
  });
});
```

- [ ] Step 9.5 — Run `pnpm vitest run src/routes/api/upload/chunk`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 9.6 — Implement `src/routes/api/upload/chunk/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { saveChunk } from '$lib/server/upload';

export const PUT: RequestHandler = async ({ locals, request, url }) => {
  requireRole(locals, 'uploader');
  const uploadId = url.searchParams.get('uploadId');
  const indexRaw = url.searchParams.get('index');
  if (!uploadId || indexRaw === null) throw error(400, 'uploadId and index query params required');
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0) throw error(400, 'index must be a non-negative integer');
  const data = new Uint8Array(await request.arrayBuffer());
  return json(await saveChunk(locals.platform.storage, uploadId, index, data));
};
```

- [ ] Step 9.7 — Write failing test `src/routes/api/upload/complete/complete.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals, MemoryStorage } from '$lib/server/testing/memory-platform';
import { initUpload, saveChunk } from '$lib/server/upload';

type Db = App.Locals['db'];
let db: Db;
let storage: MemoryStorage;

beforeEach(() => {
  db = memoryDb();
  storage = new MemoryStorage();
});

function formRequest(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') fd.set(k, v);
    else fd.set(k, v, `${k}.webp`);
  }
  return new Request('http://test/api/upload/complete', { method: 'POST', body: fd });
}

const metaJson = JSON.stringify({
  type: 'video', width: 192, height: 108, duration: 1,
  title: 'Clip', description: null, tapeLabel: null,
  date: { dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' },
  people: [], tags: ['summer'],
});

describe('POST /api/upload/complete', () => {
  it('creates the item from multipart fields', async () => {
    const up = await seedUser(db);
    const { locals, queue } = makeLocals(db, up, storage);
    const sha = 'c'.repeat(64);
    await initUpload(db, storage, up.id, { sha256: sha, sizeBytes: 6, mime: 'video/mp4', filename: 't.mp4' });
    await saveChunk(storage, sha, 0, new Uint8Array([1, 2, 3, 4, 5, 6]));
    const blob = new Blob([new Uint8Array(10).fill(3)], { type: 'image/webp' });
    const request = formRequest({
      uploadId: sha, allowDuplicate: 'false', meta: metaJson, blurhash: 'LKO2?U',
      poster: blob, thumb_400: blob, thumb_800: blob, thumb_1600: blob,
    });
    const res = await POST({ locals, request } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item.shortDate).toBe('c. 1994');
    expect(item.tags.map((t: { name: string }) => t.name)).toEqual(['summer']);
    expect(item.blurhash).toBe('LKO2?U');
    expect(queue.enqueued.map((j) => j.kind)).toEqual(['derivatives', 'sprite']);
  });

  it('400s on missing derivative fields or meta', async () => {
    const up = await seedUser(db);
    const { locals } = makeLocals(db, up, storage);
    await expect(
      POST({ locals, request: formRequest({ uploadId: 'x' }) } as unknown as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] Step 9.8 — Run `pnpm vitest run src/routes/api/upload/complete`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 9.9 — Implement `src/routes/api/upload/complete/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import {
  completeUpload,
  validateUploadMeta,
  type CompleteUploadInput,
  type DerivativeBlob,
} from '$lib/server/upload';

const DERIVATIVE_FIELDS = ['poster', 'thumb_400', 'thumb_800', 'thumb_1600'] as const;

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireRole(locals, 'uploader');
  const fd = await request.formData();

  const uploadId = fd.get('uploadId');
  if (typeof uploadId !== 'string' || !uploadId) throw error(400, 'missing uploadId');
  const allowDuplicate = fd.get('allowDuplicate') === 'true';

  const metaRaw = fd.get('meta');
  if (typeof metaRaw !== 'string') throw error(400, 'missing meta');
  let metaParsed: unknown;
  try {
    metaParsed = JSON.parse(metaRaw);
  } catch {
    throw error(400, 'meta is not valid JSON');
  }
  const meta = validateUploadMeta(metaParsed);

  const blurhashRaw = fd.get('blurhash');
  const blurhash = typeof blurhashRaw === 'string' && blurhashRaw.length > 0 ? blurhashRaw : null;

  const derivatives = {} as CompleteUploadInput['derivatives'];
  for (const field of DERIVATIVE_FIELDS) {
    const f = fd.get(field);
    if (!(f instanceof File)) throw error(400, `missing derivative field: ${field}`);
    const blob: DerivativeBlob = {
      data: new Uint8Array(await f.arrayBuffer()),
      mime: f.type || 'image/webp',
    };
    derivatives[field] = blob;
  }

  const item = await completeUpload(locals.db, locals.platform.storage, locals.platform.queue, user, {
    uploadId,
    allowDuplicate,
    meta,
    blurhash,
    derivatives,
  });
  return json({ item }, { status: 201 });
};
```

- [ ] Step 9.10 — Run `pnpm vitest run src/routes/api/upload`. **Expected: PASS** (7 tests across the three files). Then `pnpm check` — 0 errors.
- [ ] Step 9.11 — Commit: `git add -A && git commit -m "feat: upload API routes (init/chunk/complete) with role gates"`

---

### Task 10: Items API routes (`/api/items`, `/api/items/[id]`)

**Files:**
- Create: `src/routes/api/items/+server.ts`, `src/routes/api/items/items-route.test.ts`, `src/routes/api/items/[id]/+server.ts`, `src/routes/api/items/[id]/item-route.test.ts`

**Interfaces:**
- Consumes: Tasks 5/7/8 item functions; `requireRole`.
- Produces (Contract 6 rows): `GET /api/items` (role user) → `{ items: ItemDTO[], nextCursor }`; `POST /api/items` (uploader) — JSON creation primitive (decision 4); `GET/PATCH/DELETE /api/items/[id]` (user read / uploader-own / editor-any); `POST /api/items/[id] {action:'restore'}` (editor+, decision 14).

**Steps:**

- [ ] Step 10.1 — Write failing test `src/routes/api/items/items-route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals, MemoryStorage } from '$lib/server/testing/memory-platform';
import { createItem } from '$lib/server/items';
import type { CreateItemInput } from '$lib/server/items';

type Db = App.Locals['db'];
let db: Db;
let storage: MemoryStorage;

beforeEach(() => {
  db = memoryDb();
  storage = new MemoryStorage();
});

function input(id: string, uploadedBy: string, over: Partial<CreateItemInput> = {}): CreateItemInput {
  return {
    id, type: 'photo', title: null, description: null, tapeLabel: null,
    date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
    duration: null, width: 100, height: 100, sizeBytes: 10,
    sha256: id.padEnd(64, '9'), source: 'upload', blurhash: null,
    files: [
      { kind: 'original', storageKey: `media/${id}/original.jpg`, mime: 'image/jpeg', width: 100, height: 100 },
      { kind: 'poster', storageKey: `media/${id}/poster.webp`, mime: 'image/webp', width: 100, height: 100 },
      { kind: 'thumb_400', storageKey: `media/${id}/thumb_400.webp`, mime: 'image/webp', width: 100, height: 100 },
      { kind: 'thumb_800', storageKey: `media/${id}/thumb_800.webp`, mime: 'image/webp', width: 100, height: 100 },
      { kind: 'thumb_1600', storageKey: `media/${id}/thumb_1600.webp`, mime: 'image/webp', width: 100, height: 100 },
    ],
    people: [], tags: [], uploadedBy, ...over,
  };
}

describe('GET /api/items', () => {
  it('401 logged out; parses csv/int params and paginates', async () => {
    const viewer = await seedUser(db, { role: 'user' });
    const { locals, queue } = makeLocals(db, viewer, storage);
    await expect(
      GET({ locals: makeLocals(db, null, storage).locals, url: new URL('http://t/api/items') } as never),
    ).rejects.toMatchObject({ status: 401 });
    await createItem(db, storage, queue, input('itm_r1', viewer.id));
    await createItem(db, storage, queue, input('itm_r2', viewer.id, { type: 'video', duration: 2 }));
    const res = await GET({ locals, url: new URL('http://t/api/items?type=video&year=1994&limit=10') } as never);
    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['itm_r2']);
    expect(body.nextCursor).toBeNull();
  });
});

describe('POST /api/items', () => {
  it('403 for viewer; creates for uploader with server-enforced uploadedBy/source', async () => {
    const viewer = await seedUser(db, { role: 'user' });
    const up = await seedUser(db, { role: 'uploader' });
    const payload = { ...input('itm_r3', 'spoofed-user'), uploadedBy: 'spoofed-user' };
    const req = (body: unknown) =>
      new Request('http://t/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    await expect(
      POST({ locals: makeLocals(db, viewer, storage).locals, request: req(payload) } as never),
    ).rejects.toMatchObject({ status: 403 });
    const { locals } = makeLocals(db, up, storage);
    const res = await POST({ locals, request: req(payload) } as never);
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item.uploadedBy).toBe(up.id); // server ignores client uploadedBy
    // storage keys outside media/ are rejected
    const bad = input('itm_r4', up.id);
    bad.files[0].storageKey = 'tmp/evil';
    await expect(POST({ locals, request: req(bad) } as never)).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] Step 10.2 — Run `pnpm vitest run src/routes/api/items/items-route.test.ts`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 10.3 — Implement `src/routes/api/items/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { createItem, listItems, type CreateItemInput, type ItemFileInput } from '$lib/server/items';

const FILE_KINDS = new Set(['original', 'poster', 'thumb_400', 'thumb_800', 'thumb_1600', 'sprite']);
const SHA_RE = /^[0-9a-f]{64}(#dup-[A-Za-z0-9_-]{6})?$/;

export const GET: RequestHandler = async ({ locals, url }) => {
  requireRole(locals, 'user'); // share-token access lands in phase 08
  const p = url.searchParams;
  const int = (name: string) => {
    const v = p.get(name);
    if (v === null) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n)) throw error(400, `${name} must be an integer`);
    return n;
  };
  const csv = (name: string) => {
    const v = p.get(name);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  };
  const enumParam = <T extends string>(name: string, allowed: T[]): T | undefined => {
    const v = p.get(name);
    if (v === null) return undefined;
    if (!allowed.includes(v as T)) throw error(400, `${name} must be one of ${allowed.join('|')}`);
    return v as T;
  };
  const result = await listItems(locals.db, locals.platform.storage, {
    year: int('year'),
    month: int('month'),
    people: csv('people'),
    tags: csv('tags'),
    type: enumParam('type', ['video', 'photo']),
    album: p.get('album') ?? undefined,
    status: enumParam('status', ['processing', 'needs_review', 'ready']),
    q: p.get('q') ?? undefined,
    cursor: p.get('cursor') ?? undefined,
    limit: int('limit'),
  });
  return json(result);
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireRole(locals, 'uploader');
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (body.type !== 'video' && body.type !== 'photo') throw error(400, 'type must be video|photo');
  if (typeof body.sha256 !== 'string' || !SHA_RE.test(body.sha256)) throw error(400, 'invalid sha256');
  for (const n of ['width', 'height', 'sizeBytes'] as const) {
    if (!Number.isInteger(body[n]) || (body[n] as number) <= 0) throw error(400, `${n} invalid`);
  }
  const filesRaw = Array.isArray(body.files) ? (body.files as ItemFileInput[]) : [];
  if (!filesRaw.length) throw error(400, 'files required');
  for (const f of filesRaw) {
    if (!FILE_KINDS.has(f.kind)) throw error(400, `bad file kind: ${String(f.kind)}`);
    if (typeof f.storageKey !== 'string' || !f.storageKey.startsWith('media/')) {
      throw error(400, 'file storageKey must start with media/');
    }
    if (typeof f.mime !== 'string' || !f.mime) throw error(400, 'file mime required');
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim().length ? v.trim() : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const input: CreateItemInput = {
    id: typeof body.id === 'string' && body.id.length ? body.id : undefined,
    type: body.type,
    title: str(body.title),
    description: str(body.description),
    tapeLabel: str(body.tapeLabel),
    date: (body.date ?? { dateStart: null, dateEnd: null, precision: 'unknown' }) as CreateItemInput['date'],
    duration: body.duration === null || body.duration === undefined ? null : Number(body.duration),
    width: body.width as number,
    height: body.height as number,
    sizeBytes: body.sizeBytes as number,
    sha256: body.sha256,
    source: 'upload',          // server-enforced; ingest path is phase 07
    blurhash: str(body.blurhash),
    files: filesRaw.map((f) => ({
      kind: f.kind, storageKey: f.storageKey, mime: f.mime,
      width: f.width ?? null, height: f.height ?? null,
    })),
    people: arr(body.people),
    tags: arr(body.tags),
    uploadedBy: user.id,       // server-enforced
  };
  const item = await createItem(locals.db, locals.platform.storage, locals.platform.queue, input);
  return json({ item }, { status: 201 });
};
```

- [ ] Step 10.4 — Write failing test `src/routes/api/items/[id]/item-route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, PATCH, POST } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals, MemoryStorage } from '$lib/server/testing/memory-platform';
import { createItem, type CreateItemInput } from '$lib/server/items';

type Db = App.Locals['db'];
let db: Db;
let storage: MemoryStorage;

beforeEach(() => {
  db = memoryDb();
  storage = new MemoryStorage();
});

function input(id: string, uploadedBy: string): CreateItemInput {
  return {
    id, type: 'photo', title: 'T', description: null, tapeLabel: null,
    date: { dateStart: '1994-06-14', dateEnd: '1994-06-14', precision: 'day' },
    duration: null, width: 100, height: 100, sizeBytes: 10,
    sha256: id.padEnd(64, '8'), source: 'upload', blurhash: null,
    files: [{ kind: 'poster', storageKey: `media/${id}/poster.webp`, mime: 'image/webp', width: 100, height: 100 }],
    people: [], tags: [], uploadedBy,
  };
}

const jsonReq = (method: string, body?: unknown) =>
  new Request('http://t/api/items/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('/api/items/[id]', () => {
  it('GET returns the DTO or 404', async () => {
    const up = await seedUser(db);
    const { locals, queue } = makeLocals(db, up, storage);
    await createItem(db, storage, queue, input('itm_x1', up.id));
    const res = await GET({ locals, params: { id: 'itm_x1' } } as never);
    expect((await res.json()).item.id).toBe('itm_x1');
    await expect(GET({ locals, params: { id: 'nope' } } as never)).rejects.toMatchObject({ status: 404 });
  });

  it('PATCH updates metadata; DELETE soft-deletes; POST restore (editor) revives', async () => {
    const up = await seedUser(db, { role: 'uploader' });
    const editor = await seedUser(db, { role: 'editor' });
    const { locals, queue } = makeLocals(db, up, storage);
    const editorLocals = makeLocals(db, editor, storage).locals;
    await createItem(db, storage, queue, input('itm_x2', up.id));

    const patched = await PATCH({ locals, params: { id: 'itm_x2' }, request: jsonReq('PATCH', { title: 'New title' }) } as never);
    expect((await patched.json()).item.title).toBe('New title');

    const del = await DELETE({ locals, params: { id: 'itm_x2' } } as never);
    expect(await del.json()).toEqual({ ok: true });
    await expect(GET({ locals, params: { id: 'itm_x2' } } as never)).rejects.toMatchObject({ status: 404 });

    // restore: uploader is refused, editor succeeds
    await expect(
      POST({ locals, params: { id: 'itm_x2' }, request: jsonReq('POST', { action: 'restore' }) } as never),
    ).rejects.toMatchObject({ status: 403 });
    const restored = await POST({
      locals: editorLocals, params: { id: 'itm_x2' }, request: jsonReq('POST', { action: 'restore' }),
    } as never);
    expect((await restored.json()).item.id).toBe('itm_x2');
    // unknown action 400
    await expect(
      POST({ locals: editorLocals, params: { id: 'itm_x2' }, request: jsonReq('POST', { action: 'zap' }) } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] Step 10.5 — Run `pnpm vitest run "src/routes/api/items/[id]"`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 10.6 — Implement `src/routes/api/items/[id]/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import {
  getItemDTO,
  restoreItem,
  softDeleteItem,
  updateItem,
  type UpdateItemInput,
} from '$lib/server/items';

export const GET: RequestHandler = async ({ locals, params }) => {
  requireRole(locals, 'user');
  const item = await getItemDTO(locals.db, locals.platform.storage, params.id);
  if (!item) throw error(404, 'item not found');
  return json({ item });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const user = requireRole(locals, 'uploader'); // own-vs-editor enforced in updateItem
  let patch: UpdateItemInput;
  try {
    patch = (await request.json()) as UpdateItemInput;
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const item = await updateItem(locals.db, locals.platform.storage, user, params.id, patch);
  return json({ item });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireRole(locals, 'uploader'); // own-vs-editor enforced in softDeleteItem
  return json(await softDeleteItem(locals.db, user, params.id));
};

/** POST { action: 'restore' } — editor+ (decision 14; admin trash UI is phase 08). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireRole(locals, 'editor');
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (body.action !== 'restore') throw error(400, "action must be 'restore'");
  const item = await restoreItem(locals.db, locals.platform.storage, params.id);
  return json({ item });
};
```

- [ ] Step 10.7 — Run `pnpm vitest run src/routes/api/items`. **Expected: PASS** (5 tests). Then `pnpm check` — 0 errors.
- [ ] Step 10.8 — Commit: `git add -A && git commit -m "feat: items REST routes — list/create/detail/patch/soft-delete/restore"`

---

### Task 11: `/api/timeline` + `/api/people` (GET)

**Files:**
- Create: `src/routes/api/timeline/+server.ts`, `src/routes/api/timeline/timeline.test.ts`, `src/routes/api/people/+server.ts`, `src/routes/api/people/people-route.test.ts`

**Interfaces:**
- Consumes: `yearCounts`, `people` tables; `requireRole`.
- Produces (Contract 6): `GET /api/timeline` → `{ years: { year, count }[], earliest, latest }` (consumed by phase 03 YearBand/CenturyRail); `GET /api/people` → `{ people: PersonListDTO[] }` (consumed by the upload form now, phase 05 people index later — phase 05 adds POST/PATCH/DELETE to this same route file).

**Steps:**

- [ ] Step 11.1 — Write failing test `src/routes/api/timeline/timeline.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals } from '$lib/server/testing/memory-platform';
import { yearCounts } from '$lib/server/db/schema';

type Db = App.Locals['db'];
let db: Db;

beforeEach(() => {
  db = memoryDb();
});

describe('GET /api/timeline', () => {
  it('requires login', async () => {
    await expect(GET({ locals: makeLocals(db, null).locals } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('sums types per year, sorted, with earliest/latest', async () => {
    const viewer = await seedUser(db, { role: 'user' });
    await db.insert(yearCounts).values([
      { year: 1994, type: 'video', count: 2 },
      { year: 1994, type: 'photo', count: 1 },
      { year: 1988, type: 'photo', count: 4 },
      { year: 2001, type: 'video', count: 0 }, // zero rows are dropped
    ]);
    const res = await GET({ locals: makeLocals(db, viewer).locals } as never);
    expect(await res.json()).toEqual({
      years: [
        { year: 1988, count: 4 },
        { year: 1994, count: 3 },
      ],
      earliest: 1988,
      latest: 1994,
    });
  });

  it('empty archive → empty years, null bounds', async () => {
    const viewer = await seedUser(db, { role: 'user' });
    const res = await GET({ locals: makeLocals(db, viewer).locals } as never);
    expect(await res.json()).toEqual({ years: [], earliest: null, latest: null });
  });
});
```

- [ ] Step 11.2 — Run `pnpm vitest run src/routes/api/timeline`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 11.3 — Implement `src/routes/api/timeline/+server.ts` (complete file):

```ts
import { json } from '@sveltejs/kit';
import { asc, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { yearCounts } from '$lib/server/db/schema';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'user'); // share-token access lands in phase 08
  const rows = await locals.db
    .select({ year: yearCounts.year, count: sql<number>`sum(${yearCounts.count})` })
    .from(yearCounts)
    .groupBy(yearCounts.year)
    .orderBy(asc(yearCounts.year));
  const years = rows.filter((r) => r.count > 0);
  return json({
    years,
    earliest: years.length ? years[0].year : null,
    latest: years.length ? years[years.length - 1].year : null,
  });
};
```

- [ ] Step 11.4 — Write failing test `src/routes/api/people/people-route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { memoryDb, seedPerson, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals } from '$lib/server/testing/memory-platform';

type Db = App.Locals['db'];
let db: Db;

beforeEach(() => {
  db = memoryDb();
});

describe('GET /api/people', () => {
  it('requires login', async () => {
    await expect(GET({ locals: makeLocals(db, null).locals } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('lists people ordered by name with the PersonListDTO shape', async () => {
    const viewer = await seedUser(db, { role: 'user' });
    await seedPerson(db, { name: 'Zia' });
    await seedPerson(db, { id: 'p_amy', name: 'Amy', birthdate: '1961-03-02' });
    const res = await GET({ locals: makeLocals(db, viewer).locals } as never);
    const { people } = await res.json();
    expect(people.map((p: { name: string }) => p.name)).toEqual(['Amy', 'Zia']);
    expect(people[0]).toEqual({
      id: 'p_amy',
      name: 'Amy',
      birthdate: '1961-03-02',
      deathDate: null,
      birthPlace: null,
      accentColor: '#A8D8EA',
      avatarItemId: null,
    });
  });
});
```

- [ ] Step 11.5 — Run `pnpm vitest run src/routes/api/people`. **Expected: FAIL** — `./+server` missing.

- [ ] Step 11.6 — Implement `src/routes/api/people/+server.ts` (complete file):

```ts
// Real list endpoint (reads the people table). Phase 05 adds POST here and the
// /api/people/[id] file per master Contract 6 — do not stub those now.
import { json } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { people } from '$lib/server/db/schema';
import type { PersonListDTO } from '$lib/types';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'user');
  const rows: PersonListDTO[] = await locals.db
    .select({
      id: people.id,
      name: people.name,
      birthdate: people.birthdate,
      deathDate: people.deathDate,
      birthPlace: people.birthPlace,
      accentColor: people.accentColor,
      avatarItemId: people.avatarItemId,
    })
    .from(people)
    .orderBy(asc(people.name));
  return json({ people: rows });
};
```

- [ ] Step 11.7 — Run `pnpm vitest run src/routes/api/timeline src/routes/api/people`. **Expected: PASS** (5 tests).
- [ ] Step 11.8 — Commit: `git add -A && git commit -m "feat: timeline histogram endpoint and people list endpoint"`

---

### Task 12: `/media/[...key]` streaming route with HTTP Range + `canAccessMedia` seam

**Files:**
- Create: `src/lib/server/http-range.ts`, `src/lib/server/http-range.test.ts`, `src/lib/server/shares.ts`, `src/routes/media/[...key]/+server.ts`, `src/routes/media/media-route.test.ts`

**Interfaces:**
- Consumes: `StorageAdapter.head/get/mediaUrl` (Contract 2; range end inclusive per decision 9); Contract 7 (node streams `/media/[...key]` with `206` + `Accept-Ranges: bytes`; CF 302s to signed URL).
- Produces:
  - `parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid'`
  - `canAccessMedia(locals: App.Locals): boolean` in `src/lib/server/shares.ts` — the checked seam phase 08 extends with share-cookie validation (`resolveShare` also lands there per Contract 7).
  - The `/media/[...key]` GET endpoint (poster/thumb/original URLs in every ItemDTO resolve through it on node).

**Steps:**

- [ ] Step 12.1 — Write failing test `src/lib/server/http-range.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRange } from './http-range';

describe('parseRange (size=100)', () => {
  it('no header → null (full response)', () => {
    expect(parseRange(null, 100)).toBeNull();
  });
  it('malformed header → null (ignore per RFC 7233)', () => {
    expect(parseRange('bytes=abc', 100)).toBeNull();
    expect(parseRange('chunks=0-1', 100)).toBeNull();
    expect(parseRange('bytes=1-2-3', 100)).toBeNull();
  });
  it('bounded range', () => {
    expect(parseRange('bytes=0-99', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  });
  it('end clamps to size-1', () => {
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });
  it('open-ended range', () => {
    expect(parseRange('bytes=95-', 100)).toEqual({ start: 95, end: 99 });
  });
  it('suffix range (last N bytes)', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });
  it('unsatisfiable → invalid (416)', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=20-10', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
  });
});
```

- [ ] Step 12.2 — Run `pnpm vitest run src/lib/server/http-range.test.ts`. **Expected: FAIL** — module missing.

- [ ] Step 12.3 — Implement `src/lib/server/http-range.ts` (complete file):

```ts
export type RangeResult = { start: number; end: number } | null | 'invalid';

/**
 * Parse an HTTP Range header against a known object size.
 * null → serve the full body (200). 'invalid' → 416. Otherwise inclusive bounds for 206.
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // malformed → ignore per RFC 7233 §3.1
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    // suffix form: last N bytes
    const n = Number(b);
    if (n === 0) return 'invalid';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (start >= size) return 'invalid';
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return 'invalid';
  return { start, end };
}
```

- [ ] Step 12.4 — Implement `src/lib/server/shares.ts` (complete file):

```ts
// Share-scoped access. Phase 08 adds: resolveShare(db, token, password?) and a
// share-cookie check here (master Contract 7). Until then only sessions grant
// media access — this function is the single seam /media consults.
export function canAccessMedia(locals: App.Locals): boolean {
  if (locals.user) return true;
  // PHASE 08 SEAM: validate the sb_share cookie here and scope by share target.
  return false;
}
```

- [ ] Step 12.5 — Write failing test `src/routes/media/media-route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './[...key]/+server';
import { memoryDb, seedUser } from '$lib/server/testing/memory-db';
import { makeLocals, MemoryStorage } from '$lib/server/testing/memory-platform';

type Db = App.Locals['db'];
let db: Db;
let storage: MemoryStorage;

const KEY = 'media/itm1/original.mp4';
const BYTES = new Uint8Array(100).map((_, i) => i);

beforeEach(async () => {
  db = memoryDb();
  storage = new MemoryStorage();
  await storage.put(KEY, BYTES, { contentType: 'video/mp4' });
});

function call(locals: App.Locals, key: string, headers: Record<string, string> = {}) {
  return GET({
    locals,
    params: { key },
    request: new Request(`http://t/media/${key}`, { headers }),
  } as never);
}

describe('GET /media/[...key]', () => {
  it('401 when logged out (canAccessMedia seam)', async () => {
    await expect(call(makeLocals(db, null, storage).locals, KEY)).rejects.toMatchObject({ status: 401 });
  });

  it('404 for keys outside media/ and for missing objects', async () => {
    const u = await seedUser(db, { role: 'user' });
    const { locals } = makeLocals(db, u, storage);
    await expect(call(locals, 'tmp/x/0')).rejects.toMatchObject({ status: 404 });
    await expect(call(locals, 'media/none.mp4')).rejects.toMatchObject({ status: 404 });
  });

  it('200 full body with Accept-Ranges and Content-Length', async () => {
    const u = await seedUser(db, { role: 'user' });
    const res = await call(makeLocals(db, u, storage).locals, KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('206 partial content for Range requests', async () => {
    const u = await seedUser(db, { role: 'user' });
    const res = await call(makeLocals(db, u, storage).locals, KEY, { range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(res.headers.get('content-length')).toBe('10');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(10, 20));
  });

  it('416 for unsatisfiable ranges', async () => {
    const u = await seedUser(db, { role: 'user' });
    const res = await call(makeLocals(db, u, storage).locals, KEY, { range: 'bytes=500-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */100');
  });

  it('cloudflare platform 302s to the signed URL', async () => {
    const u = await seedUser(db, { role: 'user' });
    const { locals } = makeLocals(db, u, storage, undefined, 'cloudflare');
    try {
      await call(locals, KEY);
      expect.unreachable('should have redirected');
    } catch (e) {
      expect(e).toMatchObject({ status: 302, location: `/media/${KEY}` });
    }
  });
});
```

- [ ] Step 12.6 — Run `pnpm vitest run src/routes/media`. **Expected: FAIL** — `./[...key]/+server` missing.

- [ ] Step 12.7 — Implement `src/routes/media/[...key]/+server.ts` (complete file):

```ts
// Contract 7: node streams from storage with HTTP Range support; Cloudflare
// 302s to the signed R2 URL. Auth: session OR (phase 08) share cookie.
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessMedia } from '$lib/server/shares';
import { parseRange } from '$lib/server/http-range';

const CACHE = 'private, max-age=31536000, immutable'; // keys are per-item content-addressed

export const GET: RequestHandler = async ({ locals, params, request }) => {
  if (!canAccessMedia(locals)) throw error(401, 'login required');
  const key = params.key;
  if (!key.startsWith('media/')) throw error(404, 'not found'); // never serve tmp/

  const { storage } = locals.platform;
  if (locals.platform.name === 'cloudflare') {
    redirect(302, await storage.mediaUrl(key));
  }

  const head = await storage.head(key);
  if (!head) throw error(404, 'not found');

  const range = parseRange(request.headers.get('range'), head.size);
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}` },
    });
  }

  if (!range) {
    const got = await storage.get(key);
    if (!got) throw error(404, 'not found');
    return new Response(got.stream, {
      status: 200,
      headers: {
        'Content-Type': head.contentType,
        'Content-Length': String(head.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': CACHE,
      },
    });
  }

  const got = await storage.get(key, { start: range.start, end: range.end });
  if (!got) throw error(404, 'not found');
  return new Response(got.stream, {
    status: 206,
    headers: {
      'Content-Type': head.contentType,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': CACHE,
    },
  });
};
```

- [ ] Step 12.8 — Run `pnpm vitest run src/lib/server/http-range.test.ts src/routes/media`. **Expected: PASS** (13 tests). Then `pnpm check` — 0 errors.
- [ ] Step 12.9 — Commit: `git add -A && git commit -m "feat: media streaming route with HTTP Range (206/416), CF redirect, canAccessMedia seam"`

---

### Task 13: Client upload library (hash, chunk uploader, photo/video derivation)

**Files:**
- Create: `src/lib/upload/hash.ts`, `src/lib/upload/hash.test.ts`, `src/lib/upload/uploader.ts`, `src/lib/upload/uploader.test.ts`, `src/lib/upload/derive-photo.ts`, `src/lib/upload/derive-video.ts`

**Interfaces:**
- Consumes: HTTP endpoints from Task 9; `fitWithin` (Task 1); `INK` from `$lib/ui/tokens` (Contract 4); npm: `@noble/hashes`, `blurhash`, `exifr`.
- Produces (consumed by the `/upload` page in Task 15):
  - `sha256File(file: Blob, onProgress?, chunkSize?): Promise<string>`
  - `apiInitUpload(input, fetchFn?): Promise<InitResponse>`, `uploadChunks(file, init, onProgress, fetchFn?): Promise<void>`, `apiCompleteUpload(params, fetchFn?): Promise<{ item: ItemDTO }>`, `chunkBytes(size, chunkSize, index): number`
  - `derivePhoto(file: File): Promise<Derived>`, `deriveVideo(file: File): Promise<Derived>` where `Derived = { width, height, duration, poster, thumb400, thumb800, thumb1600, blurhash, exifDate }`

**Steps:**

- [ ] Step 13.1 — Install client dependencies: `pnpm add @noble/hashes blurhash exifr`. Expected: three packages added to `dependencies` in `package.json`.

- [ ] Step 13.2 — Write failing test `src/lib/upload/hash.test.ts` (node's `Blob` + `node:crypto` are available in Vitest; `node:` imports are fine in tests):

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256File } from './hash';

describe('sha256File', () => {
  it('matches the known vector for "abc"', async () => {
    expect(await sha256File(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('multi-chunk hashing equals one-shot node crypto', async () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const expected = createHash('sha256').update(bytes).digest('hex');
    const progress: number[] = [];
    const got = await sha256File(new Blob([bytes]), (f) => progress.push(f), 64);
    expect(got).toBe(expected);
    expect(progress.length).toBe(Math.ceil(1000 / 64));
    expect(progress[progress.length - 1]).toBe(1);
  });
});
```

- [ ] Step 13.3 — Run `pnpm vitest run src/lib/upload/hash.test.ts`. **Expected: FAIL** — `./hash` missing.

- [ ] Step 13.4 — Implement `src/lib/upload/hash.ts` (complete file):

```ts
// Incremental SHA-256 over Blob slices. crypto.subtle.digest has no streaming
// API (decision 16), so we feed 8 MiB slices through @noble/hashes.
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

export const HASH_CHUNK = 8 * 1024 * 1024;

export async function sha256File(
  file: Blob,
  onProgress?: (fraction: number) => void,
  chunkSize: number = HASH_CHUNK,
): Promise<string> {
  const h = sha256.create();
  for (let off = 0; off < file.size; off += chunkSize) {
    const buf = await file.slice(off, Math.min(off + chunkSize, file.size)).arrayBuffer();
    h.update(new Uint8Array(buf));
    onProgress?.(Math.min(1, (off + chunkSize) / file.size));
  }
  return bytesToHex(h.digest());
}
```

(Subpath by installed major: `@noble/hashes/sha2` on v1.5+, `@noble/hashes/sha2.js` on v2+, `@noble/hashes/sha256` on older v1 — same named export in all three. Use whichever resolves; do not change the function body.)

- [ ] Step 13.5 — Write failing test `src/lib/upload/uploader.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { apiCompleteUpload, apiInitUpload, chunkBytes, uploadChunks, type InitResponse } from './uploader';

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('chunkBytes', () => {
  it('computes final partial chunk', () => {
    expect(chunkBytes(10, 4, 0)).toBe(4);
    expect(chunkBytes(10, 4, 2)).toBe(2);
  });
});

describe('apiInitUpload', () => {
  it('POSTs JSON and returns the plan', async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/upload/init');
      expect(JSON.parse(String(init?.body))).toMatchObject({ sha256: 'a'.repeat(64) });
      return okJson({ uploadId: 'a'.repeat(64), chunkSize: 4, totalChunks: 3, receivedChunks: [], duplicateItemId: null });
    });
    const res = await apiInitUpload(
      { sha256: 'a'.repeat(64), sizeBytes: 10, mime: 'video/mp4', filename: 't.mp4' },
      fetchFn as unknown as typeof fetch,
    );
    expect(res.totalChunks).toBe(3);
  });

  it('throws on non-2xx', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(
      apiInitUpload({ sha256: 'a'.repeat(64), sizeBytes: 1, mime: 'video/mp4', filename: 'x' }, fetchFn as never),
    ).rejects.toThrow(/403/);
  });
});

describe('uploadChunks', () => {
  const init: InitResponse = {
    uploadId: 'u1', chunkSize: 4, totalChunks: 3, receivedChunks: [1], duplicateItemId: null,
  };

  it('skips received chunks, PUTs the rest, reports progress', async () => {
    const puts: string[] = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      puts.push(String(url));
      return okJson({ received: true });
    });
    const file = new Blob([new Uint8Array(10).map((_, i) => i)]);
    const progress: number[] = [];
    await uploadChunks(file, init, (sent) => progress.push(sent), fetchFn as never);
    expect(puts).toEqual([
      '/api/upload/chunk?uploadId=u1&index=0',
      '/api/upload/chunk?uploadId=u1&index=2',
    ]);
    expect(progress[progress.length - 1]).toBe(10);
  });

  it('retries a failing chunk up to 3 times, then succeeds or throws', async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      return calls < 3 ? new Response('boom', { status: 500 }) : okJson({ received: true });
    });
    await uploadChunks(new Blob([new Uint8Array(4)]), { ...init, totalChunks: 1, receivedChunks: [] }, () => {}, flaky as never);
    expect(calls).toBe(3);
    const dead = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(
      uploadChunks(new Blob([new Uint8Array(4)]), { ...init, totalChunks: 1, receivedChunks: [] }, () => {}, dead as never),
    ).rejects.toThrow(/HTTP 500/);
    expect(dead).toHaveBeenCalledTimes(3);
  });
});

describe('apiCompleteUpload', () => {
  it('sends the master multipart field names', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const fd = init?.body as FormData;
      expect(fd.get('uploadId')).toBe('u1');
      expect(fd.get('allowDuplicate')).toBe('true');
      expect(typeof fd.get('meta')).toBe('string');
      expect(fd.get('blurhash')).toBe('LKO2?U');
      for (const f of ['poster', 'thumb_400', 'thumb_800', 'thumb_1600']) {
        expect(fd.get(f)).toBeInstanceOf(File);
      }
      return new Response(JSON.stringify({ item: { id: 'itm1' } }), { status: 201 });
    });
    const b = new Blob([new Uint8Array(4)], { type: 'image/webp' });
    const { item } = await apiCompleteUpload(
      {
        uploadId: 'u1', allowDuplicate: true, blurhash: 'LKO2?U',
        meta: {
          type: 'photo', width: 10, height: 10, duration: null, title: null, description: null,
          tapeLabel: null, date: { dateStart: null, dateEnd: null, precision: 'unknown' },
          people: [], tags: [],
        },
        poster: b, thumb400: b, thumb800: b, thumb1600: b,
      },
      fetchFn as never,
    );
    expect(item.id).toBe('itm1');
  });
});
```

- [ ] Step 13.6 — Run `pnpm vitest run src/lib/upload/uploader.test.ts`. **Expected: FAIL** — `./uploader` missing.

- [ ] Step 13.7 — Implement `src/lib/upload/uploader.ts` (complete file):

```ts
// Browser-side upload orchestration against the phase-02 upload API.
import type { ItemDTO, UploadMeta } from '$lib/types';

export interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: number[];
  duplicateItemId: string | null;
}

export function chunkBytes(size: number, chunkSize: number, index: number): number {
  return Math.min(chunkSize, size - index * chunkSize);
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => '');
  throw new Error(`${what} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
}

export async function apiInitUpload(
  input: { sha256: string; sizeBytes: number; mime: string; filename: string },
  fetchFn: typeof fetch = fetch,
): Promise<InitResponse> {
  const res = await fetchFn('/api/upload/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await fail(res, 'upload init');
  return (await res.json()) as InitResponse;
}

export async function uploadChunks(
  file: Blob,
  init: InitResponse,
  onProgress: (sentBytes: number) => void,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const have = new Set(init.receivedChunks);
  let sent = init.receivedChunks.reduce(
    (acc, i) => acc + chunkBytes(file.size, init.chunkSize, i),
    0,
  );
  onProgress(sent);
  for (let i = 0; i < init.totalChunks; i++) {
    if (have.has(i)) continue;
    const start = i * init.chunkSize;
    const blob = file.slice(start, Math.min(start + init.chunkSize, file.size));
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchFn(
          `/api/upload/chunk?uploadId=${encodeURIComponent(init.uploadId)}&index=${i}`,
          { method: 'PUT', body: blob },
        );
        if (!res.ok) throw new Error(`chunk ${i}: HTTP ${res.status}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    sent += blob.size;
    onProgress(sent);
  }
}

export interface CompleteParams {
  uploadId: string;
  allowDuplicate: boolean;
  meta: UploadMeta;
  blurhash: string | null;
  poster: Blob;
  thumb400: Blob;
  thumb800: Blob;
  thumb1600: Blob;
}

export async function apiCompleteUpload(
  p: CompleteParams,
  fetchFn: typeof fetch = fetch,
): Promise<{ item: ItemDTO }> {
  const fd = new FormData();
  fd.set('uploadId', p.uploadId);
  fd.set('allowDuplicate', String(p.allowDuplicate));
  fd.set('meta', JSON.stringify(p.meta));
  if (p.blurhash) fd.set('blurhash', p.blurhash);
  // Field names per master Contract 6.
  fd.set('poster', p.poster, 'poster.webp');
  fd.set('thumb_400', p.thumb400, 'thumb_400.webp');
  fd.set('thumb_800', p.thumb800, 'thumb_800.webp');
  fd.set('thumb_1600', p.thumb1600, 'thumb_1600.webp');
  const res = await fetchFn('/api/upload/complete', { method: 'POST', body: fd });
  if (!res.ok) await fail(res, 'upload complete');
  return (await res.json()) as { item: ItemDTO };
}
```

- [ ] Step 13.8 — Run `pnpm vitest run src/lib/upload`. **Expected: PASS** (8 tests).

- [ ] Step 13.9 — Implement `src/lib/upload/derive-photo.ts` (complete file — browser-only, exercised by the Task 16 e2e; no unit test because Vitest has no canvas):

```ts
// Photo derivatives in the browser: WebP thumbs via OffscreenCanvas, blurhash
// placeholder, EXIF capture date via exifr. Spec §7 step 3.
import exifr from 'exifr';
import { encode } from 'blurhash';
import { fitWithin } from '$lib/domain/dims';

export interface Derived {
  width: number;
  height: number;
  duration: number | null;
  poster: Blob;
  thumb400: Blob;
  thumb800: Blob;
  thumb1600: Blob;
  blurhash: string;
  exifDate: string | null; // ISO 'YYYY-MM-DD' when the file carries a capture date
}

const WEBP_QUALITY = 0.82;

export function scaledCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxWidth: number,
): OffscreenCanvas {
  const { width, height } = fitWithin(srcW, srcH, maxWidth);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function toWebp(canvas: OffscreenCanvas): Promise<Blob> {
  // Browsers without WebP encode support return PNG; item_files.mime records
  // the actual blob type, keys keep the .webp name (kind-based, per Contract 7).
  return canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
}

export function blurhashOf(source: CanvasImageSource, srcW: number, srcH: number): string {
  const c = scaledCanvas(source, srcW, srcH, 32);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return encode(img.data, img.width, img.height, 4, 3);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function exifDateOf(file: File): Promise<string | null> {
  try {
    const exif = (await exifr.parse(file, ['DateTimeOriginal', 'CreateDate'])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    const dt = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
      // Camera-local wall-clock date, as shot.
      return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    }
  } catch {
    // no/broken EXIF is normal — undated
  }
  return null;
}

export async function derivePhoto(file: File): Promise<Derived> {
  const bmp = await createImageBitmap(file);
  try {
    const { width, height } = bmp;
    const poster = await toWebp(scaledCanvas(bmp, width, height, 1600)); // decision 8
    const thumb1600 = await toWebp(scaledCanvas(bmp, width, height, 1600));
    const thumb800 = await toWebp(scaledCanvas(bmp, width, height, 800));
    const thumb400 = await toWebp(scaledCanvas(bmp, width, height, 400));
    const blurhash = blurhashOf(bmp, width, height);
    const exifDate = await exifDateOf(file);
    return { width, height, duration: null, poster, thumb400, thumb800, thumb1600, blurhash, exifDate };
  } finally {
    bmp.close();
  }
}
```

- [ ] Step 13.10 — Implement `src/lib/upload/derive-video.ts` (complete file — browser-only):

```ts
// Video derivatives in the browser: seek to 10% and capture a poster frame,
// derive thumbs from the poster, read duration/dimensions from metadata.
// Codec-less browsers (e.g. CI chromium without H.264) fall back to an
// ink-colored poster so the pipeline never wedges; real derivatives are
// regenerated by the phase-07 worker on Docker.
import { INK } from '$lib/ui/tokens';
import { blurhashOf, scaledCanvas, toWebp, type Derived } from '$lib/upload/derive-photo';

const STEP_TIMEOUT_MS = 10_000;

function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(`video ${event} error`));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('video step timed out')), ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function deriveVideo(file: File): Promise<Derived> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    let haveMeta = true;
    try {
      await withTimeout(once(video, 'loadedmetadata'), STEP_TIMEOUT_MS);
    } catch {
      haveMeta = false;
    }
    const width = haveMeta && video.videoWidth > 0 ? video.videoWidth : 640;
    const height = haveMeta && video.videoHeight > 0 ? video.videoHeight : 360;
    const duration =
      haveMeta && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

    let frameDrawn = false;
    const posterCanvas = new OffscreenCanvas(width, height);
    const ctx = posterCanvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    if (duration !== null) {
      try {
        video.currentTime = Math.min(duration * 0.1, Math.max(duration - 0.1, 0)); // 10% in
        await withTimeout(once(video, 'seeked'), STEP_TIMEOUT_MS);
        ctx.drawImage(video, 0, 0, width, height);
        frameDrawn = true;
      } catch {
        frameDrawn = false;
      }
    }
    if (!frameDrawn) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, width, height);
    }

    const poster = await toWebp(posterCanvas);
    const thumb1600 = await toWebp(scaledCanvas(posterCanvas, width, height, 1600));
    const thumb800 = await toWebp(scaledCanvas(posterCanvas, width, height, 800));
    const thumb400 = await toWebp(scaledCanvas(posterCanvas, width, height, 400));
    const blurhash = blurhashOf(posterCanvas, width, height);
    return { width, height, duration, poster, thumb400, thumb800, thumb1600, blurhash, exifDate: null };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}
```

- [ ] Step 13.11 — Run `pnpm check`. **Expected: 0 errors.** Run `pnpm vitest run src/lib/upload src/lib/domain`. **Expected: PASS.**
- [ ] Step 13.12 — Commit: `git add -A && git commit -m "feat: client upload library — incremental sha256, chunk uploader with resume/retry, canvas derivatives"`

---

### Task 14: `DatePicker.svelte` (precision-aware date entry)

**Files:**
- Create: `src/lib/ui/DatePicker.svelte`

**Interfaces:**
- Consumes: `itemDateFrom`, `MONTHS_LONG`, `ItemDate`, `DatePrecision` (Task 1); `FONT` from `$lib/ui/tokens` (Contract 4).
- Produces: `<DatePicker bind:value />` where `value: ItemDate` — always a canonical ItemDate (used by `/upload` now; phase 04 metadata editing and phase 07 Arrivals reuse it).

**Steps:**

- [ ] Step 14.1 — Implement `src/lib/ui/DatePicker.svelte` (complete file). Spec §4 precisions: exact day / month / year / between-years / unknown. Sharp corners, ≥44px targets, sans uppercase mode buttons, no italics, no hard-coded hex (colors inherit; fonts from tokens):

```svelte
<script lang="ts">
  import {
    itemDateFrom,
    MONTHS_LONG,
    type DatePrecision,
    type ItemDate,
  } from '$lib/domain/dates';

  let {
    value = $bindable({ dateStart: null, dateEnd: null, precision: 'unknown' } as ItemDate),
  }: { value?: ItemDate } = $props();

  const THIS_YEAR = new Date().getFullYear();

  const MODES: { key: DatePrecision; label: string }[] = [
    { key: 'day', label: 'Exact day' },
    { key: 'month', label: 'Month' },
    { key: 'year', label: 'Year' },
    { key: 'range', label: 'Between years' },
    { key: 'unknown', label: 'Unknown' },
  ];

  let mode = $state<DatePrecision>(value.precision);
  let day = $state(value.precision === 'day' ? (value.dateStart ?? '') : '');
  let year = $state<string>(value.dateStart ? value.dateStart.slice(0, 4) : '');
  let month = $state<string>(
    value.precision === 'month' && value.dateStart ? String(Number(value.dateStart.slice(5, 7))) : '',
  );
  let yearEnd = $state<string>(
    value.precision === 'range' && value.dateEnd ? value.dateEnd.slice(0, 4) : '',
  );

  const UNKNOWN: ItemDate = { dateStart: null, dateEnd: null, precision: 'unknown' };

  let lastWritten = JSON.stringify(value);

  function emit(v: ItemDate) {
    lastWritten = JSON.stringify(v);
    value = v;
  }

  // Sync local inputs when the PARENT replaces value (e.g. EXIF prefill after
  // derivation) — guarded so our own emits do not loop back.
  $effect(() => {
    const incoming = JSON.stringify(value);
    if (incoming !== lastWritten) {
      lastWritten = incoming;
      mode = value.precision;
      day = value.precision === 'day' ? (value.dateStart ?? '') : '';
      year = value.dateStart ? value.dateStart.slice(0, 4) : '';
      month =
        value.precision === 'month' && value.dateStart
          ? String(Number(value.dateStart.slice(5, 7)))
          : '';
      yearEnd = value.precision === 'range' && value.dateEnd ? value.dateEnd.slice(0, 4) : '';
    }
  });

  function recompute() {
    try {
      if (mode === 'day' && day) {
        emit(itemDateFrom({ precision: 'day', day }));
      } else if (mode === 'month' && year && month) {
        emit(itemDateFrom({ precision: 'month', year: Number(year), month: Number(month) }));
      } else if (mode === 'year' && year) {
        emit(itemDateFrom({ precision: 'year', year: Number(year) }));
      } else if (mode === 'range' && year && yearEnd) {
        emit(itemDateFrom({ precision: 'range', year: Number(year), yearEnd: Number(yearEnd) }));
      } else {
        emit(UNKNOWN);
      }
    } catch {
      emit(UNKNOWN); // partial/invalid entry — treat as undated until fixed
    }
  }

  function pickMode(m: DatePrecision) {
    mode = m;
    recompute();
  }
</script>

<fieldset class="datepicker">
  <legend>When</legend>
  <div class="modes" role="group" aria-label="Date precision">
    {#each MODES as m (m.key)}
      <button
        type="button"
        class="mode"
        class:active={mode === m.key}
        aria-pressed={mode === m.key}
        onclick={() => pickMode(m.key)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  {#if mode === 'day'}
    <label class="field">
      <span>Date</span>
      <input type="date" bind:value={day} oninput={recompute} />
    </label>
  {:else if mode === 'month'}
    <label class="field">
      <span>Month</span>
      <select bind:value={month} onchange={recompute}>
        <option value="">—</option>
        {#each MONTHS_LONG as name, i (name)}
          <option value={String(i + 1)}>{name}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>Year</span>
      <input type="number" min="1800" max={THIS_YEAR} bind:value={year} oninput={recompute} aria-label="Year" />
    </label>
  {:else if mode === 'year'}
    <label class="field">
      <span>Year</span>
      <input type="number" min="1800" max={THIS_YEAR} bind:value={year} oninput={recompute} aria-label="Year" />
    </label>
  {:else if mode === 'range'}
    <label class="field">
      <span>From year</span>
      <input type="number" min="1800" max={THIS_YEAR} bind:value={year} oninput={recompute} aria-label="From year" />
    </label>
    <label class="field">
      <span>To year</span>
      <input type="number" min="1800" max={THIS_YEAR} bind:value={yearEnd} oninput={recompute} aria-label="To year" />
    </label>
  {:else}
    <p class="hint">No date — the item will wait in review until one is set.</p>
  {/if}
</fieldset>

<style>
  .datepicker {
    border: none;
    padding: 0;
    margin: 0;
  }
  legend {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.7;
    padding: 0;
    margin-bottom: 0.5rem;
  }
  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }
  .mode {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    min-height: 44px;
    padding: 0 0.75rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
  }
  .mode.active {
    opacity: 1;
    text-decoration: underline;
    text-underline-offset: 6px;
  }
  .mode:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .field {
    display: inline-flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-right: 0.75rem;
  }
  .field span {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.7;
  }
  .field input,
  .field select {
    font-family: var(--font-serif);
    font-size: 1rem;
    min-height: 44px;
    padding: 0 0.5rem;
    border: none;
    border-radius: 0;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: inherit;
  }
  .hint {
    font-family: var(--font-serif);
    font-size: 1rem;
    opacity: 0.7;
    margin: 0;
  }
</style>
```

Note: the component styles use the CSS custom properties `--font-sans` / `--font-serif`. Phase 01's layout defines them from `FONT` in `$lib/ui/tokens`; if it did not, add them ONCE to the layout's global CSS (NOT in this component): in `src/routes/+layout.svelte`, `import { FONT } from '$lib/ui/tokens';` and set `document.documentElement.style.setProperty('--font-serif', FONT.serif)` / `('--font-sans', FONT.sans)` in an `$effect` (or emit a `<style>` block in `app.css` with the literal token values). Never hard-code font stacks in components.

- [ ] Step 14.2 — Run `pnpm check`. **Expected: 0 errors.**
- [ ] Step 14.3 — Commit: `git add -A && git commit -m "feat: precision-aware DatePicker component (day/month/year/range/unknown)"`

---

### Task 15: `/upload` page — drag-drop, progress, dedupe warning, metadata form

**Files:**
- Create: `src/routes/upload/+page.server.ts`, `src/routes/upload/+page.svelte`

**Interfaces:**
- Consumes: `requireRole` (Contract 3), `GET /api/people` (Task 11), Task 13 client library, Task 14 DatePicker, `DAWN` token (Contract 4).
- Produces: the Upload screen (spec §11): drag-drop multi-file, per-file progress bars, dedupe warning with "already in archive" link + allow-anyway, inline metadata form (DatePicker, people multi-select, free-entry tags creating topic tags, tape_label, title, description).

**Steps:**

- [ ] Step 15.1 — Implement `src/routes/upload/+page.server.ts` (complete file):

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import type { PersonListDTO } from '$lib/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
  requireRole(locals, 'uploader');
  const res = await fetch('/api/people');
  const { people } = (await res.json()) as { people: PersonListDTO[] };
  return { people };
};
```

- [ ] Step 15.2 — Implement `src/routes/upload/+page.svelte` (complete file):

```svelte
<script lang="ts">
  import { DAWN } from '$lib/ui/tokens';
  import DatePicker from '$lib/ui/DatePicker.svelte';
  import { sha256File } from '$lib/upload/hash';
  import { apiCompleteUpload, apiInitUpload, uploadChunks } from '$lib/upload/uploader';
  import { derivePhoto, type Derived } from '$lib/upload/derive-photo';
  import { deriveVideo } from '$lib/upload/derive-video';
  import type { ItemDate } from '$lib/domain/dates';
  import type { ItemDTO } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type RowStatus =
    | 'preparing'
    | 'ready'
    | 'read-error'
    | 'uploading'
    | 'finalizing'
    | 'duplicate'
    | 'done'
    | 'error'
    | 'skipped';

  interface Row {
    file: File;
    status: RowStatus;
    progress: number; // 0–100
    sha256: string | null;
    derived: Derived | null;
    previewUrl: string | null;
    error: string | null;
    duplicateItemId: string | null;
    allowDuplicate: boolean;
    title: string;
    description: string;
    tapeLabel: string;
    tagsText: string;
    peopleIds: string[];
    date: ItemDate;
    item: ItemDTO | null;
  }

  const ACCEPTED = ['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/avif'];

  let rows = $state<Row[]>([]);
  let dragOver = $state(false);
  let busy = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const STATUS_LABEL: Record<RowStatus, string> = {
    preparing: 'Preparing…',
    ready: 'Ready',
    'read-error': 'Could not read this file',
    uploading: 'Uploading',
    finalizing: 'Finalizing…',
    duplicate: 'Already in archive',
    done: 'Done',
    error: 'Failed',
    skipped: 'Skipped',
  };

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) continue;
      rows.push({
        file,
        status: 'preparing',
        progress: 0,
        sha256: null,
        derived: null,
        previewUrl: null,
        error: null,
        duplicateItemId: null,
        allowDuplicate: false,
        title: '',
        description: '',
        tapeLabel: '',
        tagsText: '',
        peopleIds: [],
        date: { dateStart: null, dateEnd: null, precision: 'unknown' },
        item: null,
      });
      void prepare(rows[rows.length - 1]); // use the reactive proxy, not the raw object
    }
  }

  async function prepare(row: Row) {
    try {
      const isVideo = row.file.type.startsWith('video/');
      const [sha, derived] = await Promise.all([
        sha256File(row.file),
        isVideo ? deriveVideo(row.file) : derivePhoto(row.file),
      ]);
      row.sha256 = sha;
      row.derived = derived;
      row.previewUrl = URL.createObjectURL(derived.thumb400);
      if (derived.exifDate && row.date.precision === 'unknown') {
        row.date = { dateStart: derived.exifDate, dateEnd: derived.exifDate, precision: 'day' };
      }
      row.status = 'ready';
    } catch (e) {
      row.status = 'read-error';
      row.error = e instanceof Error ? e.message : String(e);
    }
  }

  async function uploadRow(row: Row) {
    if (!row.sha256 || !row.derived) return;
    try {
      row.status = 'uploading';
      row.error = null;
      row.progress = 0;
      const init = await apiInitUpload({
        sha256: row.sha256,
        sizeBytes: row.file.size,
        mime: row.file.type,
        filename: row.file.name,
      });
      if (init.duplicateItemId && !row.allowDuplicate) {
        row.duplicateItemId = init.duplicateItemId;
        row.status = 'duplicate';
        return;
      }
      await uploadChunks(row.file, init, (sent) => {
        row.progress = Math.min(100, Math.round((sent / row.file.size) * 100));
      });
      row.status = 'finalizing';
      const d = row.derived;
      const { item } = await apiCompleteUpload({
        uploadId: init.uploadId,
        allowDuplicate: row.allowDuplicate,
        meta: {
          type: row.file.type.startsWith('video/') ? 'video' : 'photo',
          width: d.width,
          height: d.height,
          duration: d.duration,
          title: row.title.trim() || null,
          description: row.description.trim() || null,
          tapeLabel: row.tapeLabel.trim() || null,
          date: row.date,
          people: row.peopleIds,
          tags: row.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        },
        blurhash: d.blurhash,
        poster: d.poster,
        thumb400: d.thumb400,
        thumb800: d.thumb800,
        thumb1600: d.thumb1600,
      });
      row.item = item;
      row.status = 'done';
    } catch (e) {
      row.status = 'error';
      row.error = e instanceof Error ? e.message : String(e);
    }
  }

  async function uploadAll() {
    busy = true;
    for (const row of rows) {
      if (row.status === 'ready' || row.status === 'error') await uploadRow(row);
    }
    busy = false;
  }

  function allowAnyway(row: Row) {
    row.allowDuplicate = true;
    void uploadRow(row);
  }

  function togglePerson(row: Row, id: string) {
    row.peopleIds = row.peopleIds.includes(id)
      ? row.peopleIds.filter((p) => p !== id)
      : [...row.peopleIds, id];
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer?.files ?? null);
  }

  const uploadableCount = $derived(rows.filter((r) => r.status === 'ready' || r.status === 'error').length);
</script>

<svelte:head><title>Upload — Shoebox</title></svelte:head>

<main class="upload-page">
  <h1>Upload</h1>

  <div
    class="dropzone"
    class:over={dragOver}
    role="button"
    tabindex="0"
    aria-label="Add files"
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
    onclick={() => fileInput?.click()}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
    }}
  >
    <p class="drop-serif">Drop clips and photos here</p>
    <p class="drop-sans">MP4 · WebM · JPEG · PNG · WebP · AVIF — or press Enter to browse</p>
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept={ACCEPTED.join(',')}
      hidden
      onchange={(e) => addFiles(e.currentTarget.files)}
    />
  </div>

  {#each rows as row, i (i)}
    <section class="row" data-testid="upload-row">
      <div class="row-head">
        {#if row.previewUrl}
          <img class="preview" src={row.previewUrl} alt="" width="120" />
        {:else}
          <div class="preview placeholder"></div>
        {/if}
        <div class="row-title">
          <strong class="filename">{row.file.name}</strong>
          <span class="status" data-testid="row-status">{STATUS_LABEL[row.status]}</span>
          {#if row.error}<span class="error-text">{row.error}</span>{/if}
        </div>
      </div>

      {#if row.status === 'uploading' || row.status === 'finalizing'}
        <div
          class="progress"
          role="progressbar"
          aria-valuenow={row.progress}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="progress-fill" style:width="{row.progress}%" style:background={DAWN}></div>
        </div>
      {/if}

      {#if row.status === 'duplicate'}
        <div class="dupe" data-testid="dupe-warning">
          <p>
            This file is already in the archive.
            <a href={`/item/${row.duplicateItemId}`}>View existing item</a>
          </p>
          <div class="dupe-actions">
            <button type="button" onclick={() => allowAnyway(row)}>Upload anyway</button>
            <button type="button" onclick={() => (row.status = 'skipped')}>Skip</button>
          </div>
        </div>
      {/if}

      {#if row.status === 'done' && row.item}
        <p class="done-line">
          Saved as <a href={`/item/${row.item.id}`}>{row.item.title ?? row.file.name}</a>
          — {row.item.displayDate}{row.item.status === 'needs_review' ? ' · waiting for review' : ''}
        </p>
      {:else if row.status !== 'skipped'}
        <div class="form">
          <label class="field wide">
            <span>Title</span>
            <input type="text" bind:value={row.title} />
          </label>
          <label class="field wide">
            <span>Description</span>
            <textarea rows="2" bind:value={row.description}></textarea>
          </label>
          <label class="field">
            <span>Tape label</span>
            <input type="text" bind:value={row.tapeLabel} placeholder="Tape 04" />
          </label>
          <label class="field">
            <span>Tags</span>
            <input type="text" bind:value={row.tagsText} placeholder="christmas, backyard" />
          </label>

          <DatePicker bind:value={row.date} />

          <fieldset class="people">
            <legend>People</legend>
            {#if data.people.length === 0}
              <p class="hint">No people yet — add them on the People page later.</p>
            {:else}
              {#each data.people as person (person.id)}
                <label class="person">
                  <input
                    type="checkbox"
                    checked={row.peopleIds.includes(person.id)}
                    onchange={() => togglePerson(row, person.id)}
                  />
                  <span style:color={person.accentColor}>{person.name}</span>
                </label>
              {/each}
            {/if}
          </fieldset>
        </div>
      {/if}
    </section>
  {/each}

  {#if rows.length}
    <button
      type="button"
      class="upload-all"
      disabled={busy || uploadableCount === 0}
      onclick={uploadAll}
    >
      Upload all ({uploadableCount})
    </button>
  {/if}
</main>

<style>
  .upload-page {
    max-width: 60rem;
    margin: 0 auto;
    padding: 1.5rem;
  }
  h1 {
    font-family: var(--font-serif);
    font-weight: 600;
  }
  .dropzone {
    padding: 3rem 1.5rem;
    text-align: center;
    cursor: pointer;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  .dropzone.over {
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .drop-serif {
    font-family: var(--font-serif);
    font-size: 1.375rem;
    margin: 0 0 0.5rem;
  }
  .drop-sans,
  .field span,
  legend,
  .status {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.7;
  }
  .row {
    margin-top: 2rem;
    padding-top: 1rem;
  }
  .row-head {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .preview {
    display: block;
    width: 120px;
    height: auto;
  }
  .preview.placeholder {
    width: 120px;
    height: 68px;
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .row-title {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .filename {
    font-family: var(--font-serif);
    font-size: 1.125rem;
    font-weight: 600;
  }
  .error-text {
    font-family: var(--font-sans);
    font-size: 0.875rem;
  }
  .progress {
    height: 8px;
    margin-top: 0.75rem;
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
  .progress-fill {
    height: 100%;
    transition: width 200ms linear;
  }
  .dupe p,
  .done-line {
    font-family: var(--font-serif);
    font-size: 1rem;
  }
  .dupe-actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    min-height: 44px;
    padding: 0 1rem;
    border: none;
    border-radius: 0;
    background: color-mix(in srgb, currentColor 15%, transparent);
    color: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .upload-all {
    margin-top: 2rem;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .field.wide {
    flex: 1 1 100%;
  }
  .field input,
  .field textarea {
    font-family: var(--font-serif);
    font-size: 1rem;
    min-height: 44px;
    padding: 0.5rem;
    border: none;
    border-radius: 0;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: inherit;
  }
  .people {
    border: none;
    padding: 0;
    flex: 1 1 100%;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    margin-right: 1rem;
    font-family: var(--font-serif);
    font-size: 1rem;
  }
  .hint {
    font-family: var(--font-serif);
    opacity: 0.7;
  }
</style>
```

- [ ] Step 15.3 — Run `pnpm check`. **Expected: 0 errors.**

- [ ] Step 15.4 — **Visual verification** (required for UI tasks):
  1. `pnpm dev` and sign in as a user with role uploader+ (create one via phase 01 setup/invites if the dev DB is fresh).
  2. Open `http://localhost:5173/upload` and verify against the design system: dropzone visible with serif headline + uppercase sans subline; **zero rounded corners** anywhere; no borders on the preview image; base text ≥ 16px serif.
  3. Drop any local JPEG: a row appears, status goes Preparing… → Ready, a thumbnail preview renders.
  4. DatePicker: click through Exact day / Month / Year / Between years / Unknown — inputs swap accordingly, all buttons ≥ 44px tall, active mode underlined.
  5. People: with an empty people table the fallback "No people yet" line shows.
  6. Fill Year = 1994, click "Upload all (1)": progress bar fills in dawn color, row ends "Done" with a link line "Saved as … — 1994".
  7. Drop the SAME file again, "Upload all": the row shows "Already in archive" with a "View existing item" link and Upload anyway / Skip buttons; click "Upload anyway" → Done.
  8. Reload `/upload` while logged out (or as a plain `user` role account) → 403/redirect from the load's `requireRole`.
- [ ] Step 15.5 — Commit: `git add -A && git commit -m "feat: upload page — drag-drop, per-file progress, dedupe warning, inline metadata form"`

---

### Task 16: Playwright e2e — golden path for media core

**Files:**
- Create: `e2e/fixtures/tiny.mp4.b64`, `e2e/fixtures/tiny.jpg.b64`, `e2e/fixtures/generate-fixtures.sh`, `e2e/media-core.spec.ts`
- Create only if phase 01 did not: `playwright.config.ts`

**Interfaces:**
- Consumes: the running app (phase 01 setup/login + everything this phase built).
- Produces: the phase-02 exit gate — login → upload MP4 + JPEG → items via `/api/items` with correct DTOs → poster/thumb 200 → Range 206 → duplicate warn + allow-anyway → trash delete/restore.

**Steps:**

- [ ] Step 16.1 — Create `e2e/fixtures/tiny.mp4.b64` with EXACTLY this single-line content (a real 2,877-byte, 1-second, 192×108, 8 fps H.264 MP4 with faststart moov — pre-generated with ffmpeg; do not re-wrap or edit):

```
AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAsB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAMAAAABsAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAQAAABAAAAAAI4bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAASABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB421pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAaNzdGJsAAAAw3N0c2QAAAAAAAAAAQAAALNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAMAAbABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAOWF2Y0MBZAAM/+EAG2dkAAyscgRDD/vARAAAAwAEAAADAEA8UKYRgAEAB2joQ4MSyLD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAO7gAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAgAAAgAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABIY3R0cwAAAAAAAAAHAAAAAQAAEAAAAAABAAAgAAAAAAIAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAEAAAAAAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAgAAAABAAAANHN0c3oAAAAAAAAAAAAAAAgAAAXIAAAAoQAAAB4AAAATAAAAmgAAACAAAAARAAAAEgAAABRzdGNvAAAAAAAAAAEAAAPGAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAB39tZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTE2IGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMzMgbWU9dW1oIHN1Ym1lPTEwIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MjQgY2hyb21hX21lPTEgdHJlbGxpcz0yIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTggYl9weXJhbWlkPTIgYl9hZGFwdD0yIGJfYmlhcz0wIGRpcmVjdD0zIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49OCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTYwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MzguMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAxFliIEAAj/+5UXmWR1lHsAQi1MJJ0Cis6CdfQ5dc8nTg2Q1UQuGP89fmSIWaof7nkACjRoksHUzusdOw4xSnMFxO/2bx0DmPMRgFqchJfHZKfG1SfNhsAa5Gx8KVBDm/u+vPGjYcQHx4GTG23sobYeN+Yip8jlN3a2dwyd8wt6mrB3DQFnWDGTh1qgt/8P0oOG/5JdBma4E/+aR0/8S392sV203B2BOvIYsiBiCp86B+9y8zXvoPbl0oX1+9KtNCvxIkvIkPpkkcyH0RrPFYEn/pJ8f3ScltZsbNk173ImTFRIonDRzVpaUc00yjw0nH15joaXjp4vxqxXSQaOYLUoB4rAnN/ExscOcW41NLVc8yXwq8CwoMmYSzcFJHRHZba0pl1hq1JQDSlcKf9QlMIbqndiz8fo8+Wiwc5WVuiBq8DJtRBF329phGDgz06AT3XKEXdE1v4PJli5F/Th+UCQbJRiOS9oNxVfkPgyfq4Gknf/ZQYUrVSbn+n1htvGLcliVOpjktbLpXYIwWujBl4Br48AttvodEvaWMxm9WEO0z0C3K6vNOWrF7psEu3+lMh1bsPFKZUKW81I2KFTPwEQ+q62UpGC/QLiupimvH8rMJCmX89XavLuGcxIE4X6rUC0lFWWElMDzHZjoz/NimrKTA8vCG6lS/Yi4k4Xy2ruUt931bYjlxPwSMeIz0kpALt3zZ+nO+a8iHgA3z5TDRcQPT5DkFeskhZE3glpLL45ZvHfS4wH7JGzmr+FwJZpvcGkvoRAFXuRgEdfWSfjzo3UkHS9FrBsfkU8bNoWqMfGqvbDPeIm9hMKtrEITrQZdqXhzxRPdvfr3maiVxTtg8NAPcza0WjxzjSh7fOWvr1EnFSBbYobsGZl9DLeCtlQQC/IJXNT+L2SUVb3JLEPrM/lTnlJ0iZs46B2A9Z8FBU0YKgk6geRlTdNPsxWBP575f/DAfZlvHPF0nsHpsVFCTmsEYHg+LNUzTkq9F5W2xXezMUcUE231vknLhTCUnCjkFWm7qOzvppsSm7j0EkOhwFRN4wAAAJ1BmghtiCH/AA8+dhEU/0Ltv8v0a1tIAS7lU6FjYuP0sVo5J7qnf6iCs7RSlEmocUckaiNhyXZycD6AN9tw4PkHA9+FnqnuM4HaaT6zSlpnko8CIJuIhlGH/IcXL4UWHtjiMZTkaYBiFF+jl3NiEJtF5SZLwoWChaVnTy4O2RJvaAFnwsVdLTp7OebazagAAJaGNEW5ycBGqbAyx2uAAAAAGkGeECcQ7xEUZ0qyKVVgh/XYKdAtoJ7hxYbRAAAADwGeGE1Id/8pYDUw29cmGAAAAJZBmhjpNQIC0TKYEO8ABLSHauy7kAJNHY1Is2EhMJZNNB6+hftqJQSzwMW/USQl2n0paNAGrTvGA8R27DrKF5WDA9VurjkiL2aq02mQv8m2pfQAqzfM2bKsv4zfIx2FjiM8UV/hSlnlUFu7ekused9ihj6c+CaIMQD+1wjOSLsB9jbcyZiiJd6GcQuW/g+Ssh7RCLbhu7kAAAAcQZ4grcQ//wocTIeTN/0EAAKOGAS3hmpJ2BfXoQAAAA0BniiNoh3/CSFa7p0JAAAADgGeKMySHf8JIwAkrQKB
```

- [ ] Step 16.2 — Create `e2e/fixtures/tiny.jpg.b64` with EXACTLY this single-line content (a real 350-byte 192×108 baseline JPEG):

```
/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgYGBwYHCEhISEhISckJygoKCcnJycoKCgrKyszMzMrKysoKCsrMDAzMzc5NzQ0MzQ5OTw8PEhIRUVUVFdnZ3z/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAbADAAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8ArQGOroAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/9k=
```

- [ ] Step 16.3 — Create `e2e/fixtures/generate-fixtures.sh` (documentation/regeneration only — the suite never runs it; make executable with `chmod +x`):

```sh
#!/usr/bin/env bash
# Regenerates the checked-in .b64 fixtures. Requires ffmpeg. The .b64 files are
# the canonical sources used by e2e — run this only to refresh them.
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -y -f lavfi -i testsrc=duration=1:size=192x108:rate=8 \
  -pix_fmt yuv420p -c:v libx264 -crf 38 -preset veryslow -movflags +faststart tiny.mp4
ffmpeg -y -f lavfi -i color=c=orange:s=192x108 -frames:v 1 -q:v 12 tiny.jpg
base64 -i tiny.mp4 | tr -d '\n' > tiny.mp4.b64
base64 -i tiny.jpg | tr -d '\n' > tiny.jpg.b64
rm tiny.mp4 tiny.jpg
echo "fixtures regenerated"
```

- [ ] Step 16.4 — Ensure `playwright.config.ts` exists at the repo root. **If phase 01 already created one with a working `webServer`, keep it** and only confirm `workers: 1` and that the server starts with a FRESH database directory. If it does not exist, create exactly:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    // Dev server: no BODY_SIZE_LIMIT, non-Secure cookies over http (decision 18).
    command: 'rm -rf .e2e-data && mkdir -p .e2e-data/media && pnpm db:migrate && pnpm dev --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PLATFORM: 'node',
      DATABASE_PATH: '.e2e-data/shoebox.db',
      MEDIA_PATH: '.e2e-data/media',
      ORIGIN: 'http://localhost:4173',
      BODY_LIMIT_MB: '4096',
    },
  },
});
```

- [ ] Step 16.5 — Write `e2e/media-core.spec.ts` (complete file):

```ts
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ---- phase-01 seam constants (adjust ONLY these if phase 01 named fields differently)
const USERNAME_INPUT = 'input[name="username"]';
const PASSWORD_INPUT = 'input[name="password"]';
const SUBMIT_BUTTON = 'button[type="submit"]';
// ----

const USER = 'e2e-owner';
const PASS = 'shoebox-e2e-password-1';

const fixture = (name: string) =>
  Buffer.from(readFileSync(path.resolve('e2e/fixtures', name), 'utf8').trim(), 'base64');
const MP4 = fixture('tiny.mp4.b64');
const JPG = fixture('tiny.jpg.b64');

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/');
  if (page.url().includes('/setup')) {
    await page.fill(USERNAME_INPUT, USER);
    await page.fill(PASSWORD_INPUT, PASS);
    // some setup forms add a confirm field — fill it when present
    const confirm = page.locator(
      'input[name="confirm"], input[name="password2"], input[name="confirmPassword"]',
    );
    if (await confirm.count()) await confirm.first().fill(PASS);
    await page.click(SUBMIT_BUTTON);
  }
  if (page.url().includes('/login')) {
    await page.fill(USERNAME_INPUT, USER);
    await page.fill(PASSWORD_INPUT, PASS);
    await page.click(SUBMIT_BUTTON);
  }
  await expect(page).not.toHaveURL(/setup|login/);
}

async function addFilesAndWaitReady(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.setInputFiles('input[type="file"]', files);
  const statuses = page.getByTestId('row-status');
  for (let i = 0; i < files.length; i++) {
    await expect(statuses.nth(i)).toHaveText(/Ready|Already in archive/, { timeout: 30_000 });
  }
}

test('upload golden path: MP4 + JPEG land as items with correct DTOs', async ({ page }) => {
  await signIn(page);
  await page.goto('/upload');

  await addFilesAndWaitReady(page, [
    { name: 'tiny.mp4', mimeType: 'video/mp4', buffer: MP4 },
    { name: 'tiny.jpg', mimeType: 'image/jpeg', buffer: JPG },
  ]);

  const rows = page.getByTestId('upload-row');
  await expect(rows).toHaveCount(2);

  // Row 0 (mp4): year precision 1994
  const videoRow = rows.nth(0);
  await videoRow.getByRole('button', { name: 'Year', exact: true }).click();
  await videoRow.getByLabel('Year', { exact: true }).fill('1994');
  await videoRow.getByLabel('Title').fill('Sprinkler clip');

  // Row 1 (jpg): exact day 1994-06-14
  const photoRow = rows.nth(1);
  await photoRow.getByRole('button', { name: 'Exact day' }).click();
  await photoRow.getByLabel('Date', { exact: true }).fill('1994-06-14');

  await page.getByRole('button', { name: /Upload all/ }).click();
  await expect(rows.nth(0).getByTestId('row-status')).toHaveText('Done', { timeout: 60_000 });
  await expect(rows.nth(1).getByTestId('row-status')).toHaveText('Done', { timeout: 60_000 });

  // API: DTO shape per master Contract 6
  const res = await page.request.get('/api/items?limit=100');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.items).toHaveLength(2);
  expect(body.nextCursor).toBeNull();

  const video = body.items.find((i: { type: string }) => i.type === 'video');
  const photo = body.items.find((i: { type: string }) => i.type === 'photo');
  expect(video).toBeTruthy();
  expect(photo).toBeTruthy();

  expect(video.title).toBe('Sprinkler clip');
  expect(video.status).toBe('ready');
  expect(video.date).toEqual({ dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' });
  expect(video.displayDate).toBe('1994');
  expect(video.shortDate).toBe('c. 1994');
  expect(typeof video.blurhash).toBe('string');
  // duration is null only when the CI browser cannot demux h264 metadata
  expect(video.duration === null || video.duration > 0.5).toBe(true);

  expect(photo.status).toBe('ready');
  expect(photo.displayDate).toBe('June 14, 1994');
  expect(photo.shortDate).toBe('Jun 14');
  expect(photo.width).toBe(192);
  expect(photo.height).toBe(108);

  // derivative + original URLs resolve
  for (const url of [video.urls.poster, video.urls.thumb400, photo.urls.poster, photo.urls.thumb400]) {
    const r = await page.request.get(url);
    expect(r.status(), url).toBe(200);
  }

  // HTTP Range on the original → 206 with correct Content-Range
  const ranged = await page.request.get(video.urls.original, { headers: { range: 'bytes=0-99' } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()['content-range']).toBe(`bytes 0-99/${MP4.length}`);
  expect(ranged.headers()['accept-ranges']).toBe('bytes');
  expect((await ranged.body()).length).toBe(100);

  // timeline aggregate
  const tl = await page.request.get('/api/timeline');
  expect(await tl.json()).toEqual({
    years: [{ year: 1994, count: 2 }],
    earliest: 1994,
    latest: 1994,
  });
});

test('duplicate re-upload warns, allow-anyway stores a second copy', async ({ page }) => {
  await signIn(page);
  await page.goto('/upload');

  await addFilesAndWaitReady(page, [{ name: 'tiny.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
  await page.getByRole('button', { name: /Upload all/ }).click();

  const warning = page.getByTestId('dupe-warning');
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(warning).toContainText('already in the archive');
  await expect(warning.getByRole('link', { name: 'View existing item' })).toHaveAttribute(
    'href',
    /\/item\/.+/,
  );

  await warning.getByRole('button', { name: 'Upload anyway' }).click();
  await expect(page.getByTestId('row-status')).toHaveText('Done', { timeout: 60_000 });

  const res = await page.request.get('/api/items?limit=100');
  expect((await res.json()).items).toHaveLength(3);
});

test('trash: DELETE hides the item, restore brings it back', async ({ page }) => {
  await signIn(page);
  const list = await (await page.request.get('/api/items?type=photo')).json();
  const photoId = list.items[0].id;

  const del = await page.request.delete(`/api/items/${photoId}`);
  expect(del.status()).toBe(200);
  expect((await (await page.request.get('/api/items?limit=100')).json()).items).toHaveLength(2);
  expect((await page.request.get(`/api/items/${photoId}`)).status()).toBe(404);

  const restore = await page.request.post(`/api/items/${photoId}`, { data: { action: 'restore' } });
  expect(restore.status()).toBe(200);
  expect((await (await page.request.get('/api/items?limit=100')).json()).items).toHaveLength(3);
});
```

- [ ] Step 16.6 — Run `pnpm test:e2e e2e/media-core.spec.ts`. **Expected: 3 passed.** Debug notes if it fails:
  - Setup/login selector mismatch → fix ONLY the seam constants at the top of the spec.
  - `duplicateItemId` warning appearing in test 1 → the `.e2e-data` wipe in `webServer.command` did not run; verify the config used.
  - Poster black/duration null for the video is ACCEPTABLE (codec-less chromium fallback, decision in Task 13); everything else must match exactly.
- [ ] Step 16.7 — Full gates: `pnpm check && pnpm test && pnpm build` — all green, then run `pnpm test:e2e` once more from clean.
- [ ] Step 16.8 — Commit: `git add -A && git commit -m "test: e2e media-core golden path — upload, DTO, range streaming, dedupe, trash"`

---

## Final verification (self-review before declaring the phase done)

- [ ] **Scope**: every bullet of the phase-02 scope is implemented — dates.ts (Task 1), upload pipeline init/chunk/complete (4/6/9), client derivatives + blurhash + EXIF (13), /upload UI with DatePicker/people/tags/dedupe (14/15), item CRUD + ItemDTO (5/7/8/10), /media Range streaming + canAccessMedia seam (12), aggregates + /api/timeline (3/11), GET /api/people (11), trash semantics incl. restore (8/10), e2e (16).
- [ ] **Forbidden scope respected**: no timeline UI, no player UI, no FTS (`q` is LIKE-only with a phase-06 comment), no server-side derivative generation (jobs are only enqueued).
- [ ] **Contract audit** — grep and compare against the master: `ItemDTO` field names (`thumb400` not `thumb_400` in `urls`; `date.precision` not `datePrecision`), `chunkSize` 8 MiB, storage keys `media/<itemId>/<kind>.<ext>`, tmp keys `tmp/<uploadId>/<index>`, multipart field names `poster, thumb_400, thumb_800, thumb_1600, blurhash, meta`, `requireRole` usage on every route, `sortDate` midpoint semantics, circa strings `c. 1994` / `c. 1992–95`.
- [ ] **Placeholder scan**: `grep -rn "TODO\|TBD\|FIXME\|XXX" src/ e2e/` → only the deliberate `PHASE 08 SEAM` comment in `shares.ts` and phase-06/07 pointers are acceptable.
- [ ] **Portability**: `grep -rn "node:" src/lib/server --include='*.ts' | grep -v test | grep -v testing | grep -v platform/` → empty.
- [ ] `pnpm check && pnpm test && pnpm test:e2e && pnpm build` all green; conventional commits after each task.




