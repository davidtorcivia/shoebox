# Shoebox Phase 04 — The Item Room (Player + Photo Lightbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the item room at `/item/[id]` — a decade-tinted player page for videos (fully custom typographic chrome, J/K/L keyboard shuttle, auto-fading controls) and a photo lightbox (pinch/double-tap zoom), with the people/tags social band, right-rail provenance + story, prev/next navigation that preserves the timeline list context, and an inline metadata editor for editors+.

**Architecture:** One SvelteKit route (`src/routes/item/[id]/`) composes small, single-purpose UI components (`Player`, `ScrubTrack`, `Lightbox`, `PeopleRow`, `TagsRow`, `MetaForm`). All playback/keyboard/zoom logic lives in pure, unit-tested modules (`src/lib/domain/*`, `src/lib/ui/*-math.ts`, `player-keys.ts`); Svelte components are thin bindings over them. One new JSON endpoint is added in this phase: a neighbors resolver (`/api/items/[id]/neighbors`). Everything else is consumed from phases 01–03 exactly as specified in the master contracts: `playerRoomFor(year)` + `GRAIN_URI` from tokens, `ItemDTO` from `GET /api/items/[id]`, `/media/[...key]` Range streaming, and list-context URLs (`/item/[id]?y=1994&people=…`) produced by the timeline. Comments are intentionally deferred to Phase 05, where the master plan assigns comments and comment identity polish.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM (SQLite/D1), Vitest, Playwright, Fraunces + Archivo (already self-hosted from phase 01), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` §10 "The player" is the visual gospel. **Locked mockup:** `docs/superpowers/specs/mockups/player-locked.html` — every visual task below ends with a verification checklist against it. Match it precisely (the mockup's Georgia/Helvetica Neue stand-ins map to Fraunces/Archivo via `FONT.serif`/`FONT.sans`).

## Global Constraints

Copied verbatim from the master plan. Every task's requirements implicitly include this section.

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

**Master:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts (schema, platform interfaces, auth, tokens, domain signatures, API table, storage keys) are LAW. If anything in this plan conflicts with the master, the master wins.

**Phase-boundary rules for this plan:**

- FORBIDDEN here: comments API/UI (phase 05), share-token access paths (phase 08), and face-box UI (phase 09). The neighbors endpoint requires an authenticated session (`requireRole(locals, 'user')`); no `share` scoping in this phase.
- Consumed from phases 01–03 (do not reimplement): `tokens.ts` (`INK`, `CREAM`, `DAWN`, `ACCENTS`, `GRAIN_URI`, `FONT`, `MOTION`, `playerRoomFor(year)`), `theme.ts` (`reducedMotion` readable store), `$lib/domain/dates` (`ItemDate`, `yearOf`, `displayDate`), `DatePicker.svelte`, `GET /api/items/[id]` → `ItemDTO` JSON, `PATCH /api/items/[id]`, `GET /api/items`, `/media/[...key]` streaming, `requireRole` from `$lib/server/roles`, the Drizzle schema from `$lib/server/db/schema`, and timeline cards linking to `/item/[id]?y=YYYY&…`.

## Resolved contract ambiguities (decisions binding for this plan)

1. **Neighbor context filters:** `people`, `tags` (csv of IDs), `type`, `album` filter the prev/next sequence; `y` is a scroll position, NOT a neighbor filter (the timeline scrolls across year boundaries, so prev/next must too). `y` is still used for the "← Back to {year}" label and preserved in all hrefs.
2. **Eyebrow `{source}` label:** `items.source` renders as `Upload` / `Ingest` (schema has no medium field; the mockup's "Hi-8" is sample tape metadata). Weekday appears only for `day`-precision dates. Segments join with `·` and empty segments are dropped.
3. **`GET /api/items/[id]` response shape:** consumed defensively as `body.item ?? body` (phase 02 returns the `ItemDTO`; this tolerates either bare or wrapped).
4. **`source` is not in `ItemDTO`** (Contract 6 is law), so `+page.server.ts` reads that one column directly from `locals.db`.
5. **Comments boundary:** The player room reserves layout space where comments will appear, but this phase does not create `src/lib/server/comments.ts`, `src/lib/ui/Comments.svelte`, or any `/api/items/[id]/comments` routes. Phase 05 owns the comments implementation per the master phase table.
6. **Tokens additions (additive only):** `DAWN_PALE = '#FFD9A8'` (tag-link color, mockup line `.tags span { color: #FFD9A8 }`) and `accentOn(hex)` (returns `INK`/`CREAM` per the `ACCENTS[].on` pairing) are added to `tokens.ts`. The master forbids schema additions; token additions are permitted and keep hex out of components.
7. **Shared DTO types:** `src/lib/dto.ts` (client-safe, non-server module) declares or re-exports `ItemDTO` exactly matching Contract 6. If phase 02 already exports `ItemDTO` from a client-safe module, re-export it from `src/lib/dto.ts` instead of redeclaring — the import site for all phase-04 code stays `$lib/dto`.
8. **L shuttle** ramps ×1 → ×2 and caps at ×2; **J** is always reverse ×2 (HTMLVideoElement can't play backward, so reverse = seek-stepping −0.2 s every 100 ms). **K** pauses. The `1×` button cycles 0.5 → 1 → 1.5 → 2 → 0.5 independently.
9. **PATCH payload** sent by the edit panel: `{ title, description, dateStart, dateEnd, datePrecision, tapeLabel, people: string[] /* person ids */, tags: string[] /* tag names, lowercased */ }` — matches Contract 6 "PATCH: metadata".
10. **Player room background** is composed directly from `playerRoomFor(year)` (`radial-gradient(80% 60% at 100% 0%, ${pool} 0%, transparent 60%), linear-gradient(160deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 100%)`) + `GRAIN_URI` overlay, matching mockup lines 7–12 exactly. `Gradient.svelte` is not reused here (its API serves the timeline's crossfading decade rooms; the player room is a single static composition).

## File Structure

```
src/lib/dto.ts                                    # ItemDTO type (client-safe)
src/lib/domain/timecode.ts        (+ .test.ts)    # formatTimecode(seconds) → "00:12" / "1:01:01"
src/lib/domain/provenance.ts      (+ .test.ts)    # weekdayOf(ItemDate), eyebrowFor(date, source, tapeLabel)
src/lib/domain/shuttle.ts         (+ .test.ts)    # J/K/L state machine, togglePlay, RATES, nextRate
src/lib/ui/player-keys.ts         (+ .test.ts)    # window keymap → PlayerAction union; isTypingTag guard
src/lib/ui/scrub-math.ts          (+ .test.ts)    # pointer→time math for ScrubTrack
src/lib/ui/zoom-math.ts           (+ .test.ts)    # pinch/double-tap scale + pan clamping for Lightbox
src/lib/ui/ScrubTrack.svelte                      # 8px rail / buffered / dawn elapsed / 4×28 playhead slider
src/lib/ui/Player.svelte                          # <video> + all custom chrome, autohide, load/error states
src/lib/ui/Lightbox.svelte                        # photo stage: pinch-zoom, double-tap, pan
src/lib/ui/PeopleRow.svelte                       # "People" label row: 19px avatars + serif names + age
src/lib/ui/TagsRow.svelte                         # "Tags" label row: dawn-pale serif links + albums
src/lib/ui/MetaForm.svelte                        # shared metadata form (DatePicker + people/tags chips)
src/lib/ui/tokens.ts                              # MODIFY (additive): DAWN_PALE, accentOn()
src/lib/server/neighbors.ts       (+ .test.ts)    # neighborsOf(db, itemId, ctx), contextFromParams
src/lib/server/db/test-db.ts                      # in-memory SQLite + migrations for unit tests (test-only)
src/routes/api/items/[id]/neighbors/+server.ts    # GET → { prevId, nextId }
src/routes/item/[id]/+page.server.ts              # load: ItemDTO + neighbors + source + me
src/routes/item/[id]/+page.svelte                 # the room: top bar, stage, edges, keyboard, mobile
e2e/helpers/seed-player.ts                        # DB + media fixture seeding (WebM clip, photo, session)
e2e/player.spec.ts                                # golden-path e2e
```

`src/lib/server/db/test-db.ts` imports `better-sqlite3`: it is imported ONLY from `*.test.ts` files (never from runtime code), exactly like phase 01's platform contract tests — the runtime-portability constraint governs shipped server code, and this file is never bundled.

---

### Task 1: Formatting domain helpers — timecode and provenance eyebrow

**Files:**
- Create: `src/lib/domain/timecode.ts`
- Create: `src/lib/domain/timecode.test.ts`
- Create: `src/lib/domain/provenance.ts`
- Create: `src/lib/domain/provenance.test.ts`

**Interfaces:**
- Consumes: `ItemDate` from `$lib/domain/dates` (Contract 5: `{ dateStart: string|null; dateEnd: string|null; precision: 'day'|'month'|'year'|'range'|'unknown' }`).
- Produces:
  - `formatTimecode(seconds: number): string` — `"00:12"`, `"01:01"`, `"1:01:01"`; NaN/negative → `"00:00"`.
  - `weekdayOf(d: ItemDate): string | null` — `"Tuesday"` for day-precision dates, else `null`.
  - `eyebrowFor(d: ItemDate, source: 'upload'|'ingest', tapeLabel: string|null): string` — `"Tuesday · Ingest · Tape 04"`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/domain/timecode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTimecode } from './timecode';

describe('formatTimecode', () => {
  it('formats zero', () => expect(formatTimecode(0)).toBe('00:00'));
  it('formats sub-minute', () => expect(formatTimecode(12)).toBe('00:12'));
  it('formats the mockup pair', () => {
    expect(formatTimecode(12)).toBe('00:12');
    expect(formatTimecode(42)).toBe('00:42');
  });
  it('floors fractional seconds', () => expect(formatTimecode(61.94)).toBe('01:01'));
  it('formats hours without zero-padding the hour', () =>
    expect(formatTimecode(3661)).toBe('1:01:01'));
  it('clamps negatives to zero', () => expect(formatTimecode(-5)).toBe('00:00'));
  it('treats NaN/Infinity as zero', () => {
    expect(formatTimecode(NaN)).toBe('00:00');
    expect(formatTimecode(Infinity)).toBe('00:00');
  });
});
```

Create `src/lib/domain/provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eyebrowFor, weekdayOf } from './provenance';
import type { ItemDate } from './dates';

const day = (iso: string): ItemDate => ({ dateStart: iso, dateEnd: iso, precision: 'day' });

describe('weekdayOf', () => {
  it('June 14, 1994 is a Tuesday', () => expect(weekdayOf(day('1994-06-14'))).toBe('Tuesday'));
  it('null for month precision', () =>
    expect(weekdayOf({ dateStart: '1994-06-01', dateEnd: '1994-06-30', precision: 'month' })).toBeNull());
  it('null for unknown', () =>
    expect(weekdayOf({ dateStart: null, dateEnd: null, precision: 'unknown' })).toBeNull());
});

describe('eyebrowFor', () => {
  it('full provenance', () =>
    expect(eyebrowFor(day('1994-06-14'), 'ingest', 'Tape 04')).toBe('Tuesday · Ingest · Tape 04'));
  it('drops weekday when not day-precision', () =>
    expect(eyebrowFor({ dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' }, 'upload', null)).toBe('Upload'));
  it('drops missing tape label', () =>
    expect(eyebrowFor(day('1994-06-14'), 'upload', null)).toBe('Tuesday · Upload'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/domain/timecode.test.ts src/lib/domain/provenance.test.ts`
Expected: FAIL — `Cannot find module './timecode'` (and sibling).

- [ ] **Step 3: Implement the two modules**

Create `src/lib/domain/timecode.ts`:

```ts
/** "00:12", "01:01", "1:01:01" — tabular sans timecode text for the player chrome. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

Create `src/lib/domain/provenance.ts`:

```ts
import type { ItemDate } from './dates';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Weekday name for day-precision dates only ("Tuesday"), else null. */
export function weekdayOf(d: ItemDate): string | null {
  if (d.precision !== 'day' || !d.dateStart) return null;
  const dt = new Date(`${d.dateStart}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return WEEKDAYS[dt.getUTCDay()];
}

/** Right-rail eyebrow: "Tuesday · Ingest · Tape 04" — empty segments dropped. */
export function eyebrowFor(d: ItemDate, source: 'upload' | 'ingest', tapeLabel: string | null): string {
  const parts: string[] = [];
  const wd = weekdayOf(d);
  if (wd) parts.push(wd);
  parts.push(source === 'ingest' ? 'Ingest' : 'Upload');
  if (tapeLabel) parts.push(tapeLabel);
  return parts.join(' · ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/domain/timecode.test.ts src/lib/domain/provenance.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm check` — expected: 0 errors.

```bash
git add src/lib/domain/timecode.ts src/lib/domain/timecode.test.ts src/lib/domain/provenance.ts src/lib/domain/provenance.test.ts
git commit -m "feat: add timecode and provenance-eyebrow domain helpers"
```

---

### Task 2: J/K/L shuttle state machine + playback-rate cycle

**Files:**
- Create: `src/lib/domain/shuttle.ts`
- Create: `src/lib/domain/shuttle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by `Player.svelte` in Task 7 and the page in Task 12):
  - `type Shuttle = { mode: 'pause' } | { mode: 'forward'; rate: 1 | 2 } | { mode: 'reverse'; rate: 2 }`
  - `const SHUTTLE_PAUSED: Shuttle`
  - `shuttleNext(s: Shuttle, key: 'J' | 'K' | 'L'): Shuttle`
  - `togglePlay(s: Shuttle): Shuttle` — pause ⇄ forward ×1 (any moving state → pause).
  - `const RATES: readonly [0.5, 1, 1.5, 2]`
  - `nextRate(rate: number): number` — cycles 0.5 → 1 → 1.5 → 2 → 0.5; unknown input → 1.

- [ ] **Step 1: Write the failing test**

Create `src/lib/domain/shuttle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RATES, SHUTTLE_PAUSED, nextRate, shuttleNext, togglePlay, type Shuttle } from './shuttle';

const fwd = (rate: 1 | 2): Shuttle => ({ mode: 'forward', rate });
const rev: Shuttle = { mode: 'reverse', rate: 2 };

describe('shuttleNext', () => {
  it('K always pauses', () => {
    expect(shuttleNext(fwd(2), 'K')).toEqual({ mode: 'pause' });
    expect(shuttleNext(rev, 'K')).toEqual({ mode: 'pause' });
    expect(shuttleNext(SHUTTLE_PAUSED, 'K')).toEqual({ mode: 'pause' });
  });
  it('L from pause plays forward ×1', () => expect(shuttleNext(SHUTTLE_PAUSED, 'L')).toEqual(fwd(1)));
  it('L from forward ×1 ramps to ×2', () => expect(shuttleNext(fwd(1), 'L')).toEqual(fwd(2)));
  it('L caps at ×2', () => expect(shuttleNext(fwd(2), 'L')).toEqual(fwd(2)));
  it('L from reverse switches to forward ×1', () => expect(shuttleNext(rev, 'L')).toEqual(fwd(1)));
  it('J always reverses at ×2', () => {
    expect(shuttleNext(SHUTTLE_PAUSED, 'J')).toEqual(rev);
    expect(shuttleNext(fwd(2), 'J')).toEqual(rev);
    expect(shuttleNext(rev, 'J')).toEqual(rev);
  });
});

describe('togglePlay', () => {
  it('pause → forward ×1', () => expect(togglePlay(SHUTTLE_PAUSED)).toEqual(fwd(1)));
  it('forward → pause', () => expect(togglePlay(fwd(2))).toEqual({ mode: 'pause' }));
  it('reverse → pause', () => expect(togglePlay(rev)).toEqual({ mode: 'pause' }));
});

describe('nextRate', () => {
  it('cycles the documented ladder', () => {
    expect(RATES).toEqual([0.5, 1, 1.5, 2]);
    expect(nextRate(0.5)).toBe(1);
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(0.5);
  });
  it('unknown rate resets to 1', () => expect(nextRate(3)).toBe(1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/domain/shuttle.test.ts`
Expected: FAIL — `Cannot find module './shuttle'`.

- [ ] **Step 3: Implement `src/lib/domain/shuttle.ts`**

```ts
/**
 * J/K/L shuttle state machine (spec §10). HTMLVideoElement cannot play
 * backward, so 'reverse' is realised by the Player as seek-stepping
 * (currentTime -= 0.2 every 100 ms ≙ reverse ×2).
 */
export type Shuttle =
  | { mode: 'pause' }
  | { mode: 'forward'; rate: 1 | 2 }
  | { mode: 'reverse'; rate: 2 };

export const SHUTTLE_PAUSED: Shuttle = { mode: 'pause' };

export function shuttleNext(s: Shuttle, key: 'J' | 'K' | 'L'): Shuttle {
  switch (key) {
    case 'K':
      return { mode: 'pause' };
    case 'L':
      if (s.mode === 'forward') return { mode: 'forward', rate: 2 };
      return { mode: 'forward', rate: 1 };
    case 'J':
      return { mode: 'reverse', rate: 2 };
  }
}

/** Space bar: pause ⇄ forward ×1. */
export function togglePlay(s: Shuttle): Shuttle {
  return s.mode === 'pause' ? { mode: 'forward', rate: 1 } : { mode: 'pause' };
}

/** The "1×" control's rate ladder. */
export const RATES = [0.5, 1, 1.5, 2] as const;

export function nextRate(rate: number): number {
  const i = (RATES as readonly number[]).indexOf(rate);
  if (i === -1) return 1;
  return RATES[(i + 1) % RATES.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/domain/shuttle.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/shuttle.ts src/lib/domain/shuttle.test.ts
git commit -m "feat: add J/K/L shuttle state machine and playback-rate cycle"
```

---

### Task 3: Player keyboard map

**Files:**
- Create: `src/lib/ui/player-keys.ts`
- Create: `src/lib/ui/player-keys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by `Player.svelte` Task 7 and `+page.svelte` Task 12):
  - `type PlayerAction = { type: 'toggle-play' } | { type: 'shuttle'; key: 'J'|'K'|'L' } | { type: 'seek-by'; seconds: number } | { type: 'step'; direction: -1|1 } | { type: 'prev-item' } | { type: 'next-item' } | { type: 'fullscreen' } | { type: 'mute' } | { type: 'close' }`
  - `const FRAME_STEP: number` — `1/30` s.
  - `mapPlayerKey(key: string, ctx: { paused: boolean; isVideo: boolean }): PlayerAction | null`
  - `isTypingTag(tagName: string, isContentEditable: boolean): boolean` — DOM-free guard so keys never fire while typing in inputs.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/player-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FRAME_STEP, isTypingTag, mapPlayerKey } from './player-keys';

const video = { paused: false, isVideo: true };
const videoPaused = { paused: true, isVideo: true };
const photo = { paused: true, isVideo: false };

describe('mapPlayerKey — video actions', () => {
  it('space toggles play', () => expect(mapPlayerKey(' ', video)).toEqual({ type: 'toggle-play' }));
  it('J/K/L shuttle (case-insensitive)', () => {
    expect(mapPlayerKey('j', video)).toEqual({ type: 'shuttle', key: 'J' });
    expect(mapPlayerKey('K', video)).toEqual({ type: 'shuttle', key: 'K' });
    expect(mapPlayerKey('l', video)).toEqual({ type: 'shuttle', key: 'L' });
  });
  it('arrows seek 5s while playing', () => {
    expect(mapPlayerKey('ArrowLeft', video)).toEqual({ type: 'seek-by', seconds: -5 });
    expect(mapPlayerKey('ArrowRight', video)).toEqual({ type: 'seek-by', seconds: 5 });
  });
  it('arrows frame-step (1/30s) while paused', () => {
    expect(mapPlayerKey('ArrowLeft', videoPaused)).toEqual({ type: 'step', direction: -1 });
    expect(mapPlayerKey('ArrowRight', videoPaused)).toEqual({ type: 'step', direction: 1 });
    expect(FRAME_STEP).toBeCloseTo(1 / 30);
  });
  it('F fullscreen, M mute', () => {
    expect(mapPlayerKey('f', video)).toEqual({ type: 'fullscreen' });
    expect(mapPlayerKey('m', video)).toEqual({ type: 'mute' });
  });
});

describe('mapPlayerKey — room actions (photos too)', () => {
  it('up/down are prev/next item', () => {
    expect(mapPlayerKey('ArrowUp', photo)).toEqual({ type: 'prev-item' });
    expect(mapPlayerKey('ArrowDown', photo)).toEqual({ type: 'next-item' });
  });
  it('Escape closes', () => expect(mapPlayerKey('Escape', photo)).toEqual({ type: 'close' }));
  it('video-only keys are inert on photos', () => {
    expect(mapPlayerKey(' ', photo)).toBeNull();
    expect(mapPlayerKey('j', photo)).toBeNull();
    expect(mapPlayerKey('f', photo)).toBeNull();
    expect(mapPlayerKey('m', photo)).toBeNull();
    expect(mapPlayerKey('ArrowLeft', photo)).toBeNull();
  });
  it('unmapped keys are null', () => expect(mapPlayerKey('x', video)).toBeNull());
});

describe('isTypingTag', () => {
  it('inputs, textareas, selects and contenteditable are typing targets', () => {
    expect(isTypingTag('INPUT', false)).toBe(true);
    expect(isTypingTag('TEXTAREA', false)).toBe(true);
    expect(isTypingTag('SELECT', false)).toBe(true);
    expect(isTypingTag('DIV', true)).toBe(true);
  });
  it('everything else is not', () => {
    expect(isTypingTag('DIV', false)).toBe(false);
    expect(isTypingTag('BUTTON', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/player-keys.test.ts`
Expected: FAIL — `Cannot find module './player-keys'`.

- [ ] **Step 3: Implement `src/lib/ui/player-keys.ts`**

```ts
/** Window-scoped keyboard map for the item room (spec §10). */
export type PlayerAction =
  | { type: 'toggle-play' }
  | { type: 'shuttle'; key: 'J' | 'K' | 'L' }
  | { type: 'seek-by'; seconds: number }
  | { type: 'step'; direction: -1 | 1 }
  | { type: 'prev-item' }
  | { type: 'next-item' }
  | { type: 'fullscreen' }
  | { type: 'mute' }
  | { type: 'close' };

export const FRAME_STEP = 1 / 30;

/** True when key events must be ignored (user is typing). DOM-free for unit tests. */
export function isTypingTag(tagName: string, isContentEditable: boolean): boolean {
  if (isContentEditable) return true;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function mapPlayerKey(
  key: string,
  ctx: { paused: boolean; isVideo: boolean }
): PlayerAction | null {
  switch (key) {
    case ' ':
      return ctx.isVideo ? { type: 'toggle-play' } : null;
    case 'j':
    case 'J':
      return ctx.isVideo ? { type: 'shuttle', key: 'J' } : null;
    case 'k':
    case 'K':
      return ctx.isVideo ? { type: 'shuttle', key: 'K' } : null;
    case 'l':
    case 'L':
      return ctx.isVideo ? { type: 'shuttle', key: 'L' } : null;
    case 'ArrowLeft':
      if (!ctx.isVideo) return null;
      return ctx.paused ? { type: 'step', direction: -1 } : { type: 'seek-by', seconds: -5 };
    case 'ArrowRight':
      if (!ctx.isVideo) return null;
      return ctx.paused ? { type: 'step', direction: 1 } : { type: 'seek-by', seconds: 5 };
    case 'ArrowUp':
      return { type: 'prev-item' };
    case 'ArrowDown':
      return { type: 'next-item' };
    case 'f':
    case 'F':
      return ctx.isVideo ? { type: 'fullscreen' } : null;
    case 'm':
    case 'M':
      return ctx.isVideo ? { type: 'mute' } : null;
    case 'Escape':
      return { type: 'close' };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/player-keys.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/player-keys.ts src/lib/ui/player-keys.test.ts
git commit -m "feat: add item-room keyboard map with typing guard"
```

---

### Task 4: Shared ItemDTO import and migrated test DB helper

**Files:**
- Create: `src/lib/dto.ts`
- Create: `src/lib/server/db/test-db.ts`

**Interfaces:**
- Consumes: Contract 6 `ItemDTO` shape; Drizzle schema/migrations from Phase 01.
- Produces:
  - `src/lib/dto.ts`: `ItemDTO` exactly matching Contract 6, or a re-export of the client-safe `ItemDTO` module created in Phase 02.
  - `createTestDb(): Db` from `$lib/server/db/test-db` (in-memory SQLite with all migrations applied) for this and later unit tests.

- [ ] **Step 1: Create the shared DTO types**

Create `src/lib/dto.ts` (client-safe — imports nothing from `$lib/server`). If phase 02 already exports `ItemDTO` from a client-safe module, replace the `ItemDTO` declaration below with `export type { ItemDTO } from '<that module>';` — every phase-04 import site uses `$lib/dto` either way.

```ts
import type { ItemDate } from '$lib/domain/dates';

/** Contract 6 ItemDTO — must stay byte-compatible with the master plan. */
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
  people: { id: string; name: string; accentColor: string; age?: number | null }[];
  tags: { id: string; name: string; kind: 'topic' | 'holiday' }[];
  albums: { id: string; title: string }[];
  uploadedBy: string;
  tapeLabel: string | null;
}

```

- [ ] **Step 2: Create the unit-test database helper**

Create `src/lib/server/db/test-db.ts`. Test-only: imported exclusively from `*.test.ts` files, never bundled (same pattern as phase 01's SQLite platform contract tests). Skip this step only if phase 01 already created an identical helper — then import that one from the tests below instead.

```ts
/**
 * TEST-ONLY helper. Never import from runtime code — better-sqlite3 is
 * banned in shipped server modules (master Global Constraints).
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
```

- [ ] **Step 3: Typecheck, full unit run, commit**

Run: `pnpm check` — expected: 0 errors.
Run: `pnpm vitest run` — expected: all suites PASS.

```bash
git add src/lib/dto.ts src/lib/server/db/test-db.ts
git commit -m "chore: add item DTO re-export and migrated test DB helper"
```

---

### Task 5: Neighbors query + `/api/items/[id]/neighbors` endpoint

**Files:**
- Create: `src/lib/server/neighbors.ts`
- Create: `src/lib/server/neighbors.test.ts`
- Create: `src/routes/api/items/[id]/neighbors/+server.ts`

**Interfaces:**
- Consumes: schema tables `items`, `itemPeople`, `itemTags`, `albumItems`, `users`, `people`, `tags` (Contract 1); `createTestDb` from Task 4; `requireRole` (Contract 3).
- Produces (consumed by `+page.server.ts` in Task 12):
  - `type NeighborContext = { people?: string[]; tags?: string[]; type?: 'video'|'photo'; album?: string }`
  - `contextFromParams(sp: URLSearchParams): NeighborContext` — reads `people`, `tags` (csv of ids), `type`, `album`; ignores `y`.
  - `neighborsOf(db: Db, itemId: string, ctx: NeighborContext): Promise<{ prevId: string | null; nextId: string | null }>`
  - Endpoint: `GET /api/items/[id]/neighbors?people=…&tags=…&type=…&album=…` → `{ prevId, nextId }`.
- Ordering LAW (must mirror the timeline's chronological list): ascending by `(coalesce(sort_date, '9999-12-31'), id)`; only `status='ready'`, `deleted_at IS NULL` items participate.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/neighbors.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db/test-db';
import { itemPeople, items, people, users } from './db/schema';
import { contextFromParams, neighborsOf } from './neighbors';

let db: TestDb;

function seedItem(id: string, sortDate: string | null, opts: Partial<{ type: 'video'|'photo'; status: 'ready'|'needs_review'; deleted: boolean }> = {}) {
  db.insert(items).values({
    id, type: opts.type ?? 'video',
    datePrecision: sortDate ? 'day' : 'unknown',
    dateStart: sortDate, dateEnd: sortDate, sortDate,
    width: 640, height: 360, sizeBytes: 1, sha256: `sha_${id}`,
    source: 'upload', status: opts.status ?? 'ready', uploadedBy: 'u_owner00000',
    deletedAt: opts.deleted ? new Date() : null, createdAt: new Date(),
  }).run();
}

beforeEach(() => {
  db = createTestDb();
  db.insert(users).values({
    id: 'u_owner00000', username: 'own', passwordHash: 'pbkdf2$310000$x$x', role: 'owner',
    accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: new Date(),
  }).run();
  db.insert(people).values({ id: 'p_eric000000', name: 'Eric', accentColor: '#FA7B62', createdAt: new Date() }).run();
  seedItem('it_a', '1994-06-10');
  seedItem('it_b', '1994-06-14');
  seedItem('it_c', '1994-06-20', { type: 'photo' });
  seedItem('it_d', '1995-01-02');
  seedItem('it_hidden', '1994-06-12', { status: 'needs_review' });
  seedItem('it_gone', '1994-06-13', { deleted: true });
  db.insert(itemPeople).values([
    { itemId: 'it_a', personId: 'p_eric000000', source: 'manual' },
    { itemId: 'it_c', personId: 'p_eric000000', source: 'manual' },
  ]).run();
});

describe('neighborsOf', () => {
  it('walks chronological order, skipping non-ready and deleted', async () => {
    expect(await neighborsOf(db, 'it_b', {})).toEqual({ prevId: 'it_a', nextId: 'it_c' });
  });
  it('crosses year boundaries (y is not a filter)', async () => {
    expect(await neighborsOf(db, 'it_c', {})).toEqual({ prevId: 'it_b', nextId: 'it_d' });
  });
  it('nulls at the edges', async () => {
    expect(await neighborsOf(db, 'it_a', {})).toEqual({ prevId: null, nextId: 'it_b' });
    expect(await neighborsOf(db, 'it_d', {})).toEqual({ prevId: 'it_c', nextId: null });
  });
  it('applies people filter', async () => {
    expect(await neighborsOf(db, 'it_a', { people: ['p_eric000000'] }))
      .toEqual({ prevId: null, nextId: 'it_c' });
  });
  it('applies type filter', async () => {
    expect(await neighborsOf(db, 'it_b', { type: 'video' }))
      .toEqual({ prevId: 'it_a', nextId: 'it_d' });
  });
  it('unknown item → both null', async () => {
    expect(await neighborsOf(db, 'it_nope', {})).toEqual({ prevId: null, nextId: null });
  });
  it('ties on sort_date break by id', async () => {
    seedItem('it_b2', '1994-06-14');
    expect((await neighborsOf(db, 'it_b', {})).nextId).toBe('it_b2');
    expect((await neighborsOf(db, 'it_b2', {})).prevId).toBe('it_b');
  });
});

describe('contextFromParams', () => {
  it('parses csv ids and ignores y', () => {
    const sp = new URLSearchParams('y=1994&people=p_a,p_b&tags=t_x&type=video&album=al_1');
    expect(contextFromParams(sp)).toEqual({
      people: ['p_a', 'p_b'], tags: ['t_x'], type: 'video', album: 'al_1',
    });
  });
  it('empty params → empty context', () => {
    expect(contextFromParams(new URLSearchParams(''))).toEqual({});
  });
  it('rejects junk type values', () => {
    expect(contextFromParams(new URLSearchParams('type=banana'))).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/neighbors.test.ts`
Expected: FAIL — `Cannot find module './neighbors'`.

- [ ] **Step 3: Implement `src/lib/server/neighbors.ts`**

```ts
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { items } from './db/schema';

type Db = App.Locals['db'];

export type NeighborContext = {
  people?: string[];
  tags?: string[];
  type?: 'video' | 'photo';
  album?: string;
};

/**
 * List-context params carried on /item/[id] URLs. `y` deliberately excluded:
 * it is a timeline scroll position, and prev/next must cross year boundaries.
 */
export function contextFromParams(sp: URLSearchParams): NeighborContext {
  const csv = (k: string) => {
    const v = sp.get(k)?.split(',').map((s) => s.trim()).filter(Boolean);
    return v && v.length > 0 ? v : undefined;
  };
  const rawType = sp.get('type');
  const ctx: NeighborContext = {};
  const people = csv('people');
  const tags = csv('tags');
  if (people) ctx.people = people;
  if (tags) ctx.tags = tags;
  if (rawType === 'video' || rawType === 'photo') ctx.type = rawType;
  const album = sp.get('album');
  if (album) ctx.album = album;
  return ctx;
}

/** LAST-DATE sentinel keeps undated items at the end of the sequence. */
const KEY = sql<string>`coalesce(${items.sortDate}, '9999-12-31')`;

function baseConds(ctx: NeighborContext): SQL[] {
  const conds: SQL[] = [eq(items.status, 'ready'), isNull(items.deletedAt)];
  if (ctx.type) conds.push(eq(items.type, ctx.type));
  for (const pid of ctx.people ?? []) {
    conds.push(sql`exists (select 1 from item_people ip where ip.item_id = ${items.id} and ip.person_id = ${pid})`);
  }
  for (const tid of ctx.tags ?? []) {
    conds.push(sql`exists (select 1 from item_tags it where it.item_id = ${items.id} and it.tag_id = ${tid})`);
  }
  if (ctx.album) {
    conds.push(sql`exists (select 1 from album_items ai where ai.item_id = ${items.id} and ai.album_id = ${ctx.album})`);
  }
  return conds;
}

export async function neighborsOf(
  db: Db,
  itemId: string,
  ctx: NeighborContext
): Promise<{ prevId: string | null; nextId: string | null }> {
  const [cur] = await db
    .select({ id: items.id, sortDate: items.sortDate })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!cur) return { prevId: null, nextId: null };
  const curKey = cur.sortDate ?? '9999-12-31';
  const conds = baseConds(ctx);

  const [next] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(...conds, sql`(${KEY} > ${curKey} or (${KEY} = ${curKey} and ${items.id} > ${itemId}))`))
    .orderBy(asc(KEY), asc(items.id))
    .limit(1);

  const [prev] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(...conds, sql`(${KEY} < ${curKey} or (${KEY} = ${curKey} and ${items.id} < ${itemId}))`))
    .orderBy(desc(KEY), desc(items.id))
    .limit(1);

  return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/neighbors.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Add the endpoint**

Create `src/routes/api/items/[id]/neighbors/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { contextFromParams, neighborsOf } from '$lib/server/neighbors';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  requireRole(locals, 'user');
  const ctx = contextFromParams(url.searchParams);
  return json(await neighborsOf(locals.db, params.id, ctx));
};
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm check` — expected: 0 errors.
Run: `pnpm vitest run` — expected: all suites PASS.

```bash
git add src/lib/server/neighbors.ts src/lib/server/neighbors.test.ts "src/routes/api/items/[id]/neighbors"
git commit -m "feat: add list-context neighbors query and endpoint"
```

---

### Task 6: ScrubTrack.svelte — the seek slider

**Files:**
- Create: `src/lib/ui/scrub-math.ts`
- Create: `src/lib/ui/scrub-math.test.ts`
- Create: `src/lib/ui/ScrubTrack.svelte`

**Interfaces:**
- Consumes: `CREAM`, `DAWN` from `$lib/ui/tokens`; `formatTimecode` (Task 1).
- Produces:
  - `timeFromClientX(clientX: number, rect: { left: number; width: number }, duration: number): number` (clamped 0…duration).
  - `fractionOf(time: number, duration: number): number` (clamped 0…1; 0 when duration ≤ 0).
  - `ScrubTrack` component, props: `{ duration: number; currentTime: number; buffered?: number; onseek: (t: number) => void }`. Renders `role="slider"` with `aria-label="Seek"`; click/drag seeks with pointer capture; ←/→ ±5 s, Home/End (with `stopPropagation` so the page keymap doesn't double-fire).

- [ ] **Step 1: Write the failing math test**

Create `src/lib/ui/scrub-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fractionOf, timeFromClientX } from './scrub-math';

const rect = { left: 100, width: 400 };

describe('timeFromClientX', () => {
  it('maps pointer position linearly', () => {
    expect(timeFromClientX(100, rect, 42)).toBe(0);
    expect(timeFromClientX(300, rect, 42)).toBe(21);
    expect(timeFromClientX(500, rect, 42)).toBe(42);
  });
  it('clamps outside the rail', () => {
    expect(timeFromClientX(0, rect, 42)).toBe(0);
    expect(timeFromClientX(900, rect, 42)).toBe(42);
  });
  it('degenerate rail or duration → 0', () => {
    expect(timeFromClientX(300, { left: 0, width: 0 }, 42)).toBe(0);
    expect(timeFromClientX(300, rect, 0)).toBe(0);
  });
});

describe('fractionOf', () => {
  it('mockup state: 12s of 42s ≈ 29%', () => expect(fractionOf(12, 42)).toBeCloseTo(0.2857, 3));
  it('clamps', () => {
    expect(fractionOf(-1, 42)).toBe(0);
    expect(fractionOf(99, 42)).toBe(1);
    expect(fractionOf(10, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/scrub-math.test.ts`
Expected: FAIL — `Cannot find module './scrub-math'`.

- [ ] **Step 3: Implement `src/lib/ui/scrub-math.ts`**

```ts
export function fractionOf(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, time / duration));
}

export function timeFromClientX(
  clientX: number,
  rect: { left: number; width: number },
  duration: number
): number {
  if (!Number.isFinite(duration) || duration <= 0 || rect.width <= 0) return 0;
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return frac * duration;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/scrub-math.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement `src/lib/ui/ScrubTrack.svelte` (complete file)**

```svelte
<script lang="ts">
  import { CREAM, DAWN } from '$lib/ui/tokens';
  import { formatTimecode } from '$lib/domain/timecode';
  import { fractionOf, timeFromClientX } from './scrub-math';

  let {
    duration,
    currentTime,
    buffered = 0,
    onseek
  }: {
    duration: number;
    currentTime: number;
    buffered?: number;
    onseek: (t: number) => void;
  } = $props();

  let track: HTMLDivElement;
  let dragging = $state(false);

  const frac = $derived(fractionOf(currentTime, duration));
  const bufFrac = $derived(fractionOf(buffered, duration));

  function seekAt(clientX: number) {
    onseek(timeFromClientX(clientX, track.getBoundingClientRect(), duration));
  }
  function onpointerdown(e: PointerEvent) {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seekAt(e.clientX);
  }
  function onpointermove(e: PointerEvent) {
    if (dragging) seekAt(e.clientX);
  }
  function onpointerup(e: PointerEvent) {
    dragging = false;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  }
  function onkeydown(e: KeyboardEvent) {
    let t: number | null = null;
    if (e.key === 'ArrowLeft') t = Math.max(0, currentTime - 5);
    else if (e.key === 'ArrowRight') t = Math.min(duration, currentTime + 5);
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = duration;
    if (t !== null) {
      e.preventDefault();
      e.stopPropagation(); // page-level keymap must not double-handle arrows
      onseek(t);
    }
  }
</script>

<div
  class="track"
  bind:this={track}
  role="slider"
  tabindex="0"
  aria-label="Seek"
  aria-valuemin="0"
  aria-valuemax={Math.round(duration)}
  aria-valuenow={Math.round(currentTime)}
  aria-valuetext={formatTimecode(currentTime)}
  style:--cream={CREAM}
  style:--dawn={DAWN}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onkeydown}
>
  <span class="rail"></span>
  <span class="buf" style:width="{bufFrac * 100}%"></span>
  <span class="cur" style:width="{frac * 100}%"></span>
  <span class="head" style:left="calc({frac * 100}% - 2px)"></span>
</div>

<style>
  /* Locked mockup .track/.rail/.buf/.cur/.head — 44px hit area, 8px rail. */
  .track {
    flex: 1;
    height: 44px;
    display: flex;
    align-items: center;
    position: relative;
    cursor: pointer;
    touch-action: none;
  }
  .rail,
  .buf,
  .cur {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 8px;
    pointer-events: none;
  }
  .rail {
    left: 0;
    right: 0;
    background: color-mix(in srgb, var(--cream) 18%, transparent);
  }
  .buf {
    left: 0;
    background: color-mix(in srgb, var(--cream) 28%, transparent);
  }
  .cur {
    left: 0;
    background: var(--dawn);
  }
  .head {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 28px;
    background: var(--cream);
    pointer-events: none;
  }
  .track:focus-visible {
    outline: 2px solid var(--dawn);
    outline-offset: 2px;
  }
</style>
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm check` — expected: 0 errors.

```bash
git add src/lib/ui/scrub-math.ts src/lib/ui/scrub-math.test.ts src/lib/ui/ScrubTrack.svelte
git commit -m "feat: add ScrubTrack seek slider with pointer capture and keyboard"
```

**Visual verification (against `player-locked.html` lines 28–32):** rail is 8px tall at cream 18% opacity, buffered overlay cream 28%, elapsed bar solid dawn `#FA7B62`, playhead exactly 4×28px in cream `#FFF5E8` offset −2px, zero border-radius. The visible rail sits centered in a 44px hit area (mockup's 30px container is below the 44px touch-target floor; the drawn pixels are identical).

---

### Task 7: Player.svelte — video with full custom chrome

**Files:**
- Create: `src/lib/ui/Player.svelte`

**Interfaces:**
- Consumes: `ScrubTrack` (Task 6); `formatTimecode` (Task 1); `Shuttle`, `SHUTTLE_PAUSED`, `shuttleNext`, `togglePlay`, `nextRate` (Task 2); `PlayerAction`, `FRAME_STEP` (Task 3); `CREAM`, `DAWN`, `INK`, `FONT`, `MOTION` from `$lib/ui/tokens`; `reducedMotion` readable boolean store from `$lib/ui/theme` (master Global Constraints name this store).
- Produces: `Player` component.
  - Props: `{ src: string; poster: string; duration?: number | null; title?: string | null }`.
  - Instance exports (call on the bound component instance): `handleAction(a: PlayerAction): void` (handles `toggle-play`, `shuttle`, `seek-by`, `step`, `fullscreen`, `mute`; ignores the rest) and `isPaused(): boolean`.
  - No native controls attribute — ALL chrome is custom typography per the locked mockup. `preload="metadata"`, `playsinline`.
- Behaviors (all in this one file): play/pause glyph `❚❚`/`▶`; tabular timecode `00:12 / 00:42`; ScrubTrack with buffered; `Vol` popover (sharp, filled ink, range slider); `1×` rate cycle 0.5/1/1.5/2; `Full` via Fullscreen API on the player root; controls fade after 2.5 s of playback without pointer/focus activity (never when paused, never when `$reducedMotion`, never on `(hover: none)` devices, never while a control has focus); loading = 2px dawn hairline sweep (static hairline under reduced motion), NO spinner; error = cream serif message + sans `Retry`.

- [ ] **Step 1: Implement `src/lib/ui/Player.svelte` (complete file)**

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import ScrubTrack from './ScrubTrack.svelte';
  import { formatTimecode } from '$lib/domain/timecode';
  import { SHUTTLE_PAUSED, nextRate, shuttleNext, togglePlay, type Shuttle } from '$lib/domain/shuttle';
  import { FRAME_STEP, type PlayerAction } from './player-keys';
  import { CREAM, DAWN, FONT, INK, MOTION } from '$lib/ui/tokens';
  import { reducedMotion } from '$lib/ui/theme';

  let {
    src,
    poster,
    duration: durationHint = null,
    title = null
  }: {
    src: string;
    poster: string;
    duration?: number | null;
    title?: string | null;
  } = $props();

  let root: HTMLDivElement;
  let video = $state<HTMLVideoElement | null>(null);
  let paused = $state(true);
  let currentTime = $state(0);
  let duration = $state(durationHint ?? 0);
  let buffered = $state(0);
  let muted = $state(false);
  let rate = $state(1);
  let volume = $state(1);
  let volOpen = $state(false);
  let fullscreen = $state(false);
  let loading = $state(true);
  let errored = $state(false);
  let controlsVisible = $state(true);

  let shuttle: Shuttle = SHUTTLE_PAUSED;
  let reverseTimer: ReturnType<typeof setInterval> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Touch-first devices keep controls permanently visible (no hover on mobile).
  const noHover =
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  export function isPaused(): boolean {
    return paused;
  }

  export function handleAction(a: PlayerAction): void {
    if (!video || errored) return;
    switch (a.type) {
      case 'toggle-play':
        applyShuttle(togglePlay(shuttle));
        break;
      case 'shuttle':
        applyShuttle(shuttleNext(shuttle, a.key));
        break;
      case 'seek-by':
        seek(currentTime + a.seconds);
        break;
      case 'step':
        if (video.paused) seek(currentTime + a.direction * FRAME_STEP);
        break;
      case 'fullscreen':
        void toggleFullscreen();
        break;
      case 'mute':
        video.muted = !video.muted;
        muted = video.muted;
        break;
      default:
        return; // prev/next/close belong to the page
    }
    poke();
  }

  function clearReverse() {
    if (reverseTimer) {
      clearInterval(reverseTimer);
      reverseTimer = null;
    }
  }

  function applyShuttle(next: Shuttle) {
    if (!video) return;
    shuttle = next;
    clearReverse();
    if (next.mode === 'pause') {
      video.pause();
    } else if (next.mode === 'forward') {
      video.playbackRate = next.rate;
      rate = next.rate;
      void video.play();
    } else {
      // Reverse ×2 via seek-stepping: <video> cannot play backward.
      video.pause();
      reverseTimer = setInterval(() => {
        if (!video) return clearReverse();
        const t = Math.max(0, video.currentTime - 0.2);
        video.currentTime = t;
        currentTime = t;
        if (t <= 0) {
          clearReverse();
          shuttle = SHUTTLE_PAUSED;
        }
      }, 100);
    }
  }

  function seek(t: number) {
    if (!video) return;
    const clamped = Math.min(duration || video.duration || 0, Math.max(0, t));
    video.currentTime = clamped;
    currentTime = clamped;
    poke();
  }

  function onPlayClick() {
    handleAction({ type: 'toggle-play' });
  }

  function cycleRate() {
    if (!video) return;
    rate = nextRate(rate);
    video.playbackRate = rate;
    poke();
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

  function onVolumeInput(e: Event) {
    if (!video) return;
    volume = Number((e.currentTarget as HTMLInputElement).value);
    video.volume = volume;
    if (volume > 0 && video.muted) {
      video.muted = false;
      muted = false;
    }
  }

  function retry() {
    if (!video) return;
    errored = false;
    loading = true;
    video.load();
  }

  /** Reset the auto-hide clock. Controls never fade when paused/reduced/touch. */
  function poke() {
    controlsVisible = true;
    if (hideTimer) clearTimeout(hideTimer);
    if (paused || noHover || $reducedMotion) return;
    hideTimer = setTimeout(() => {
      const focusInside = root?.contains(document.activeElement);
      if (!paused && !focusInside) controlsVisible = false;
    }, 2500);
  }

  $effect(() => {
    paused; // re-arm whenever play state flips
    poke();
  });

  onDestroy(() => {
    clearReverse();
    if (hideTimer) clearTimeout(hideTimer);
  });
</script>

<div
  class="player"
  bind:this={root}
  style:--cream={CREAM}
  style:--dawn={DAWN}
  style:--ink={INK}
  style:--serif={FONT.serif}
  style:--sans={FONT.sans}
  style:--fade="{MOTION.slow}ms"
  onpointermove={poke}
  onfocusin={poke}
  onfullscreenchange={() => (fullscreen = document.fullscreenElement === root)}
>
  {#if loading && !errored}
    <div class="hairline" class:sweep={!$reducedMotion} aria-hidden="true"></div>
  {/if}

  <video
    bind:this={video}
    {src}
    {poster}
    preload="metadata"
    playsinline
    aria-label={title ?? 'Video'}
    onplay={() => {
      paused = false;
      loading = false;
    }}
    onpause={() => (paused = true)}
    ontimeupdate={() => (currentTime = video?.currentTime ?? 0)}
    ondurationchange={() => (duration = video?.duration || durationHint || 0)}
    onprogress={() => {
      if (video && video.buffered.length > 0)
        buffered = video.buffered.end(video.buffered.length - 1);
    }}
    onwaiting={() => (loading = true)}
    oncanplay={() => (loading = false)}
    onended={() => {
      paused = true;
      shuttle = SHUTTLE_PAUSED;
    }}
    onerror={() => {
      errored = true;
      loading = false;
    }}
  ></video>

  {#if errored}
    <div class="err">
      <p>This clip couldn't be loaded.</p>
      <button class="cbtn" onclick={retry}>Retry</button>
    </div>
  {:else}
    <div class="controls" class:hidden={!controlsVisible}>
      <button class="play" onclick={onPlayClick} aria-label={paused ? 'Play' : 'Pause'}>
        {paused ? '▶' : '❚❚'}
      </button>
      <span class="tc">{formatTimecode(currentTime)} <span>/ {formatTimecode(duration)}</span></span>
      <ScrubTrack {duration} {currentTime} {buffered} onseek={seek} />
      <span class="volwrap">
        {#if volOpen}
          <span class="volpop">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              aria-label="Volume"
              oninput={onVolumeInput}
            />
          </span>
        {/if}
        <button class="cbtn" class:dim={muted} onclick={() => (volOpen = !volOpen)}>Vol</button>
      </span>
      <button class="cbtn" onclick={cycleRate}>{rate}×</button>
      <button class="cbtn" onclick={() => void toggleFullscreen()}>
        {fullscreen ? 'Exit' : 'Full'}
      </button>
    </div>
  {/if}
</div>

<style>
  .player {
    position: relative;
    width: 100%;
  }
  video {
    width: 100%;
    display: block;
    background: var(--ink);
    /* No borders on media, no radius — master Global Constraints. */
  }

  /* Loading: spinner-free dawn hairline (2px) across the top of the stage. */
  .hairline {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--dawn);
    z-index: 2;
  }
  .hairline.sweep {
    animation: sweep 1.2s linear infinite;
    transform-origin: left;
  }
  @keyframes sweep {
    0% { transform: scaleX(0); }
    60% { transform: scaleX(1); }
    100% { transform: scaleX(1); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hairline.sweep { animation: none; }
  }

  /* Locked mockup .controls: typography row below the video, gap 22px. */
  .controls {
    display: flex;
    align-items: center;
    gap: 22px;
    padding-top: 16px;
    transition: opacity var(--fade) ease;
  }
  .controls.hidden {
    opacity: 0;
  }
  button {
    background: none;
    border: none;
    padding: 0;
    color: var(--cream);
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    font-family: inherit;
  }
  .play {
    font-size: 26px;
    line-height: 1;
    font-family: var(--serif);
  }
  .tc {
    font-family: var(--sans);
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tc span {
    color: color-mix(in srgb, var(--cream) 55%, transparent);
  }
  .cbtn {
    font-family: var(--sans);
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--cream) 85%, transparent);
  }
  .cbtn.dim {
    color: color-mix(in srgb, var(--cream) 45%, transparent);
  }
  .volwrap {
    position: relative;
    display: inline-flex;
  }
  .volpop {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 4px;
    background: var(--ink);
    padding: 14px 16px;
    z-index: 3;
  }
  .volpop input[type='range'] {
    width: 120px;
    accent-color: var(--dawn);
  }

  .err {
    padding: 26px 0;
    font-family: var(--serif);
  }
  .err p {
    margin: 0 0 10px;
    font-size: 17px;
    color: var(--cream);
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm check`
Expected: 0 errors. (If `reducedMotion` is exported under a different name by phase 01's `theme.ts`, that is a phase-01 contract bug — the master Global Constraints name the `reducedMotion` store; fix the export there, additively, rather than renaming here.)

- [ ] **Step 3: Run full unit suite (no regressions)**

Run: `pnpm vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ui/Player.svelte
git commit -m "feat: add Player with custom typographic chrome, shuttle and autohide"
```

**Visual verification (against `player-locked.html` lines 24–33, 70–74):** play glyph 26px text (`❚❚` playing / `▶` paused), no icon-kit SVGs anywhere; timecode 16px sans tabular with the `/ total` half at cream 55%; Vol / 1× / Full are 13px uppercase sans, letterspacing .16em, cream 85%; controls sit in a single row gap 22px, 16px above the video bottom edge; video has no border, no radius, no overlay play button; volume popover is a sharp ink-filled box (no radius, no blur).

---

### Task 8: Lightbox.svelte — photo stage with pinch/double-tap zoom

**Files:**
- Create: `src/lib/ui/zoom-math.ts`
- Create: `src/lib/ui/zoom-math.test.ts`
- Create: `src/lib/ui/Lightbox.svelte`

**Interfaces:**
- Consumes: `MOTION` from `$lib/ui/tokens`; `reducedMotion` store from `$lib/ui/theme`.
- Produces:
  - `MIN_SCALE = 1`, `MAX_SCALE = 4`, `DOUBLE_TAP_SCALE = 2.5`, `clampScale(s)`, `toggleZoom(s)`, `pinchScale(startScale, startDist, dist)`, `clampOffset(offset, scale, viewport, content)` from `$lib/ui/zoom-math`.
  - `Lightbox` component, props: `{ src: string; alt: string }`. Double-tap/double-click toggles 1 ⇄ 2.5 centered on the tap point; two-pointer pinch zooms 1–4; single-pointer drag pans when zoomed (clamped so the image never detaches from the viewport); `touch-action: none`.

- [ ] **Step 1: Write the failing math test**

Create `src/lib/ui/zoom-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_SCALE, MAX_SCALE, MIN_SCALE,
  clampOffset, clampScale, pinchScale, toggleZoom
} from './zoom-math';

describe('clampScale / toggleZoom', () => {
  it('bounds are 1 and 4', () => {
    expect(MIN_SCALE).toBe(1);
    expect(MAX_SCALE).toBe(4);
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(9)).toBe(4);
    expect(clampScale(2)).toBe(2);
  });
  it('double-tap toggles 1 ⇄ 2.5', () => {
    expect(toggleZoom(1)).toBe(DOUBLE_TAP_SCALE);
    expect(toggleZoom(2.5)).toBe(1);
    expect(toggleZoom(3.7)).toBe(1);
  });
});

describe('pinchScale', () => {
  it('scales by pointer-distance ratio, clamped', () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 50)).toBe(1);
    expect(pinchScale(3, 100, 400)).toBe(4);
  });
  it('guards a zero start distance', () => expect(pinchScale(2, 0, 300)).toBe(2));
});

describe('clampOffset', () => {
  it('no pan when content fits the viewport', () => {
    expect(clampOffset(50, 1, 800, 600)).toBe(0);
  });
  it('clamps to half the overflow', () => {
    // 600px content at 2× = 1200; viewport 800 → max pan ±200.
    expect(clampOffset(500, 2, 800, 600)).toBe(200);
    expect(clampOffset(-500, 2, 800, 600)).toBe(-200);
    expect(clampOffset(120, 2, 800, 600)).toBe(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/zoom-math.test.ts`
Expected: FAIL — `Cannot find module './zoom-math'`.

- [ ] **Step 3: Implement `src/lib/ui/zoom-math.ts`**

```ts
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Double-tap: zoom in to 2.5 from rest, back to 1 from anywhere zoomed. */
export function toggleZoom(s: number): number {
  return s > 1.01 ? 1 : DOUBLE_TAP_SCALE;
}

export function pinchScale(startScale: number, startDist: number, dist: number): number {
  if (startDist <= 0) return clampScale(startScale);
  return clampScale(startScale * (dist / startDist));
}

/** Keep the scaled content covering the viewport: pan is ± half the overflow. */
export function clampOffset(offset: number, scale: number, viewport: number, content: number): number {
  const max = Math.max(0, (content * scale - viewport) / 2);
  return Math.min(max, Math.max(-max, offset));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/zoom-math.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Implement `src/lib/ui/Lightbox.svelte` (complete file)**

```svelte
<script lang="ts">
  import { MOTION } from '$lib/ui/tokens';
  import { reducedMotion } from '$lib/ui/theme';
  import { clampOffset, pinchScale, toggleZoom } from './zoom-math';

  let { src, alt }: { src: string; alt: string } = $props();

  let stage: HTMLDivElement;
  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let dragging = $state(false);

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { dist: number; scale: number } | null = null;
  let panStart: { px: number; py: number; x: number; y: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  function dist(): number {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function reclamp() {
    const r = stage.getBoundingClientRect();
    x = clampOffset(x, scale, r.width, r.width);
    y = clampOffset(y, scale, r.height, r.height);
  }

  function zoomAt(clientX: number, clientY: number) {
    const r = stage.getBoundingClientRect();
    const next = toggleZoom(scale);
    scale = next;
    if (next === 1) {
      x = 0;
      y = 0;
    } else {
      // Bring the tapped point toward the viewport center.
      x = clampOffset(-(clientX - (r.left + r.width / 2)) * next, next, r.width, r.width);
      y = clampOffset(-(clientY - (r.top + r.height / 2)) * next, next, r.height, r.height);
    }
  }

  function onpointerdown(e: PointerEvent) {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinchStart = { dist: dist(), scale };
      panStart = null;
    } else if (pointers.size === 1) {
      // Double-tap detection (300ms, 25px slop) for touch; dblclick covers mouse.
      const now = performance.now();
      if (
        e.pointerType === 'touch' &&
        now - lastTap.t < 300 &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 25
      ) {
        zoomAt(e.clientX, e.clientY);
        lastTap = { t: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (scale > 1) {
        panStart = { px: e.clientX, py: e.clientY, x, y };
        dragging = true;
      }
    }
  }

  function onpointermove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      scale = pinchScale(pinchStart.scale, pinchStart.dist, dist());
      reclamp();
    } else if (pointers.size === 1 && panStart) {
      const r = stage.getBoundingClientRect();
      x = clampOffset(panStart.x + (e.clientX - panStart.px), scale, r.width, r.width);
      y = clampOffset(panStart.y + (e.clientY - panStart.py), scale, r.height, r.height);
    }
  }

  function onpointerup(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      panStart = null;
      dragging = false;
      if (scale <= 1.01) {
        scale = 1;
        x = 0;
        y = 0;
      }
    }
  }

  function ondblclick(e: MouseEvent) {
    zoomAt(e.clientX, e.clientY);
  }
</script>

<div
  class="lightbox"
  bind:this={stage}
  style:--fade="{MOTION.fast}ms"
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {ondblclick}
>
  <img
    {src}
    {alt}
    draggable="false"
    class:eased={!dragging && !$reducedMotion}
    style:transform="translate({x}px, {y}px) scale({scale})"
  />
</div>

<style>
  .lightbox {
    overflow: hidden;
    touch-action: none;
    cursor: zoom-in;
  }
  .lightbox:has(img.eased) {
    /* no visual chrome — the photo owns the stage */
  }
  img {
    width: 100%;
    display: block;
    transform-origin: center center;
    user-select: none;
    -webkit-user-drag: none;
    /* No borders on media, no radius — master Global Constraints. */
  }
  img.eased {
    transition: transform var(--fade) ease;
  }
</style>
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm check` — expected: 0 errors.

```bash
git add src/lib/ui/zoom-math.ts src/lib/ui/zoom-math.test.ts src/lib/ui/Lightbox.svelte
git commit -m "feat: add photo Lightbox with pinch, double-tap zoom and pan"
```

**Visual verification (spec §10 "Photos open in the same room minus the control row"):** the photo fills the stage width like the video does, with no control row, no borders, no radius, no zoom buttons — gestures only (double-click on desktop).

---

### Task 9: PeopleRow and TagsRow social bands

**Files:**
- Create: `src/lib/ui/PeopleRow.svelte`
- Create: `src/lib/ui/TagsRow.svelte`
- Test: `src/lib/ui/PeopleRow.test.ts`, `src/lib/ui/TagsRow.test.ts`

**Interfaces:**
- Consumes: `ItemDTO['people']`, `ItemDTO['tags']`, `ItemDTO['albums']`; `Avatar.svelte`; `DAWN_PALE`/`accentOn` from Task 10.
- Produces:
  - `<PeopleRow people />` with fixed left label `People`, 19px square avatars, serif names, optional `· age N` in small sans.
  - `<TagsRow tags albums />` with fixed left label `Tags`, dawn-pale serif links for tags and album memberships.

- [ ] **Step 1: Write SSR tests**

Assert the rendered HTML includes the fixed labels, person names, age text when present, tag names, and album titles. Also assert there is no `font-style: italic`, `border-radius`, or media-border class in either component.

- [ ] **Step 2: Implement the components**

Match the locked player mockup: label column width is fixed across both rows; row text aligns at 19px avatar height; links are color-only dawn-pale with no underline. Components must use CSS variables/tokens, not hard-coded component hex.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/lib/ui/PeopleRow.test.ts src/lib/ui/TagsRow.test.ts && pnpm check`

```bash
git add src/lib/ui/PeopleRow.svelte src/lib/ui/PeopleRow.test.ts src/lib/ui/TagsRow.svelte src/lib/ui/TagsRow.test.ts
git commit -m "feat: add item-room people and tags rows"
```

---

### Task 10: Token additions and metadata edit form

**Files:**
- Modify: `src/lib/ui/tokens.ts`
- Create: `src/lib/ui/MetaForm.svelte`
- Test: `src/lib/ui/tokens.test.ts`, `src/lib/ui/MetaForm.test.ts`

**Interfaces:**
- Adds `DAWN_PALE = '#FFD9A8'` and `accentOn(hex): typeof INK | typeof CREAM` to `tokens.ts`.
- Produces `<MetaForm item onsubmit />`; it sends the Phase 04 PATCH payload `{ title, description, dateStart, dateEnd, datePrecision, tapeLabel, people: string[], tags: string[] }`.

- [ ] **Step 1: Write tests**

Token tests verify `accentOn` returns the `ACCENTS[].on` pairing and defaults to `INK` for unknown light accents. Component tests verify field names and that the submitted payload lowercases tag names and preserves person ids.

- [ ] **Step 2: Implement**

Use existing `DatePicker.svelte` from Phase 01. Keep the form sharp-cornered and compact; no comments fields belong in this component.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/lib/ui/tokens.test.ts src/lib/ui/MetaForm.test.ts && pnpm check`

```bash
git add src/lib/ui/tokens.ts src/lib/ui/tokens.test.ts src/lib/ui/MetaForm.svelte src/lib/ui/MetaForm.test.ts
git commit -m "feat: add item metadata form and player token helpers"
```

---

### Task 11: Item route load and room assembly

**Files:**
- Create: `src/routes/item/[id]/+page.server.ts`
- Create: `src/routes/item/[id]/+page.svelte`

**Interfaces:**
- Consumes: `GET /api/items/[id]`, `neighborsOf`, `contextFromParams`, `playerRoomFor`, `GRAIN_URI`, `Player`, `Lightbox`, `PeopleRow`, `TagsRow`, `MetaForm`.
- Produces the authenticated `/item/[id]` room. Comments are not rendered here; leave a `data-testid="comments-slot"` empty region with an HTML comment noting Phase 05 fills it.

- [ ] **Step 1: Implement `+page.server.ts`**

Load the item DTO defensively as `body.item ?? body`, read `items.source` from `locals.db`, compute neighbors using all URL context except `y`, and return `{ item, source, neighbors, me, canEdit }`. `canEdit` is true for editor+ or uploader-own.

- [ ] **Step 2: Implement `+page.svelte`**

Build the locked room:
- Top bar: `← Back to {y ?? yearOf(item.date) ?? 'Timeline'}`, centered serif title, `✕ Close`.
- Stage: `Player` for videos, `Lightbox` for photos.
- Edges: big prev/next arrows vertically centered on the media midline, disabled at edges.
- Under-stage: `PeopleRow` then `TagsRow`.
- Right rail: provenance eyebrow, large date, description, and the empty comments slot reserved for Phase 05.
- Inline metadata editor appears only when `canEdit`.

- [ ] **Step 3: Verify**

Run: `pnpm check && pnpm vitest run`

Manual visual check against `docs/superpowers/specs/mockups/player-locked.html`: no borders/radius/media overlays; video controls match the typographic chrome; photos omit controls; mobile stacks video/photo → people/tags → date/story.

```bash
git add "src/routes/item/[id]/+page.server.ts" "src/routes/item/[id]/+page.svelte"
git commit -m "feat: assemble authenticated item room"
```

---

### Task 12: Player e2e and final phase gate

**Files:**
- Create: `e2e/helpers/seed-player.ts`
- Create: `e2e/player.spec.ts`

**Interfaces:**
- Seeds a video item, a photo item, people, tags, albums, and a logged-in user using the same e2e DB/media paths established by earlier phases.

- [ ] **Step 1: Write e2e coverage**

Cover: video room loads from timeline context; space toggles play; J/K/L changes shuttle state; arrow keys seek/step; prev/next preserve URL context and cross year boundaries; photo room opens without video controls; edit form PATCHes title/date/tags for an editor.

- [ ] **Step 2: Run all gates**

Run:

```bash
pnpm check
pnpm vitest run
pnpm test:e2e
```

Expected: all green.

- [ ] **Step 3: Final visual pass and commit**

Compare desktop and mobile against `player-locked.html`; fix deviations before committing.

```bash
git add e2e/helpers/seed-player.ts e2e/player.spec.ts
git commit -m "test: add item-room e2e coverage"
```

## Self-review

- Comments are explicitly deferred to Phase 05 and no comments route/component is created here.
- The item room still reserves the visual slot required by the player mockup, so Phase 05 can fill it without restructuring the room.
- Every file listed in the top file map is now covered by a task; no generation placeholders remain.
