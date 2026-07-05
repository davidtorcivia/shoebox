# Shoebox Phase 05 — People, Relationships, Albums & Comment Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the people layer (relationship derivation, ages, people API, `/people` index, the locked person page with accent-derived room, bio editing, family rows, year-chunked age-captioned timeline, person edit UI, user↔person linking) plus full album CRUD/pages with drag-reorder and the comment-identity polish pass.

**Architecture:** Pure domain logic (`relationships.ts`, `ages.ts`) feeds thin server services (`people.ts`, `albums.ts`) that build DTOs; JSON routes under `src/routes/api/` enforce roles per master Contract 6; Svelte 5 pages compose Phase 01–04 UI primitives (MasonryGrid, MediaCard, Avatar, Comments) with new person/album components. Person-page rooms derive entirely from `personRoomFor(person.accentColor)` in tokens.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM (better-sqlite3/D1), Vitest, Playwright, `marked` + `isomorphic-dompurify` (bio markdown), pnpm.

**Master:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — the contracts there are LAW. This plan consumes Contracts 1–7 and the outputs of Phases 01–04. If this plan and the master disagree, the master wins.

**Locked mockup for all person-page visual tasks:** `docs/superpowers/specs/mockups/person-and-mobile-locked.html` (left panel, "Person v2"). Match it precisely: NO tree view; hero text top-aligned with the portrait top; stats row locked to the portrait bottom; family label-rows with 19px inline avatars.

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

**Phase 05 scope fence — FORBIDDEN here:** search page & omnibox (Phase 06), share links & public rooms (Phase 08), face suggestions (Phase 09). The admin **users page UI** is Phase 08; this phase only ships the `PATCH /api/admin/users/[id]` linking endpoint.

## Phase-Scope Resolutions (decisions baked into this plan)

1. **Nickname:** AMENDED BY MASTER (2026-07-04): Contract 1's `people` table now includes `nickname: text('nickname')` (nullable). **Resolution: render the mockup's quote line (`“Grandma”`, serif 22px, cream at .75 opacity, curly quotes added at render time) directly under the name whenever `person.nickname` is set; omit the line entirely when null.** Include `nickname` in: the person edit UI (text field between Name and Birthdate), `POST /api/people` + `PATCH /api/people/[id]` accepted fields (editor+; NOT in the linked-user whitelist), the person-page hero, and the FTS people column when Phase 06 wires reindexing (nickname concatenated after name). Wherever this plan's tasks create/patch people or assert hero markup, treat `nickname` as an ordinary optional column per this resolution — the `.who` top-alignment/stats-lock geometry already accounts for the line, exactly as in the locked mockup.
2. **Bio label copy:** mockup shows "Her story". No gender field exists. **Resolution: the label text is exactly `Story`** (same styling as the mockup's label).
3. **Person delete:** `people` has no `deletedAt` column, and hard-deleting tagged history is forbidden. **Resolution: `DELETE /api/people/[id]` requires admin and refuses with `409 { error: 'person-in-use', count }` whenever any `item_people` rows reference the person.** When zero rows reference the person, the hard delete is allowed and also removes the person's `relationships` rows and nulls any `users.personId` pointing at them.
4. **Linked-user PATCH:** a non-editor user whose `personId` matches may PATCH **only `bio` and `birthPlace`**; any other field → 403.
5. **Sibling derivation:** `familyOf` derives siblings from stored `sibling-of` edges only (no shared-parent inference; cousins/in-laws deferred — display needs only the master's six buckets).
6. **Year-header age:** "Age N" in a year header = `ageAt(birthdate, '<year>-07-01', deathDate)` (mid-year), omitted when null.
7. **Avatar crop aspect:** crops are stored normalized (`{x,y,w,h}` of the source image) and the picker constrains the crop's **pixel** aspect to 4:5 (the 168×210 hero portrait). Square index cards render the same 4:5 crop inside a square with a vertical center overflow-crop — no distortion, pure CSS.
8. **Profile updates** use SvelteKit **form actions** on `/profile` (origin-checked per Global Constraints) instead of inventing a `/api/profile` route absent from Contract 6.
9. **User↔person link is 1:1:** linking a person already linked to another user returns `409 { error: 'person-already-linked' }`.
10. **Family rows rendered:** Parents / Spouse / Children / Siblings / Grandparents / Grandkids (empty rows omitted). The mockup shows four of these because Margaret's data has four.
11. **Markdown italics:** `em` is allowed through sanitization but CSS forces `font-style: normal` (italics are forbidden app-wide; the mockup does the same with `font-style: normal !important`).
12. **Album gradient fallback:** albums have no accent color; cover-less album cards use `personRoomFor(album.createdBy.accentColor)` stops.

## Consumed Interfaces (Phases 01–04)

From master contracts (exact, LAW):

```ts
// Contract 3 — src/lib/server/roles.ts
const ROLE_RANK = { user: 0, uploader: 1, editor: 2, admin: 3, owner: 4 };
function requireRole(locals: App.Locals, min: Role): SessionUser;   // throws error(401/403)

// Contract 2 — app.d.ts
type SessionUser = { id: string; username: string; role: Role; accentColor: string; personId: string | null; comfortMode: boolean; theme: 'system'|'dark'|'light' };
// App.Locals = { user: SessionUser | null; platform: Platform; db: Db }

// Contract 4 — src/lib/ui/tokens.ts
export const ACCENTS: readonly { hex: string; on: 'ink'|'cream' }[]; // 12 entries
export const INK: string; export const CREAM: string; export const DAWN: string;
export const GRAIN_URI: string; export const FONT: { serif: string; sans: string };
export function personRoomFor(accentHex: string): { stops: [string,string,string]; pools: { color: string; pos: string; size: string }[] };

// Contract 5 — src/lib/domain/accents.ts
export function nextAccent(used: string[]): string;

// Contract 5 — src/lib/domain/dates.ts
export interface ItemDate { dateStart: string|null; dateEnd: string|null; precision: DatePrecision }

// Contract 6 — ItemDTO (shape is fixed)
ItemDTO = { id, type, title, description, date: ItemDate, displayDate, shortDate, duration, width, height, status,
  urls: { poster, thumb400, thumb800, thumb1600, original?, sprite? }, blurhash,
  people: { id, name, accentColor, age? }[], tags: { id, name, kind }[], albums: { id, title }[], uploadedBy, tapeLabel }

// Contract 6 — GET /api/items?year&people(csv)&album&limit → { items: ItemDTO[], nextCursor }
// Contract 6 — GET/POST /api/items/[id]/comments (Phase 04) — comment JSON:
//   { id: string; body: string; createdAt: string; user: { id: string; username: string; accentColor: string } }

// Contract 2 — StorageAdapter.mediaUrl(key: string): Promise<string>
// Contract 7 — storage keys: media/<itemId>/thumb_400.webp etc.
```

Assumed Phase 01–04 module locations (**semantics are contractual, exact paths/names must be verified against the codebase at execution time; if an earlier phase used a different name for the same thing, use the existing one — never re-implement**):

- `src/lib/domain/dtos.ts` exports `ItemDTO` (Contract 6 shape). If it lives elsewhere (e.g. `$lib/domain/items.ts`), update the imports in this plan's files.
- `src/lib/server/items.ts` exports `getItemDTOsByIds(db: Db, storage: StorageAdapter, ids: string[]): Promise<ItemDTO[]>` preserving the order of `ids`. If Phase 02 exposed a differently-named bulk DTO builder, call that.
- `src/lib/server/db/index.ts` exports `type Db = ReturnType<typeof drizzle>`.
- `src/lib/ui/Avatar.svelte` props: `{ name: string; accentColor: string; size?: number }` — sharp square monogram, ink/cream text per ACCENTS pairing.
- `src/lib/ui/MasonryGrid.svelte` props: `{ items: ItemDTO[] }` (renders one `MediaCard` per item, preserves given order). `src/lib/ui/MediaCard.svelte` props: `{ item: ItemDTO }` with the caption row (short date left, people/event right).
- `src/lib/ui/Comments.svelte` props: `{ itemId: string }`; loads and posts `/api/items/[id]/comments`; input placeholder "Add a memory…".
- `src/app.css` defines `:root { --ink; --cream; --dawn; --font-serif; --font-sans }` from tokens (Phase 01). Components below use these vars, never raw hex.
- Playwright (Phase 01 config) starts the app with `DATABASE_PATH=./e2e/.data/shoebox.db` and `MEDIA_PATH=./e2e/.data/media`; login form fields are `input[name="username"]`, `input[name="password"]` with a `button[type="submit"]`. Verify against `playwright.config.ts` and adjust the two constants in `e2e/support/seed-phase05.ts` if the actual env differs.

## File Structure

```
src/lib/domain/
  relationships.ts (+ relationships.test.ts)      # Task 1 — Contract 5 familyOf + canonicalRel
  ages.ts (+ ages.test.ts)                        # Task 2 — Contract 5 ageAt / dateWindowForAge
  people-dto.ts                                   # Task 3 — CropRect, PersonRef, PersonListDTO, PersonDetailDTO, FamilyRefs
  album-dto.ts                                    # Task 12 — AlbumDTO
src/lib/server/
  testing/db.ts                                   # Task 3 — in-memory test DB + seeders (test-only)
  people.ts (+ people.test.ts)                    # Tasks 3–4 — person service
  albums.ts (+ albums.test.ts)                    # Task 12 — album service
src/routes/api/
  people/+server.ts (+ server.test.ts)            # Task 5
  people/[id]/+server.ts (+ server.test.ts)       # Task 5
  people/[id]/relationships/+server.ts (+ test)   # Task 5
  albums/+server.ts (+ server.test.ts)            # Task 13
  albums/[id]/+server.ts (+ server.test.ts)       # Task 13
  albums/[id]/items/+server.ts (+ server.test.ts) # Task 13
  admin/users/[id]/+server.ts (+ server.test.ts)  # Task 16
src/lib/ui/
  crop.ts (+ crop.test.ts)                        # Tasks 6, 10 — crop CSS math + picker math
  CroppedPortrait.svelte                          # Task 6
  PersonCard.svelte                               # Task 6
  age-caption.ts (+ age-caption.test.ts)          # Task 9
  PersonYearSection.svelte                        # Task 9
  AccentSwatches.svelte                           # Task 10
  CropPicker.svelte                               # Task 10
  RelEditor.svelte                                # Task 11
  markdown.ts (+ markdown.test.ts)                # Task 8
  reorder.ts (+ reorder.test.ts)                  # Task 14
  ReorderGrid.svelte                              # Task 14
  AlbumToggle.svelte                              # Task 15
  relative-time.ts (+ relative-time.test.ts)      # Task 17
  CommentList.svelte                              # Task 17
src/routes/
  people/+page.server.ts, +page.svelte            # Task 6
  people/[id]/+page.server.ts, +page.svelte       # Tasks 7–9
  people/[id]/edit/+page.server.ts, +page.svelte  # Tasks 10–11
  albums/+page.server.ts, +page.svelte            # Task 14
  albums/[id]/+page.server.ts, +page.svelte       # Task 14
  profile/+page.server.ts, +page.svelte           # Task 16
e2e/
  support/seed-phase05.ts                         # Task 18
  people-albums.spec.ts                           # Task 18
Modified: src/lib/ui/MediaCard.svelte, src/lib/ui/MasonryGrid.svelte (Task 9 caption props),
          src/lib/ui/Comments.svelte (Task 17), src/routes/item/[id]/+page.svelte (Task 15),
          package.json (Task 8: marked + isomorphic-dompurify).
```

---

### Task 1: Relationship derivation (`familyOf`, `canonicalRel`)

**Files:**
- Create: `src/lib/domain/relationships.ts`
- Test: `src/lib/domain/relationships.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces (Contract 5, exact):
  - `export type RelType = 'parent-of'|'spouse-of'|'sibling-of'`
  - `export interface Rel { personA: string; personB: string; type: RelType }`
  - `export function familyOf(personId: string, rels: Rel[]): { parents: string[]; children: string[]; spouses: string[]; siblings: string[]; grandparents: string[]; grandchildren: string[] }`
  - `export interface FamilyIds` — alias of the `familyOf` return shape
  - `export function canonicalRel(rel: Rel): Rel` — `spouse-of`/`sibling-of` normalized so `personA < personB`; `parent-of` unchanged (direction is meaning: parent → child)
  - All six arrays are deduplicated, exclude `personId` itself, and sorted ascending (deterministic).

- [ ] **Step 1: Write the failing test**

Create `src/lib/domain/relationships.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalRel, familyOf, type Rel } from './relationships';

const rel = (personA: string, personB: string, type: Rel['type']): Rel => ({ personA, personB, type });

describe('canonicalRel', () => {
	it('leaves parent-of untouched even when personA > personB', () => {
		expect(canonicalRel(rel('zed', 'ann', 'parent-of'))).toEqual(rel('zed', 'ann', 'parent-of'));
	});
	it('swaps spouse-of so personA < personB', () => {
		expect(canonicalRel(rel('frank', 'ann', 'spouse-of'))).toEqual(rel('ann', 'frank', 'spouse-of'));
	});
	it('swaps sibling-of so personA < personB', () => {
		expect(canonicalRel(rel('rose', 'meg', 'sibling-of'))).toEqual(rel('meg', 'rose', 'sibling-of'));
	});
	it('is a no-op on already-canonical rels', () => {
		expect(canonicalRel(rel('ann', 'frank', 'spouse-of'))).toEqual(rel('ann', 'frank', 'spouse-of'));
	});
});

describe('familyOf', () => {
	it('returns six empty arrays when there are no rels', () => {
		expect(familyOf('meg', [])).toEqual({
			parents: [], children: [], spouses: [], siblings: [], grandparents: [], grandchildren: []
		});
	});

	it('derives parents (stored parent→child) and children', () => {
		const rels = [rel('ann', 'meg', 'parent-of'), rel('meg', 'carol', 'parent-of'), rel('meg', 'joe', 'parent-of')];
		const f = familyOf('meg', rels);
		expect(f.parents).toEqual(['ann']);
		expect(f.children).toEqual(['carol', 'joe']);
	});

	it('derives spouses regardless of stored direction', () => {
		expect(familyOf('meg', [rel('frank', 'meg', 'spouse-of')]).spouses).toEqual(['frank']);
		expect(familyOf('meg', [rel('meg', 'zeb', 'spouse-of')]).spouses).toEqual(['zeb']);
	});

	it('derives siblings regardless of stored direction', () => {
		expect(familyOf('meg', [rel('meg', 'rose', 'sibling-of')]).siblings).toEqual(['rose']);
		expect(familyOf('meg', [rel('bea', 'meg', 'sibling-of')]).siblings).toEqual(['bea']);
	});

	it('derives grandparents via two parent-of hops on both sides', () => {
		const rels = [
			rel('gma-m', 'mom', 'parent-of'), rel('gpa-m', 'mom', 'parent-of'),
			rel('gma-p', 'dad', 'parent-of'),
			rel('mom', 'meg', 'parent-of'), rel('dad', 'meg', 'parent-of')
		];
		expect(familyOf('meg', rels).grandparents).toEqual(['gma-m', 'gma-p', 'gpa-m']);
	});

	it('derives grandchildren via two parent-of hops', () => {
		const rels = [
			rel('meg', 'davidsr', 'parent-of'), rel('meg', 'carol', 'parent-of'),
			rel('davidsr', 'david', 'parent-of'), rel('davidsr', 'eric', 'parent-of')
		];
		expect(familyOf('meg', rels).grandchildren).toEqual(['david', 'eric']);
	});

	it('deduplicates and sorts every bucket', () => {
		const rels = [
			rel('meg', 'carol', 'parent-of'), rel('meg', 'carol', 'parent-of'),
			rel('carol', 'kid', 'parent-of'), rel('carol', 'kid', 'parent-of')
		];
		const f = familyOf('meg', rels);
		expect(f.children).toEqual(['carol']);
		expect(f.grandchildren).toEqual(['kid']);
	});

	it('never includes the person themself (degenerate cycles)', () => {
		const rels = [rel('a', 'meg', 'parent-of'), rel('meg', 'a', 'parent-of')];
		const f = familyOf('meg', rels);
		expect(f.grandparents).toEqual([]);   // meg would be her own grandparent
		expect(f.grandchildren).toEqual([]);
	});

	it('ignores rels not connected to the person', () => {
		const f = familyOf('meg', [rel('x', 'y', 'parent-of'), rel('x', 'y', 'spouse-of')]);
		expect(f).toEqual({ parents: [], children: [], spouses: [], siblings: [], grandparents: [], grandchildren: [] });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/domain/relationships.test.ts`
Expected: FAIL — "Failed to resolve import './relationships'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/domain/relationships.ts`:

```ts
// Pure derivation of display kin from stored canonical relationships.
// Storage rules (enforced at write time in src/lib/server/people.ts):
//   parent-of : stored directionally, personA is the parent of personB.
//   spouse-of / sibling-of : stored ONCE with personA < personB (canonicalRel).

export type RelType = 'parent-of' | 'spouse-of' | 'sibling-of';

export interface Rel {
	personA: string;
	personB: string;
	type: RelType;
}

export interface FamilyIds {
	parents: string[];
	children: string[];
	spouses: string[];
	siblings: string[];
	grandparents: string[];
	grandchildren: string[];
}

/** Normalize a rel for storage. Symmetric types get personA < personB; parent-of keeps direction. */
export function canonicalRel(rel: Rel): Rel {
	if (rel.type === 'parent-of' || rel.personA <= rel.personB) return rel;
	return { personA: rel.personB, personB: rel.personA, type: rel.type };
}

function uniqSortedExcluding(ids: string[], exclude: string): string[] {
	return [...new Set(ids)].filter((id) => id !== exclude).sort();
}

export function familyOf(personId: string, rels: Rel[]): FamilyIds {
	const parentsOf = (id: string): string[] =>
		rels.filter((r) => r.type === 'parent-of' && r.personB === id).map((r) => r.personA);
	const childrenOf = (id: string): string[] =>
		rels.filter((r) => r.type === 'parent-of' && r.personA === id).map((r) => r.personB);
	const symmetric = (type: RelType): string[] =>
		rels
			.filter((r) => r.type === type && (r.personA === personId || r.personB === personId))
			.map((r) => (r.personA === personId ? r.personB : r.personA));

	const parents = parentsOf(personId);
	const children = childrenOf(personId);
	return {
		parents: uniqSortedExcluding(parents, personId),
		children: uniqSortedExcluding(children, personId),
		spouses: uniqSortedExcluding(symmetric('spouse-of'), personId),
		siblings: uniqSortedExcluding(symmetric('sibling-of'), personId),
		grandparents: uniqSortedExcluding(parents.flatMap(parentsOf), personId),
		grandchildren: uniqSortedExcluding(children.flatMap(childrenOf), personId)
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/domain/relationships.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm check
git add src/lib/domain/relationships.ts src/lib/domain/relationships.test.ts
git commit -m "feat: familyOf/canonicalRel relationship derivation (Contract 5)"
```

---

### Task 2: Ages (`ageAt`, `dateWindowForAge`)

**Files:**
- Create: `src/lib/domain/ages.ts`
- Test: `src/lib/domain/ages.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces (Contract 5, exact):
  - `export function ageAt(birthdate: string, onDate: string, deathDate?: string|null): number | null` — full years; `null` before birth and **null for any date strictly after death** ("age at a date after death = null"); on the death date itself the age is still returned.
  - `export function dateWindowForAge(birthdate: string, age: { min: number; max: number }): { start: string; end: string }` — inclusive ISO window during which the person is between `min` and `max` years old.

- [ ] **Step 1: Write the failing test**

Create `src/lib/domain/ages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ageAt, dateWindowForAge } from './ages';

describe('ageAt', () => {
	it('counts full years only (day before birthday)', () => {
		expect(ageAt('1941-03-15', '1994-03-14')).toBe(52);
		expect(ageAt('1941-03-15', '1994-03-15')).toBe(53);
		expect(ageAt('1941-03-15', '1994-06-14')).toBe(53);
	});
	it('returns null before birth', () => {
		expect(ageAt('1941-03-15', '1941-03-14')).toBeNull();
		expect(ageAt('1941-03-15', '1930-01-01')).toBeNull();
	});
	it('returns null strictly after deathDate', () => {
		expect(ageAt('1941-03-15', '2019-06-02', '2019-06-01')).toBeNull();
		expect(ageAt('1941-03-15', '2020-12-25', '2019-06-01')).toBeNull();
	});
	it('still returns the age on the death date itself', () => {
		expect(ageAt('1941-03-15', '2019-06-01', '2019-06-01')).toBe(78);
	});
	it('ignores a null deathDate', () => {
		expect(ageAt('1941-03-15', '2020-01-01', null)).toBe(78);
	});
	it('handles a Feb 29 birthdate (rolls to Mar 1 off-leap)', () => {
		expect(ageAt('2000-02-29', '2001-02-28')).toBe(0);
		expect(ageAt('2000-02-29', '2001-03-01')).toBe(1);
	});
});

describe('dateWindowForAge', () => {
	it('computes the inclusive window for an age range', () => {
		expect(dateWindowForAge('1941-03-15', { min: 5, max: 7 })).toEqual({
			start: '1946-03-15',
			end: '1949-03-14'
		});
	});
	it('starts at the birthdate for min 0', () => {
		expect(dateWindowForAge('1941-03-15', { min: 0, max: 0 })).toEqual({
			start: '1941-03-15',
			end: '1942-03-14'
		});
	});
	it('handles Feb 29 birthdates', () => {
		expect(dateWindowForAge('2000-02-29', { min: 1, max: 1 })).toEqual({
			start: '2001-03-01',
			end: '2002-02-28'
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/domain/ages.test.ts`
Expected: FAIL — "Failed to resolve import './ages'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/domain/ages.ts`:

```ts
// Age math. All inputs/outputs are ISO 'YYYY-MM-DD' strings; comparisons use
// lexicographic order (valid for ISO dates). All Date math is UTC-only.

function isoToUTC(iso: string): Date {
	return new Date(iso + 'T00:00:00Z');
}
function toISO(d: Date): string {
	return d.toISOString().slice(0, 10);
}
function addYears(iso: string, n: number): string {
	const d = isoToUTC(iso);
	return toISO(new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate())));
}
function addDays(iso: string, n: number): string {
	const d = isoToUTC(iso);
	d.setUTCDate(d.getUTCDate() + n);
	return toISO(d);
}

/**
 * Age in full years on `onDate`. Null before birth, and null for any date
 * STRICTLY after `deathDate` (an age after death is meaningless — spec §4).
 * On the death date itself, the age at death is returned.
 */
export function ageAt(birthdate: string, onDate: string, deathDate?: string | null): number | null {
	if (onDate < birthdate) return null;
	if (deathDate && onDate > deathDate) return null;
	const b = isoToUTC(birthdate);
	const o = isoToUTC(onDate);
	let age = o.getUTCFullYear() - b.getUTCFullYear();
	const beforeBirthday =
		o.getUTCMonth() < b.getUTCMonth() ||
		(o.getUTCMonth() === b.getUTCMonth() && o.getUTCDate() < b.getUTCDate());
	if (beforeBirthday) age -= 1;
	return age;
}

/** Inclusive ISO date window during which the person is between age.min and age.max. */
export function dateWindowForAge(
	birthdate: string,
	age: { min: number; max: number }
): { start: string; end: string } {
	return {
		start: addYears(birthdate, age.min),
		end: addDays(addYears(birthdate, age.max + 1), -1)
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/domain/ages.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm check
git add src/lib/domain/ages.ts src/lib/domain/ages.test.ts
git commit -m "feat: ageAt and dateWindowForAge (Contract 5, death-capped)"
```

---

### Task 3: Person DTOs + person service (read side) + test DB helper

**Files:**
- Create: `src/lib/domain/people-dto.ts`
- Create: `src/lib/server/testing/db.ts` (test-only helper; if Phase 02 already created an equivalent in-memory-DB helper, reuse it and re-export these seeders from it instead of duplicating)
- Create: `src/lib/server/people.ts`
- Test: `src/lib/server/people.test.ts`

**Interfaces:**
- Consumes: `Db` (`$lib/server/db`), schema tables (Contract 1), `StorageAdapter.mediaUrl` (Contract 2), `nextAccent` (Contract 5), `familyOf`/`Rel` (Task 1), `ageAt` (Task 2), `ACCENTS` (Contract 4), `nanoid`.
- Produces:
  - `src/lib/domain/people-dto.ts`:
    - `export interface CropRect { x: number; y: number; w: number; h: number }` (normalized 0–1 of the source image)
    - `export interface PersonRef { id: string; name: string; accentColor: string }`
    - `export interface PersonListDTO extends PersonRef { birthdate: string|null; deathDate: string|null; avatarItemId: string|null; avatarCrop: CropRect|null; avatarUrl: string|null; itemCount: number }`
    - `export interface FamilyRefs { parents: PersonRef[]; children: PersonRef[]; spouses: PersonRef[]; siblings: PersonRef[]; grandparents: PersonRef[]; grandchildren: PersonRef[] }`
    - `export interface PersonDetailDTO extends PersonListDTO { birthPlace: string|null; bio: string|null; family: FamilyRefs; years: { year: number; count: number; age: number|null }[]; stats: { moments: number; onFilm: { from: number; to: number } | null; albums: number }; linkedUsername: string|null }`
  - `src/lib/server/people.ts`:
    - `export async function listPeople(db: Db, storage: StorageAdapter): Promise<PersonListDTO[]>` — item counts exclude soft-deleted items; sorted `itemCount` desc then `name` asc; `avatarUrl` = mediaUrl of the avatar item's `thumb_400`.
    - `export async function createPerson(db: Db, input: { name: string; birthdate?: string|null; deathDate?: string|null; birthPlace?: string|null }): Promise<PersonListDTO>` — accent auto-assigned via `nextAccent` over **people + users** accent usage.
    - `export async function getPersonDetail(db: Db, storage: StorageAdapter, id: string): Promise<PersonDetailDTO | null>` — family from `familyOf`, year-chunked item summary (ready, non-deleted, dated items), stats, linked username; `avatarUrl` = mediaUrl of `thumb_800`.
    - `export async function resolveFamily(db: Db, personId: string): Promise<FamilyRefs>`
  - `src/lib/server/testing/db.ts` (used by all later server tests):
    - `export function makeTestDb(): Db` — in-memory better-sqlite3 + migrations
    - `export async function makeUser(db, over?): Promise<typeof users.$inferSelect>`
    - `export async function makePerson(db, over?): Promise<typeof people.$inferSelect>`
    - `export async function makeItem(db, over: { uploadedBy: string } & Partial<...>): Promise<typeof items.$inferSelect>`
    - `export async function addThumbs(db, itemId: string): Promise<void>` — inserts `thumb_400`/`thumb_800`/`poster` itemFiles rows
    - `export async function tagPerson(db, itemId: string, personId: string): Promise<void>`
    - `export const stubStorage: StorageAdapter` — `mediaUrl(key) => '/media/' + key`; other methods throw
    - `export function sessionUser(row: typeof users.$inferSelect): SessionUser`

- [ ] **Step 1: Write the test DB helper (infrastructure — no test cycle of its own; it is exercised by every test below)**

Create `src/lib/server/testing/db.ts`:

```ts
// TEST-ONLY helper. Vitest runs on node, so better-sqlite3 is allowed here;
// this module must never be imported by runtime code.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import * as schema from '../db/schema';
import type { StorageAdapter } from '../platform/types';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export function makeTestDb() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
	return db;
}

export async function makeUser(db: TestDb, over: Partial<typeof schema.users.$inferInsert> = {}) {
	const id = over.id ?? nanoid(12);
	const row: typeof schema.users.$inferInsert = {
		id,
		username: over.username ?? `user-${id}`,
		passwordHash: 'pbkdf2$310000$c2FsdA==$aGFzaA==',
		role: over.role ?? 'user',
		accentColor: over.accentColor ?? '#FA7B62',
		personId: over.personId ?? null,
		comfortMode: false,
		theme: 'system',
		createdAt: new Date(),
		...over
	};
	await db.insert(schema.users).values(row);
	return (await db.select().from(schema.users)).find((u) => u.id === id)!;
}

export async function makePerson(db: TestDb, over: Partial<typeof schema.people.$inferInsert> = {}) {
	const id = over.id ?? nanoid(12);
	await db.insert(schema.people).values({
		id,
		name: over.name ?? `Person ${id}`,
		accentColor: over.accentColor ?? '#FA7B62',
		createdAt: new Date(),
		...over
	});
	return (await db.select().from(schema.people)).find((p) => p.id === id)!;
}

export async function makeItem(
	db: TestDb,
	over: { uploadedBy: string } & Partial<typeof schema.items.$inferInsert>
) {
	const id = over.id ?? nanoid(12);
	await db.insert(schema.items).values({
		id,
		type: 'photo',
		datePrecision: 'day',
		width: 800,
		height: 600,
		sizeBytes: 1000,
		sha256: `sha-${id}`,
		source: 'upload',
		status: 'ready',
		createdAt: new Date(),
		...over
	});
	return (await db.select().from(schema.items)).find((i) => i.id === id)!;
}

export async function addThumbs(db: TestDb, itemId: string) {
	for (const kind of ['thumb_400', 'thumb_800', 'poster'] as const) {
		await db.insert(schema.itemFiles).values({
			id: nanoid(12),
			itemId,
			kind,
			storageKey: `media/${itemId}/${kind}.webp`,
			mime: 'image/webp',
			width: 400,
			height: 300
		});
	}
}

export async function tagPerson(db: TestDb, itemId: string, personId: string) {
	await db.insert(schema.itemPeople).values({ itemId, personId, source: 'manual' });
}

export const stubStorage = {
	mediaUrl: async (key: string) => `/media/${key}`,
	put: async () => { throw new Error('stub'); },
	get: async () => { throw new Error('stub'); },
	head: async () => { throw new Error('stub'); },
	delete: async () => { throw new Error('stub'); }
} as unknown as StorageAdapter;

export function sessionUser(row: typeof schema.users.$inferSelect) {
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		accentColor: row.accentColor,
		personId: row.personId,
		comfortMode: row.comfortMode,
		theme: row.theme
	};
}
```

- [ ] **Step 2: Write the DTO types**

Create `src/lib/domain/people-dto.ts`:

```ts
// Shared person DTO shapes — importable from both server and client code
// (pure types, no runtime dependencies).

export interface CropRect {
	x: number; // all normalized 0–1 against the source image
	y: number;
	w: number;
	h: number;
}

export interface PersonRef {
	id: string;
	name: string;
	accentColor: string;
}

export interface PersonListDTO extends PersonRef {
	birthdate: string | null;
	deathDate: string | null;
	avatarItemId: string | null;
	avatarCrop: CropRect | null;
	avatarUrl: string | null; // thumb_400 in lists, thumb_800 in detail
	itemCount: number;
}

export interface FamilyRefs {
	parents: PersonRef[];
	children: PersonRef[];
	spouses: PersonRef[];
	siblings: PersonRef[];
	grandparents: PersonRef[];
	grandchildren: PersonRef[];
}

export interface PersonDetailDTO extends PersonListDTO {
	birthPlace: string | null;
	bio: string | null;
	family: FamilyRefs;
	/** Ascending years the person appears in (ready, non-deleted, dated items). */
	years: { year: number; count: number; age: number | null }[];
	stats: {
		moments: number; // all tagged, non-deleted, ready items (dated or not)
		onFilm: { from: number; to: number } | null;
		albums: number; // distinct live albums containing any tagged item
	};
	linkedUsername: string | null;
}
```

- [ ] **Step 3: Write the failing service tests**

Create `src/lib/server/people.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { nextAccent } from '$lib/domain/accents';
import { ACCENTS } from '$lib/ui/tokens';
import * as schema from './db/schema';
import {
	addThumbs, makeItem, makePerson, makeTestDb, makeUser, stubStorage, tagPerson, type TestDb
} from './testing/db';
import { createPerson, getPersonDetail, listPeople } from './people';

let db: TestDb;
let uploader: Awaited<ReturnType<typeof makeUser>>;
beforeEach(async () => {
	db = makeTestDb();
	uploader = await makeUser(db, { role: 'editor' });
});

describe('createPerson', () => {
	it('assigns the least-used accent across people AND users', async () => {
		await makeUser(db, { accentColor: ACCENTS[0].hex });
		await makePerson(db, { accentColor: ACCENTS[1].hex });
		const used = (await db.select().from(schema.users)).map((u) => u.accentColor)
			.concat((await db.select().from(schema.people)).map((p) => p.accentColor));
		const person = await createPerson(db, { name: 'Margaret Torcivia' });
		expect(person.accentColor).toBe(nextAccent(used));
		expect(person.itemCount).toBe(0);
		expect(person.name).toBe('Margaret Torcivia');
	});
});

describe('listPeople', () => {
	it('counts only non-deleted items and sorts by count desc then name', async () => {
		const meg = await makePerson(db, { name: 'Margaret' });
		const frank = await makePerson(db, { name: 'Frank' });
		const rose = await makePerson(db, { name: 'Rose' });
		const i1 = await makeItem(db, { uploadedBy: uploader.id });
		const i2 = await makeItem(db, { uploadedBy: uploader.id });
		const gone = await makeItem(db, { uploadedBy: uploader.id, deletedAt: new Date() });
		await tagPerson(db, i1.id, meg.id);
		await tagPerson(db, i2.id, meg.id);
		await tagPerson(db, i1.id, frank.id);
		await tagPerson(db, gone.id, frank.id);
		const out = await listPeople(db, stubStorage);
		expect(out.map((p) => [p.name, p.itemCount])).toEqual([
			['Margaret', 2], ['Frank', 1], ['Rose', 0]
		]);
	});

	it('resolves avatarUrl from the avatar item thumb_400 and parses the crop', async () => {
		const item = await makeItem(db, { uploadedBy: uploader.id });
		await addThumbs(db, item.id);
		const meg = await makePerson(db, {
			avatarItemId: item.id,
			avatarCrop: JSON.stringify({ x: 0.1, y: 0.2, w: 0.4, h: 0.5 })
		});
		await tagPerson(db, item.id, meg.id);
		const [p] = await listPeople(db, stubStorage);
		expect(p.avatarUrl).toBe(`/media/media/${item.id}/thumb_400.webp`);
		expect(p.avatarCrop).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.5 });
	});
});

describe('getPersonDetail', () => {
	it('returns null for a missing id', async () => {
		expect(await getPersonDetail(db, stubStorage, nanoid(12))).toBeNull();
	});

	it('builds year chunks with mid-year ages, stats and family', async () => {
		const meg = await makePerson(db, { name: 'Margaret', birthdate: '1941-03-15', deathDate: '2019-06-01' });
		const frank = await makePerson(db, { name: 'Frank' });
		await db.insert(schema.relationships).values({
			id: nanoid(12), personA: frank.id, personB: meg.id, type: 'spouse-of'
		});
		const mk = (iso: string) =>
			makeItem(db, { uploadedBy: uploader.id, dateStart: iso, dateEnd: iso, sortDate: iso });
		const a = await mk('1993-06-01');
		const b = await mk('1994-06-14');
		const c = await mk('1994-07-04');
		const undated = await makeItem(db, { uploadedBy: uploader.id, datePrecision: 'unknown' });
		for (const it of [a, b, c, undated]) await tagPerson(db, it.id, meg.id);

		const albumId = nanoid(12);
		await db.insert(schema.albums).values({
			id: albumId, title: 'Lake', createdBy: uploader.id, createdAt: new Date()
		});
		await db.insert(schema.albumItems).values({ albumId, itemId: b.id, position: 0 });

		const d = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(d.years).toEqual([
			{ year: 1993, count: 1, age: 52 },
			{ year: 1994, count: 2, age: 53 }
		]);
		expect(d.stats).toEqual({ moments: 4, onFilm: { from: 1993, to: 1994 }, albums: 1 });
		expect(d.family.spouses).toEqual([{ id: frank.id, name: 'Frank', accentColor: frank.accentColor }]);
		expect(d.linkedUsername).toBeNull();
	});

	it('reports the linked username', async () => {
		const meg = await makePerson(db, { name: 'Margaret' });
		await makeUser(db, { username: 'grandma', personId: meg.id });
		const d = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(d.linkedUsername).toBe('grandma');
	});
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/people.test.ts`
Expected: FAIL — "Failed to resolve import './people'".

- [ ] **Step 5: Write the service (read side + create)**

Create `src/lib/server/people.ts`:

```ts
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ageAt } from '$lib/domain/ages';
import { canonicalRel, familyOf, type Rel, type RelType } from '$lib/domain/relationships';
import { nextAccent } from '$lib/domain/accents';
import { ACCENTS } from '$lib/ui/tokens';
import type {
	CropRect, FamilyRefs, PersonDetailDTO, PersonListDTO, PersonRef
} from '$lib/domain/people-dto';
import type { Db } from './db';
import type { StorageAdapter } from './platform/types';
import {
	albumItems, albums, itemFiles, itemPeople, items, people, relationships, users
} from './db/schema';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCrop(raw: string | null): CropRect | null {
	if (!raw) return null;
	try {
		const c = JSON.parse(raw) as CropRect;
		return typeof c.x === 'number' ? c : null;
	} catch {
		return null;
	}
}

async function avatarUrls(
	db: Db, storage: StorageAdapter, avatarItemIds: string[], kind: 'thumb_400' | 'thumb_800'
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const ids = avatarItemIds.filter((v, i, a) => v && a.indexOf(v) === i);
	if (!ids.length) return map;
	const rows = await db
		.select({ itemId: itemFiles.itemId, key: itemFiles.storageKey })
		.from(itemFiles)
		.where(and(inArray(itemFiles.itemId, ids), eq(itemFiles.kind, kind)));
	for (const r of rows) map.set(r.itemId, await storage.mediaUrl(r.key));
	return map;
}

export async function listPeople(db: Db, storage: StorageAdapter): Promise<PersonListDTO[]> {
	const rows = await db
		.select({
			id: people.id,
			name: people.name,
			accentColor: people.accentColor,
			birthdate: people.birthdate,
			deathDate: people.deathDate,
			avatarItemId: people.avatarItemId,
			avatarCrop: people.avatarCrop,
			itemCount: sql<number>`count(case when ${items.id} is not null and ${items.deletedAt} is null then 1 end)`
		})
		.from(people)
		.leftJoin(itemPeople, eq(itemPeople.personId, people.id))
		.leftJoin(items, eq(items.id, itemPeople.itemId))
		.groupBy(people.id);
	const urls = await avatarUrls(db, storage, rows.map((r) => r.avatarItemId!).filter(Boolean), 'thumb_400');
	return rows
		.map((r) => ({
			id: r.id,
			name: r.name,
			accentColor: r.accentColor,
			birthdate: r.birthdate,
			deathDate: r.deathDate,
			avatarItemId: r.avatarItemId,
			avatarCrop: parseCrop(r.avatarCrop),
			avatarUrl: (r.avatarItemId && urls.get(r.avatarItemId)) || null,
			itemCount: r.itemCount
		}))
		.sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name));
}

export async function createPerson(
	db: Db,
	input: { name: string; birthdate?: string | null; deathDate?: string | null; birthPlace?: string | null }
): Promise<PersonListDTO> {
	for (const d of [input.birthdate, input.deathDate]) {
		if (d && !ISO_DATE.test(d)) error(400, 'dates must be ISO YYYY-MM-DD');
	}
	const used = [
		...(await db.select({ a: users.accentColor }).from(users)).map((r) => r.a),
		...(await db.select({ a: people.accentColor }).from(people)).map((r) => r.a)
	];
	const id = nanoid(12);
	const accentColor = nextAccent(used);
	await db.insert(people).values({
		id,
		name: input.name,
		birthdate: input.birthdate ?? null,
		deathDate: input.deathDate ?? null,
		birthPlace: input.birthPlace ?? null,
		accentColor,
		createdAt: new Date()
	});
	return {
		id, name: input.name, accentColor,
		birthdate: input.birthdate ?? null, deathDate: input.deathDate ?? null,
		avatarItemId: null, avatarCrop: null, avatarUrl: null, itemCount: 0
	};
}

export async function resolveFamily(db: Db, personId: string): Promise<FamilyRefs> {
	const relRows = await db.select().from(relationships);
	const rels: Rel[] = relRows.map((r) => ({ personA: r.personA, personB: r.personB, type: r.type }));
	const ids = familyOf(personId, rels);
	const all = [...new Set(Object.values(ids).flat())];
	const refs = new Map<string, PersonRef>();
	if (all.length) {
		const rows = await db
			.select({ id: people.id, name: people.name, accentColor: people.accentColor })
			.from(people)
			.where(inArray(people.id, all));
		for (const r of rows) refs.set(r.id, r);
	}
	const pick = (list: string[]) => list.map((id) => refs.get(id)).filter((p): p is PersonRef => !!p);
	return {
		parents: pick(ids.parents),
		children: pick(ids.children),
		spouses: pick(ids.spouses),
		siblings: pick(ids.siblings),
		grandparents: pick(ids.grandparents),
		grandchildren: pick(ids.grandchildren)
	};
}

export async function getPersonDetail(
	db: Db, storage: StorageAdapter, id: string
): Promise<PersonDetailDTO | null> {
	const row = (await db.select().from(people).where(eq(people.id, id)))[0];
	if (!row) return null;

	const liveTagged = and(eq(itemPeople.personId, id), isNull(items.deletedAt), eq(items.status, 'ready'));
	const yearRows = await db
		.select({
			year: sql<number>`cast(substr(${items.sortDate}, 1, 4) as integer)`,
			count: sql<number>`count(*)`
		})
		.from(items)
		.innerJoin(itemPeople, eq(itemPeople.itemId, items.id))
		.where(and(liveTagged, sql`${items.sortDate} is not null`))
		.groupBy(sql`1`)
		.orderBy(sql`1`);
	const years = yearRows.map((y) => ({
		year: y.year,
		count: y.count,
		age: row.birthdate ? ageAt(row.birthdate, `${y.year}-07-01`, row.deathDate) : null
	}));

	const [{ moments }] = await db
		.select({ moments: sql<number>`count(*)` })
		.from(items)
		.innerJoin(itemPeople, eq(itemPeople.itemId, items.id))
		.where(liveTagged);

	const [{ albumCount }] = await db
		.select({ albumCount: sql<number>`count(distinct ${albumItems.albumId})` })
		.from(albumItems)
		.innerJoin(itemPeople, eq(itemPeople.itemId, albumItems.itemId))
		.innerJoin(albums, eq(albums.id, albumItems.albumId))
		.where(and(eq(itemPeople.personId, id), isNull(albums.deletedAt)));

	const linked = (await db.select({ username: users.username }).from(users).where(eq(users.personId, id)))[0];
	const urls = row.avatarItemId
		? await avatarUrls(db, storage, [row.avatarItemId], 'thumb_800')
		: new Map<string, string>();

	return {
		id: row.id,
		name: row.name,
		accentColor: row.accentColor,
		birthdate: row.birthdate,
		deathDate: row.deathDate,
		birthPlace: row.birthPlace,
		bio: row.bio,
		avatarItemId: row.avatarItemId,
		avatarCrop: parseCrop(row.avatarCrop),
		avatarUrl: (row.avatarItemId && urls.get(row.avatarItemId)) || null,
		itemCount: moments,
		family: await resolveFamily(db, id),
		years,
		stats: {
			moments,
			onFilm: years.length ? { from: years[0].year, to: years[years.length - 1].year } : null,
			albums: albumCount
		},
		linkedUsername: linked?.username ?? null
	};
}
```

(The `canonicalRel`, `RelType`, `ACCENTS` and `ISO_DATE` imports are used by Task 4's additions to this same file — TypeScript may flag them as unused until then; if `pnpm check` complains, add them in Task 4 instead.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/people.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
pnpm check
git add src/lib/domain/people-dto.ts src/lib/server/testing/db.ts src/lib/server/people.ts src/lib/server/people.test.ts
git commit -m "feat: person service read side — list/create/detail with year chunks and family"
```

---

### Task 4: Person service (write side): update, guarded delete, relationship changes

**Files:**
- Modify: `src/lib/server/people.ts` (append)
- Test: `src/lib/server/people.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 module, `canonicalRel` (Task 1), `error` from `@sveltejs/kit`.
- Produces (appended to `src/lib/server/people.ts`):
  - `export const PERSON_PATCH_KEYS = ['name','birthdate','deathDate','birthPlace','bio','accentColor','avatarItemId','avatarCrop'] as const`
  - `export type PersonPatch = { name?: string; birthdate?: string|null; deathDate?: string|null; birthPlace?: string|null; bio?: string|null; accentColor?: string; avatarItemId?: string|null; avatarCrop?: CropRect|null }`
  - `export async function updatePerson(db: Db, id: string, patch: PersonPatch): Promise<void>` — throws SvelteKit `error(400)` on invalid accent (must be an `ACCENTS` hex), non-ISO dates, empty name, avatar item not tagged with the person, or out-of-bounds crop; `error(404)` on missing person.
  - `export async function deletePersonGuarded(db: Db, id: string): Promise<{ ok: true } | { ok: false; taggedCount: number }>` — refuses when `item_people` rows exist; on success removes relationships and nulls `users.personId`.
  - `export async function applyRelationshipChanges(db: Db, personId: string, changes: { add: Rel[]; remove: Rel[] }): Promise<FamilyRefs>` — validates ids/self/canonical ordering/duplicates; throws `error(400)`/`error(404)`/`error(409, 'duplicate relationship')`.

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/server/people.test.ts`:

```ts
import { applyRelationshipChanges, deletePersonGuarded, updatePerson } from './people';

describe('updatePerson', () => {
	it('rejects unknown accents, bad dates, empty names, missing person', async () => {
		const meg = await makePerson(db, {});
		await expect(updatePerson(db, meg.id, { accentColor: '#123456' })).rejects.toMatchObject({ status: 400 });
		await expect(updatePerson(db, meg.id, { birthdate: '14 June 1941' })).rejects.toMatchObject({ status: 400 });
		await expect(updatePerson(db, meg.id, { name: '  ' })).rejects.toMatchObject({ status: 400 });
		await expect(updatePerson(db, nanoid(12), { name: 'X' })).rejects.toMatchObject({ status: 404 });
	});

	it('rejects an avatar item the person is not tagged in, and bad crops', async () => {
		const meg = await makePerson(db, {});
		const item = await makeItem(db, { uploadedBy: uploader.id });
		await expect(updatePerson(db, meg.id, { avatarItemId: item.id })).rejects.toMatchObject({ status: 400 });
		await tagPerson(db, item.id, meg.id);
		await expect(
			updatePerson(db, meg.id, { avatarItemId: item.id, avatarCrop: { x: 0.8, y: 0, w: 0.4, h: 0.5 } })
		).rejects.toMatchObject({ status: 400 }); // x + w > 1
		await updatePerson(db, meg.id, { avatarItemId: item.id, avatarCrop: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 } });
		const d = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(d.avatarCrop).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.5 });
	});

	it('updates plain fields', async () => {
		const meg = await makePerson(db, { name: 'M' });
		await updatePerson(db, meg.id, {
			name: 'Margaret Torcivia', birthdate: '1941-03-15', deathDate: '2019-06-01',
			birthPlace: 'Brooklyn, New York', bio: 'Ran the kitchen.', accentColor: ACCENTS[7].hex
		});
		const d = (await getPersonDetail(db, stubStorage, meg.id))!;
		expect(d.name).toBe('Margaret Torcivia');
		expect(d.birthPlace).toBe('Brooklyn, New York');
		expect(d.accentColor).toBe(ACCENTS[7].hex);
	});
});

describe('deletePersonGuarded', () => {
	it('refuses with the tag count when item_people rows exist', async () => {
		const meg = await makePerson(db, {});
		const i1 = await makeItem(db, { uploadedBy: uploader.id });
		await tagPerson(db, i1.id, meg.id);
		expect(await deletePersonGuarded(db, meg.id)).toEqual({ ok: false, taggedCount: 1 });
	});

	it('deletes an untagged person, their rels, and unlinks users', async () => {
		const meg = await makePerson(db, {});
		const frank = await makePerson(db, {});
		await db.insert(schema.relationships).values({
			id: nanoid(12), personA: frank.id, personB: meg.id, type: 'spouse-of'
		});
		const acct = await makeUser(db, { personId: meg.id });
		expect(await deletePersonGuarded(db, meg.id)).toEqual({ ok: true });
		expect(await db.select().from(schema.people).where(eq(schema.people.id, meg.id))).toHaveLength(0);
		expect(await db.select().from(schema.relationships)).toHaveLength(0);
		const after = (await db.select().from(schema.users)).find((u) => u.id === acct.id)!;
		expect(after.personId).toBeNull();
	});

	it('404s on a missing person', async () => {
		await expect(deletePersonGuarded(db, nanoid(12))).rejects.toMatchObject({ status: 404 });
	});
});

describe('applyRelationshipChanges', () => {
	it('canonicalizes symmetric rels at write (personA < personB in storage)', async () => {
		const meg = await makePerson(db, { id: 'p-meg' });
		const frank = await makePerson(db, { id: 'p-frank' });
		await applyRelationshipChanges(db, meg.id, {
			add: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }], remove: []
		});
		const [row] = await db.select().from(schema.relationships);
		expect(row.personA).toBe('p-frank'); // 'p-frank' < 'p-meg'
		expect(row.personB).toBe('p-meg');
	});

	it('rejects self-rels, unknown people, and rels not involving the person', async () => {
		const meg = await makePerson(db, {});
		const other = await makePerson(db, {});
		const third = await makePerson(db, {});
		const bad = (add: object) =>
			applyRelationshipChanges(db, meg.id, { add: [add as never], remove: [] });
		await expect(bad({ personA: meg.id, personB: meg.id, type: 'spouse-of' })).rejects.toMatchObject({ status: 400 });
		await expect(bad({ personA: meg.id, personB: nanoid(12), type: 'spouse-of' })).rejects.toMatchObject({ status: 400 });
		await expect(bad({ personA: other.id, personB: third.id, type: 'spouse-of' })).rejects.toMatchObject({ status: 400 });
		await expect(bad({ personA: meg.id, personB: other.id, type: 'best-of' })).rejects.toMatchObject({ status: 400 });
	});

	it('409s on duplicates (already stored, either input order)', async () => {
		const meg = await makePerson(db, { id: 'p-meg' });
		await makePerson(db, { id: 'p-frank' });
		const add = { personA: 'p-frank', personB: 'p-meg', type: 'spouse-of' as const };
		await applyRelationshipChanges(db, meg.id, { add: [add], remove: [] });
		await expect(
			applyRelationshipChanges(db, meg.id, {
				add: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }], remove: []
			})
		).rejects.toMatchObject({ status: 409 });
	});

	it('removes rels given either order and returns the updated family', async () => {
		const meg = await makePerson(db, { id: 'p-meg', name: 'Margaret' });
		const frank = await makePerson(db, { id: 'p-frank', name: 'Frank' });
		const carol = await makePerson(db, { id: 'p-carol', name: 'Carol' });
		let family = await applyRelationshipChanges(db, meg.id, {
			add: [
				{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' },
				{ personA: 'p-meg', personB: 'p-carol', type: 'parent-of' }
			],
			remove: []
		});
		expect(family.spouses.map((p) => p.id)).toEqual([frank.id]);
		expect(family.children.map((p) => p.id)).toEqual([carol.id]);
		family = await applyRelationshipChanges(db, meg.id, {
			add: [], remove: [{ personA: 'p-meg', personB: 'p-frank', type: 'spouse-of' }]
		});
		expect(family.spouses).toEqual([]);
		expect(family.children.map((p) => p.id)).toEqual([carol.id]);
	});
});
```

Also add `import { eq } from 'drizzle-orm';` to the test file's imports if not already present.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run src/lib/server/people.test.ts`
Expected: FAIL — "does not provide an export named 'applyRelationshipChanges'".

- [ ] **Step 3: Append the implementation**

Append to `src/lib/server/people.ts`:

```ts
export const PERSON_PATCH_KEYS = [
	'name', 'birthdate', 'deathDate', 'birthPlace', 'bio', 'accentColor', 'avatarItemId', 'avatarCrop'
] as const;

export type PersonPatch = {
	name?: string;
	birthdate?: string | null;
	deathDate?: string | null;
	birthPlace?: string | null;
	bio?: string | null;
	accentColor?: string;
	avatarItemId?: string | null;
	avatarCrop?: CropRect | null;
};

function validCrop(c: CropRect): boolean {
	const nums = [c.x, c.y, c.w, c.h];
	return (
		nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
		c.w > 0 && c.h > 0 && c.x + c.w <= 1 && c.y + c.h <= 1
	);
}

export async function updatePerson(db: Db, id: string, patch: PersonPatch): Promise<void> {
	const row = (await db.select().from(people).where(eq(people.id, id)))[0];
	if (!row) error(404, 'person not found');

	if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim()))
		error(400, 'name must be a non-empty string');
	for (const d of [patch.birthdate, patch.deathDate])
		if (d != null && !ISO_DATE.test(d)) error(400, 'dates must be ISO YYYY-MM-DD');
	if (patch.accentColor !== undefined && !ACCENTS.some((a) => a.hex === patch.accentColor))
		error(400, 'accentColor must be one of the ACCENTS hexes');
	if (patch.avatarItemId != null) {
		const tagged = await db
			.select()
			.from(itemPeople)
			.where(and(eq(itemPeople.itemId, patch.avatarItemId), eq(itemPeople.personId, id)));
		if (!tagged.length) error(400, 'avatar item must be tagged with this person');
	}
	if (patch.avatarCrop != null && !validCrop(patch.avatarCrop)) error(400, 'invalid avatar crop');

	const set: Record<string, unknown> = {};
	if (patch.name !== undefined) set.name = patch.name.trim();
	if (patch.birthdate !== undefined) set.birthdate = patch.birthdate;
	if (patch.deathDate !== undefined) set.deathDate = patch.deathDate;
	if (patch.birthPlace !== undefined) set.birthPlace = patch.birthPlace;
	if (patch.bio !== undefined) set.bio = patch.bio;
	if (patch.accentColor !== undefined) set.accentColor = patch.accentColor;
	if (patch.avatarItemId !== undefined) set.avatarItemId = patch.avatarItemId;
	if (patch.avatarCrop !== undefined)
		set.avatarCrop = patch.avatarCrop === null ? null : JSON.stringify(patch.avatarCrop);
	if (Object.keys(set).length) await db.update(people).set(set).where(eq(people.id, id));
}

export async function deletePersonGuarded(
	db: Db, id: string
): Promise<{ ok: true } | { ok: false; taggedCount: number }> {
	const row = (await db.select().from(people).where(eq(people.id, id)))[0];
	if (!row) error(404, 'person not found');
	const [{ c }] = await db
		.select({ c: sql<number>`count(*)` })
		.from(itemPeople)
		.where(eq(itemPeople.personId, id));
	if (c > 0) return { ok: false, taggedCount: c };
	await db.delete(relationships).where(or(eq(relationships.personA, id), eq(relationships.personB, id)));
	await db.update(users).set({ personId: null }).where(eq(users.personId, id));
	await db.delete(people).where(eq(people.id, id));
	return { ok: true };
}

const REL_TYPES: RelType[] = ['parent-of', 'spouse-of', 'sibling-of'];
const relKey = (r: Rel) => `${r.personA}|${r.personB}|${r.type}`;

export async function applyRelationshipChanges(
	db: Db, personId: string, changes: { add: Rel[]; remove: Rel[] }
): Promise<FamilyRefs> {
	const row = (await db.select().from(people).where(eq(people.id, personId)))[0];
	if (!row) error(404, 'person not found');

	const all = [...changes.add, ...changes.remove];
	for (const r of all) {
		if (typeof r?.personA !== 'string' || typeof r?.personB !== 'string' || !REL_TYPES.includes(r.type))
			error(400, 'malformed relationship');
		if (r.personA === r.personB) error(400, 'a person cannot relate to themself');
		if (r.personA !== personId && r.personB !== personId)
			error(400, 'relationship must involve this person');
	}
	const otherIds = [...new Set(all.flatMap((r) => [r.personA, r.personB]))];
	if (otherIds.length) {
		const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, otherIds));
		if (found.length !== otherIds.length) error(400, 'unknown person id in relationship');
	}

	const adds = changes.add.map(canonicalRel);
	const removes = changes.remove.map(canonicalRel);
	const existing = new Set((await db.select().from(relationships)).map(relKey));
	const batch = new Set<string>();
	for (const r of adds) {
		const k = relKey(r);
		if (existing.has(k) || batch.has(k)) error(409, 'duplicate relationship');
		batch.add(k);
	}
	for (const r of removes) {
		await db
			.delete(relationships)
			.where(and(
				eq(relationships.personA, r.personA),
				eq(relationships.personB, r.personB),
				eq(relationships.type, r.type)
			));
	}
	for (const r of adds) {
		await db.insert(relationships).values({ id: nanoid(12), ...r });
	}
	return resolveFamily(db, personId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/people.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
pnpm check
git add src/lib/server/people.ts src/lib/server/people.test.ts
git commit -m "feat: person write side — validated patch, guarded delete, canonical relationship writes"
```

---

### Task 5: People API routes (Contract 6)

**Files:**
- Create: `src/routes/api/people/+server.ts` — Test: `src/routes/api/people/server.test.ts`
- Create: `src/routes/api/people/[id]/+server.ts` — Test: `src/routes/api/people/[id]/server.test.ts`
- Create: `src/routes/api/people/[id]/relationships/+server.ts` — Test: `src/routes/api/people/[id]/relationships/server.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `ROLE_RANK` (Contract 3), Tasks 3–4 service, testing helpers (Task 3).
- Produces (HTTP contract used by all later UI tasks):
  - `GET /api/people` (user+) → `200 { people: PersonListDTO[] }`
  - `POST /api/people` (editor+) `{ name, birthdate?, deathDate?, birthPlace? }` → `201 { person: PersonListDTO }`; missing/blank name → 400
  - `GET /api/people/[id]` (user+) → `200 { person: PersonDetailDTO }` | 404
  - `PATCH /api/people/[id]` (editor+ any `PERSON_PATCH_KEYS` field; OR the linked user — `locals.user.personId === id` — for `bio`/`birthPlace` ONLY, others → 403) → `200 { person: PersonDetailDTO }`
  - `DELETE /api/people/[id]` (admin+) → `200 { ok: true }` | `409 { error: 'person-in-use', count }`
  - `PATCH /api/people/[id]/relationships` (editor+) `{ add?: Rel[], remove?: Rel[] }` → `200 { family: FamilyRefs }`

- [ ] **Step 1: Write the failing tests**

Create `src/routes/api/people/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { GET, POST } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/people', {
			method: body ? 'POST' : 'GET',
			body: body ? JSON.stringify(body) : undefined,
			headers: body ? { 'content-type': 'application/json' } : undefined
		}),
		url: new URL('http://test/api/people')
	} as never;
}

describe('GET /api/people', () => {
	it('401s without a session', async () => {
		await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });
	});
	it('lists people for any signed-in user', async () => {
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		const res = await GET(evt(viewer));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ people: [] });
	});
});

describe('POST /api/people', () => {
	it('403s below editor', async () => {
		const up = sessionUser(await makeUser(db, { role: 'uploader' }));
		await expect(POST(evt(up, { name: 'X' }))).rejects.toMatchObject({ status: 403 });
	});
	it('400s on a blank name', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		await expect(POST(evt(ed, { name: '  ' }))).rejects.toMatchObject({ status: 400 });
	});
	it('creates and returns 201 for editors', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const res = await POST(evt(ed, { name: 'Margaret Torcivia', birthdate: '1941-03-15' }));
		expect(res.status).toBe(201);
		const { person } = await res.json();
		expect(person.name).toBe('Margaret Torcivia');
		expect(person.accentColor).toMatch(/^#/);
	});
});
```

Create `src/routes/api/people/[id]/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
	makeItem, makePerson, makeTestDb, makeUser, sessionUser, stubStorage, tagPerson, type TestDb
} from '$lib/server/testing/db';
import { DELETE, GET, PATCH } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, id: string, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/people/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body ?? {}),
			headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('GET /api/people/[id]', () => {
	it('404s for a missing person', async () => {
		const u = sessionUser(await makeUser(db, {}));
		await expect(GET(evt(u, 'nope'))).rejects.toMatchObject({ status: 404 });
	});
	it('returns the detail DTO', async () => {
		const u = sessionUser(await makeUser(db, {}));
		const meg = await makePerson(db, { name: 'Margaret' });
		const res = await GET(evt(u, meg.id));
		expect((await res.json()).person.name).toBe('Margaret');
	});
});

describe('PATCH /api/people/[id]', () => {
	it('lets an editor patch any field', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		const res = await PATCH(evt(ed, meg.id, { name: 'Margaret', birthPlace: 'Brooklyn, New York' }));
		expect((await res.json()).person.birthPlace).toBe('Brooklyn, New York');
	});
	it('lets the linked user patch bio and birthPlace only', async () => {
		const meg = await makePerson(db, {});
		const linked = sessionUser(await makeUser(db, { role: 'user', personId: meg.id }));
		const res = await PATCH(evt(linked, meg.id, { bio: 'My story.' }));
		expect((await res.json()).person.bio).toBe('My story.');
		await expect(PATCH(evt(linked, meg.id, { name: 'Nope' }))).rejects.toMatchObject({ status: 403 });
	});
	it('403s for an unlinked non-editor', async () => {
		const meg = await makePerson(db, {});
		const u = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(PATCH(evt(u, meg.id, { bio: 'x' }))).rejects.toMatchObject({ status: 403 });
	});
	it('400s on unknown fields', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(ed, meg.id, { nickname: 'Grandma' }))).rejects.toMatchObject({ status: 400 });
	});
});

describe('DELETE /api/people/[id]', () => {
	it('403s below admin', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(DELETE(evt(ed, meg.id))).rejects.toMatchObject({ status: 403 });
	});
	it('409s with the count when the person is tagged', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const ed = await makeUser(db, { role: 'editor' });
		const meg = await makePerson(db, {});
		const item = await makeItem(db, { uploadedBy: ed.id });
		await tagPerson(db, item.id, meg.id);
		const res = await DELETE(evt(admin, meg.id));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'person-in-use', count: 1 });
	});
	it('deletes an untagged person', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const meg = await makePerson(db, {});
		const res = await DELETE(evt(admin, meg.id));
		expect(await res.json()).toEqual({ ok: true });
	});
});
```

Create `src/routes/api/people/[id]/relationships/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makePerson, makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { PATCH } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, id: string, body: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/people/${id}/relationships`, {
			method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }
		})
	} as never;
}

describe('PATCH /api/people/[id]/relationships', () => {
	it('403s below editor', async () => {
		const u = sessionUser(await makeUser(db, { role: 'uploader' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(u, meg.id, { add: [] }))).rejects.toMatchObject({ status: 403 });
	});
	it('adds rels and returns the derived family', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, { name: 'Margaret' });
		const frank = await makePerson(db, { name: 'Frank' });
		const carol = await makePerson(db, { name: 'Carol' });
		const res = await PATCH(evt(ed, meg.id, {
			add: [
				{ personA: meg.id, personB: frank.id, type: 'spouse-of' },
				{ personA: meg.id, personB: carol.id, type: 'parent-of' }
			]
		}));
		const { family } = await res.json();
		expect(family.spouses.map((p: { name: string }) => p.name)).toEqual(['Frank']);
		expect(family.children.map((p: { name: string }) => p.name)).toEqual(['Carol']);
	});
	it('400s on a malformed body', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const meg = await makePerson(db, {});
		await expect(PATCH(evt(ed, meg.id, { add: 'nope' }))).rejects.toMatchObject({ status: 400 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/routes/api/people`
Expected: FAIL ×3 — "Failed to resolve import './+server'".

- [ ] **Step 3: Write the three route files**

Create `src/routes/api/people/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { createPerson, listPeople } from '$lib/server/people';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	return json({ people: await listPeople(locals.db, locals.platform.storage) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.name !== 'string' || !body.name.trim()) error(400, 'name is required');
	const person = await createPerson(locals.db, {
		name: (body.name as string).trim(),
		birthdate: (body.birthdate as string | null) ?? null,
		deathDate: (body.deathDate as string | null) ?? null,
		birthPlace: (body.birthPlace as string | null) ?? null
	});
	return json({ person }, { status: 201 });
};
```

Create `src/routes/api/people/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import {
	PERSON_PATCH_KEYS, deletePersonGuarded, getPersonDetail, updatePerson, type PersonPatch
} from '$lib/server/people';

const LINKED_USER_KEYS = ['bio', 'birthPlace'] as const;

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	if (!person) error(404, 'person not found');
	return json({ person });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'user');
	const isEditor = ROLE_RANK[user.role] >= ROLE_RANK.editor;
	const isLinked = user.personId === params.id;
	if (!isEditor && !isLinked) error(403, 'not allowed to edit this person');

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'invalid body');
	const allowed: readonly string[] = isEditor ? PERSON_PATCH_KEYS : LINKED_USER_KEYS;
	for (const key of Object.keys(body)) {
		if (!(PERSON_PATCH_KEYS as readonly string[]).includes(key)) error(400, `unknown field: ${key}`);
		if (!allowed.includes(key)) error(403, `linked users may only edit: ${LINKED_USER_KEYS.join(', ')}`);
	}
	await updatePerson(locals.db, params.id, body as PersonPatch);
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	return json({ person });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'admin');
	const result = await deletePersonGuarded(locals.db, params.id);
	if (!result.ok) return json({ error: 'person-in-use', count: result.taggedCount }, { status: 409 });
	return json({ ok: true });
};
```

Create `src/routes/api/people/[id]/relationships/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { applyRelationshipChanges } from '$lib/server/people';
import type { Rel } from '$lib/domain/relationships';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'editor');
	const body = (await request.json().catch(() => null)) as { add?: unknown; remove?: unknown } | null;
	if (!body || typeof body !== 'object') error(400, 'invalid body');
	const add = body.add ?? [];
	const remove = body.remove ?? [];
	if (!Array.isArray(add) || !Array.isArray(remove)) error(400, 'add and remove must be arrays');
	const family = await applyRelationshipChanges(locals.db, params.id, {
		add: add as Rel[], remove: remove as Rel[]
	});
	return json({ family });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/routes/api/people`
Expected: PASS (15 tests across 3 files).

- [ ] **Step 5: Commit**

```bash
pnpm check
git add src/routes/api/people
git commit -m "feat: people API — list/create/detail/patch/guarded-delete/relationships (Contract 6)"
```

---

### Task 6: Crop math, `CroppedPortrait`, `PersonCard`, `/people` index page

**Files:**
- Create: `src/lib/ui/crop.ts` — Test: `src/lib/ui/crop.test.ts`
- Create: `src/lib/ui/CroppedPortrait.svelte`
- Create: `src/lib/ui/PersonCard.svelte`
- Create: `src/routes/people/+page.server.ts`, `src/routes/people/+page.svelte`

**Interfaces:**
- Consumes: `listPeople` (Task 3), `PersonListDTO`/`CropRect` (Task 3), `personRoomFor` + `GRAIN_URI` (Contract 4), `ROLE_RANK` (Contract 3), `Nav.svelte` (Phase 01).
- Produces:
  - `crop.ts`: `export function cropStyle(c: CropRect): string` — CSS (`width/height/left/top` percentages) that makes the crop region exactly fill an overflow-hidden container whose aspect matches the crop's pixel aspect.
  - `CroppedPortrait.svelte` props: `{ url: string; crop: CropRect; name: string }` — fills its parent (parent sets size + `overflow` semantics).
  - `PersonCard.svelte` props: `{ person: PersonListDTO }` — square card, links to `/people/{id}`.

- [ ] **Step 1: Write the failing crop test**

Create `src/lib/ui/crop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cropStyle } from './crop';

describe('cropStyle', () => {
	it('scales and offsets so the crop region fills the container', () => {
		expect(cropStyle({ x: 0.25, y: 0.2, w: 0.5, h: 0.5 })).toBe(
			'width:200%;height:200%;left:-50%;top:-40%'
		);
	});
	it('is identity for the full-frame crop', () => {
		expect(cropStyle({ x: 0, y: 0, w: 1, h: 1 })).toBe('width:100%;height:100%;left:0%;top:0%');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/crop.test.ts`
Expected: FAIL — "Failed to resolve import './crop'".

- [ ] **Step 3: Implement `crop.ts`**

Create `src/lib/ui/crop.ts`:

```ts
import type { CropRect } from '$lib/domain/people-dto';

/**
 * CSS for an absolutely-positioned <img> inside an overflow:hidden box so that
 * the normalized crop region exactly fills the box. Distortion-free as long as
 * the box aspect equals the crop's PIXEL aspect (the picker enforces 4:5).
 */
export function cropStyle(c: CropRect): string {
	const pct = (n: number) => `${Number((n * 100).toFixed(4))}%`;
	return `width:${pct(1 / c.w)};height:${pct(1 / c.h)};left:${pct(-c.x / c.w)};top:${pct(-c.y / c.h)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/crop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the components and pages**

Create `src/lib/ui/CroppedPortrait.svelte`:

```svelte
<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { cropStyle } from './crop';

	let { url, crop, name }: { url: string; crop: CropRect; name: string } = $props();
</script>

<div class="portrait">
	<img src={url} alt={name} style={cropStyle(crop)} draggable="false" />
</div>

<style>
	.portrait {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 100%;
	}
	img {
		position: absolute;
		display: block;
		max-width: none;
	}
</style>
```

Create `src/lib/ui/PersonCard.svelte`:

```svelte
<script lang="ts">
	import type { PersonListDTO } from '$lib/domain/people-dto';
	import { personRoomFor } from '$lib/ui/tokens';
	import CroppedPortrait from './CroppedPortrait.svelte';

	let { person }: { person: PersonListDTO } = $props();

	const stops = $derived(personRoomFor(person.accentColor).stops);
	const lifespan = $derived.by(() => {
		const b = person.birthdate?.slice(0, 4);
		const d = person.deathDate?.slice(0, 4);
		if (b && d) return `${b}–${d}`;
		if (b) return `b. ${b}`;
		return '';
	});
	const initial = $derived(person.name.trim().charAt(0).toUpperCase());
</script>

<a class="card" href={`/people/${person.id}`} data-testid="person-card">
	<div class="sq">
		{#if person.avatarUrl && person.avatarCrop}
			<!-- stored crop is 4:5; center it vertically inside the square -->
			<div class="inner" data-testid="person-card-photo">
				<CroppedPortrait url={person.avatarUrl} crop={person.avatarCrop} name={person.name} />
			</div>
		{:else}
			<div
				class="fill"
				data-testid="person-card-fill"
				style:background={`linear-gradient(165deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 135%)`}
			>
				<span class="mono">{initial}</span>
			</div>
		{/if}
	</div>
	<span class="name">{person.name}</span>
	<span class="life">{lifespan || ' '}</span>
</a>

<style>
	.card {
		display: block;
		text-decoration: none;
		color: var(--cream);
	}
	.sq {
		position: relative;
		aspect-ratio: 1;
		overflow: hidden;
	}
	.inner {
		position: absolute;
		left: 0;
		width: 100%;
		height: 125%; /* 4:5 crop inside a square: overflow-crop vertically, centered */
		top: -12.5%;
	}
	.fill {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mono {
		font-family: var(--font-serif);
		font-size: 64px;
		color: var(--cream);
	}
	.name {
		display: block;
		font-family: var(--font-serif);
		font-size: 19px;
		margin-top: 8px;
		line-height: 1.2;
	}
	.life {
		display: block;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.6;
		margin-top: 3px;
		min-height: 12px;
	}
</style>
```

Create `src/routes/people/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ROLE_RANK } from '$lib/server/roles';
import { listPeople } from '$lib/server/people';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		people: await listPeople(locals.db, locals.platform.storage),
		canCreate: ROLE_RANK[locals.user.role] >= ROLE_RANK.editor
	};
};
```

Create `src/routes/people/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import Nav from '$lib/ui/Nav.svelte';
	import PersonCard from '$lib/ui/PersonCard.svelte';

	let { data } = $props();
	let creating = $state(false);
	let newName = $state('');
	let createError = $state('');

	async function createPerson(e: SubmitEvent) {
		e.preventDefault();
		createError = '';
		const res = await fetch('/api/people', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: newName })
		});
		if (!res.ok) {
			createError = 'Could not create person.';
			return;
		}
		const { person } = await res.json();
		await goto(`/people/${person.id}/edit`);
	}
</script>

<svelte:head><title>People — Shoebox</title></svelte:head>

<div class="page">
	<Nav />
	<header class="head">
		<span class="label">People</span>
		{#if data.canCreate}
			{#if creating}
				<form class="newform" onsubmit={createPerson}>
					<input name="name" placeholder="Full name" bind:value={newName} required minlength="1" />
					<button type="submit" data-testid="create-person">Add</button>
					<button type="button" onclick={() => (creating = false)}>Cancel</button>
				</form>
				{#if createError}<span class="err">{createError}</span>{/if}
			{:else}
				<button class="new" data-testid="new-person" onclick={() => (creating = true)}>New person</button>
			{/if}
		{/if}
	</header>
	<div class="grid" data-testid="people-grid">
		{#each data.people as person (person.id)}
			<PersonCard {person} />
		{/each}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--ink);
		color: var(--cream);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 38px 30px 0;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.new,
	.newform button {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		background: none;
		border: none;
		color: var(--dawn);
		cursor: pointer;
		min-height: 44px;
		padding: 0 12px;
	}
	.newform {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.newform input {
		font-family: var(--font-serif);
		font-size: 17px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		border: none;
		color: var(--cream);
		padding: 10px 14px;
		min-height: 44px;
	}
	.err {
		font-family: var(--font-sans);
		font-size: 11px;
		color: var(--dawn);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 22px 16px;
		padding: 26px 30px 60px;
	}
</style>
```

- [ ] **Step 6: Typecheck and verify visually**

Run: `pnpm check` — Expected: 0 errors.
Run: `pnpm dev`, sign in, open `http://localhost:5173/people` and verify:
- Square cards, **zero border-radius**, no borders on images.
- A person with no avatar shows an accent-derived gradient fill with a serif initial.
- Cards are ordered by item count descending.
- Serif name under the square; lifespan (e.g. `1941–2019`) in small uppercase sans beneath it.
- "New person" visible only for editor+; creating navigates to `/people/{id}/edit` (404 until Task 10 — expected for now).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/crop.ts src/lib/ui/crop.test.ts src/lib/ui/CroppedPortrait.svelte src/lib/ui/PersonCard.svelte src/routes/people
git commit -m "feat: people index — square avatar/gradient cards sorted by moment count"
```

---

### Task 7: Person page — room, hero, stats, family rows (LOCKED mockup)

**Files:**
- Create: `src/routes/people/[id]/+page.server.ts`
- Create: `src/routes/people/[id]/+page.svelte`

**Interfaces:**
- Consumes: `getPersonDetail` (Task 3), `personRoomFor`/`GRAIN_URI` (Contract 4), `ROLE_RANK` (Contract 3), `Avatar.svelte` (Phase 01, props `{ name, accentColor, size }`), `CroppedPortrait` (Task 6), `Nav.svelte`.
- Produces: `load` returns `{ person: PersonDetailDTO; canEdit: boolean; canEditBio: boolean; isLinked: boolean }` — Tasks 8–9 extend this page in place.

Open `docs/superpowers/specs/mockups/person-and-mobile-locked.html` in a browser side-by-side while building this. The geometry is locked:
- **NO tree view.** Family = label rows only.
- Portrait: **168×210**, hard-cropped, no border, no radius.
- Hero text **top-aligned with the portrait's top edge** (the `.who` column is `height: 210px; display:flex; flex-direction:column` — eyebrow first, then the 58px name).
- **Stats row locks to the portrait's bottom edge** via `margin-top: auto` inside that 210px column.
- Eyebrow: 11px sans, `.26em` tracking, uppercase — `1941 — 2019 · Born Brooklyn, New York`.
- Name: 58px serif, `line-height .95`, weight 400, `letter-spacing -.01em`. **No nickname line** (Resolution 1).
- Family label rows: 82px fixed label column (9.5px sans, `.2em`, uppercase, 45% cream), 17px serif names with **19px** inline accent avatars.

- [ ] **Step 1: Write the load function**

Create `src/routes/people/[id]/+page.server.ts`:

```ts
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ROLE_RANK } from '$lib/server/roles';
import { getPersonDetail } from '$lib/server/people';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	if (!person) error(404, 'Person not found');
	const isEditor = ROLE_RANK[locals.user.role] >= ROLE_RANK.editor;
	const isLinked = locals.user.personId === params.id;
	return { person, canEdit: isEditor, canEditBio: isEditor || isLinked, isLinked };
};
```

- [ ] **Step 2: Write the page**

Create `src/routes/people/[id]/+page.svelte`:

```svelte
<script lang="ts">
	import Nav from '$lib/ui/Nav.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import CroppedPortrait from '$lib/ui/CroppedPortrait.svelte';
	import { GRAIN_URI, personRoomFor } from '$lib/ui/tokens';
	import type { PersonRef } from '$lib/domain/people-dto';

	let { data } = $props();
	const person = $derived(data.person);

	const room = $derived(personRoomFor(person.accentColor));
	const roomBg = $derived(
		[
			...room.pools.map((p) => `radial-gradient(${p.size} at ${p.pos}, ${p.color} 0%, transparent 65%)`),
			`linear-gradient(165deg, ${room.stops[0]} 0%, ${room.stops[1]} 55%, ${room.stops[2]} 135%)`
		].join(', ')
	);

	const eyebrow = $derived.by(() => {
		const b = person.birthdate?.slice(0, 4);
		const d = person.deathDate?.slice(0, 4);
		const life = b ? (d ? `${b} — ${d}` : `b. ${b}`) : null;
		const born = person.birthPlace ? `Born ${person.birthPlace}` : null;
		return [life, born].filter(Boolean).join(' · ');
	});
	const onFilm = $derived.by(() => {
		const s = person.stats.onFilm;
		if (!s) return '—';
		return s.from === s.to ? String(s.from) : `${s.from}–${s.to}`;
	});
	const familyRows = $derived(
		(
			[
				['Parents', person.family.parents],
				['Spouse', person.family.spouses],
				['Children', person.family.children],
				['Siblings', person.family.siblings],
				['Grandparents', person.family.grandparents],
				['Grandkids', person.family.grandchildren]
			] as [string, PersonRef[]][]
		).filter(([, list]) => list.length > 0)
	);
	const initial = $derived(person.name.trim().charAt(0).toUpperCase());
</script>

<svelte:head><title>{person.name} — Shoebox</title></svelte:head>

<div class="room" data-testid="person-room" data-accent={person.accentColor} style:background={roomBg}>
	<div class="grain" style:background-image={`url("${GRAIN_URI}")`}></div>
	<div class="content">
		<Nav />

		<div class="hero">
			<div class="por" data-testid="person-portrait">
				{#if person.avatarUrl && person.avatarCrop}
					<CroppedPortrait url={person.avatarUrl} crop={person.avatarCrop} name={person.name} />
				{:else}
					<div
						class="por-fill"
						style:background={`linear-gradient(165deg, ${room.stops[1]} 0%, ${room.stops[2]} 135%)`}
					>
						<span>{initial}</span>
					</div>
				{/if}
			</div>
			<div class="who">
				{#if eyebrow}<div class="eyebrow" data-testid="person-eyebrow">{eyebrow}</div>{/if}
				<h1 data-testid="person-name">{person.name}</h1>
				<div class="stats">
					<span><b data-testid="stat-moments">{person.stats.moments}</b>Moments</span>
					<span><b data-testid="stat-onfilm">{onFilm}</b>On film</span>
					<span><b data-testid="stat-albums">{person.stats.albums}</b>Albums</span>
				</div>
			</div>
		</div>

		<div class="body">
			<div class="bio">
				<div class="label">Story</div>
				<!-- Task 8 replaces this block with rendered markdown + edit affordance -->
				<p class="bio-text" data-testid="person-bio">{person.bio ?? 'No story yet.'}</p>
			</div>
			<div class="fam" data-testid="family-rows">
				<div class="label">Family</div>
				{#each familyRows as [label, members] (label)}
					<div class="grp" data-testid={`family-row-${label.toLowerCase()}`}>
						<span class="g">{label}</span>
						<span class="names">
							{#each members as m (m.id)}
								<a class="p" href={`/people/${m.id}`}>
									<Avatar name={m.name} accentColor={m.accentColor} size={19} />{m.name}
								</a>
							{/each}
						</span>
					</div>
				{/each}
				{#if data.canEdit}
					<a class="editlink" href={`/people/${person.id}/edit`} data-testid="edit-person">Edit person</a>
				{/if}
			</div>
		</div>

		<!-- Task 9 appends the year-chunked timeline here -->
	</div>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}
	.grain {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		opacity: 0.5;
		mix-blend-mode: overlay;
	}
	.content {
		position: relative;
		z-index: 2;
		padding-bottom: 80px;
	}

	.hero {
		display: flex;
		gap: 30px;
		align-items: flex-start;
		padding: 38px 30px 0;
	}
	.por {
		width: 168px;
		height: 210px;
		flex: none;
	}
	.por-fill {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.por-fill span {
		font-family: var(--font-serif);
		font-size: 72px;
	}
	.who {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 210px;
		min-width: 0;
	}
	.eyebrow {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
		margin: 2px 0 10px;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: 58px;
		line-height: 0.95;
		margin: 0;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	.stats {
		margin-top: auto;
		display: flex;
		gap: 34px;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
	}
	.stats b {
		display: block;
		font-family: var(--font-serif);
		font-size: 22px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--cream);
		margin-bottom: 3px;
		font-weight: 400;
	}

	.body {
		display: flex;
		gap: 44px;
		padding: 30px 30px 0;
	}
	.bio {
		flex: 1.45;
		min-width: 0;
	}
	.bio-text {
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
		margin: 0;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		margin-bottom: 14px;
	}
	.fam {
		flex: 1;
		min-width: 0;
	}
	.grp {
		margin-bottom: 16px;
		display: flex;
		align-items: baseline;
		gap: 14px;
	}
	.g {
		flex: none;
		width: 82px;
		font-family: var(--font-sans);
		font-size: 9.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
	}
	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		font-family: var(--font-serif);
		font-size: 17px;
	}
	.p {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--cream);
		text-decoration: none;
		min-height: 24px;
	}
	.editlink {
		display: inline-block;
		margin-top: 8px;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		text-decoration: none;
		min-height: 44px;
		line-height: 44px;
	}

	@media (max-width: 720px) {
		.hero {
			gap: 18px;
		}
		.por {
			width: 128px;
			height: 160px;
		}
		.who {
			height: 160px;
		}
		h1 {
			font-size: 34px;
		}
		.stats {
			gap: 20px;
		}
		.body {
			flex-direction: column;
			gap: 30px;
		}
	}
</style>
```

- [ ] **Step 3: Typecheck and verify against the LOCKED mockup**

Run: `pnpm check` — Expected: 0 errors.
Run: `pnpm dev`, open a person page (create one via `/people` if needed, PATCH birthdate/deathDate/birthPlace via `/api/people/[id]` or wait for Task 10) and verify against `person-and-mobile-locked.html` left panel:
- Room gradient derives from the person's accent (`data-accent` attribute matches), grain overlay present, full nav on top.
- Eyebrow reads exactly like `1941 — 2019 · Born Brooklyn, New York` (em-dash with spaces, `·` separator).
- The eyebrow/name block's top edge is level with the portrait's top edge; the Moments / On film / Albums stats baseline sits at the portrait's bottom edge (resize the window: the lock must hold).
- Portrait is 168×210 with a hard crop (no radius, no border). Gradient+initial fallback when no avatar.
- **There is no tree view and no nickname line.**
- Family rows render as label rows (SPOUSE / CHILDREN / …) with 19px accent monogram avatars inline; every name links to that person's page.
- No italics anywhere; only Fraunces/Archivo.

- [ ] **Step 4: Commit**

```bash
git add src/routes/people/[id]
git commit -m "feat: person page hero, stats lock, family label rows per locked mockup"
```

---

### Task 8: Bio — markdown rendering + own-bio editing

**Files:**
- Modify: `package.json` (add `marked`, `isomorphic-dompurify`)
- Create: `src/lib/ui/markdown.ts` — Test: `src/lib/ui/markdown.test.ts`
- Modify: `src/routes/people/[id]/+page.svelte` (bio block from Task 7)

**Interfaces:**
- Consumes: `PATCH /api/people/[id]` (Task 5 — linked user may send `bio`), Task 7 page.
- Produces: `export function renderMarkdown(md: string): string` — sanitized HTML (isomorphic: node + browser).

- [ ] **Step 1: Install dependencies**

Run: `pnpm add marked isomorphic-dompurify`
Expected: both appear under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/ui/markdown.test.ts`:

```ts
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
	it('renders lists', () => {
		expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>');
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/markdown.test.ts`
Expected: FAIL — "Failed to resolve import './markdown'".

- [ ] **Step 4: Implement**

Create `src/lib/ui/markdown.ts`:

```ts
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Bio markdown → sanitized HTML. `em` is allowed through but CSS forces
 * font-style: normal (italics are forbidden app-wide — Global Constraints).
 */
export function renderMarkdown(md: string): string {
	const html = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4'],
		ALLOWED_ATTR: ['href']
	});
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ui/markdown.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the bio block into the person page**

In `src/routes/people/[id]/+page.svelte`, replace the Task 7 bio block

```svelte
				<div class="label">Story</div>
				<!-- Task 8 replaces this block with rendered markdown + edit affordance -->
				<p class="bio-text" data-testid="person-bio">{person.bio ?? 'No story yet.'}</p>
```

with:

```svelte
				<div class="label">Story</div>
				{#if editingBio}
					<textarea
						class="bio-edit"
						data-testid="bio-textarea"
						bind:value={bioDraft}
						rows="8"
						placeholder="Their story, in markdown…"
					></textarea>
					<div class="bio-actions">
						<button data-testid="bio-save" onclick={saveBio} disabled={bioSaving}>Save</button>
						<button onclick={() => (editingBio = false)}>Cancel</button>
						{#if bioError}<span class="bio-err">{bioError}</span>{/if}
					</div>
				{:else}
					{#if person.bio}
						<div class="bio-text bio-md" data-testid="person-bio">{@html renderMarkdown(person.bio)}</div>
					{:else}
						<p class="bio-text" data-testid="person-bio">No story yet.</p>
					{/if}
					{#if data.canEditBio}
						<button class="edit" data-testid="edit-bio" onclick={startBioEdit}>
							{data.isLinked && !data.canEdit
								? 'Edit bio — you are linked to this person'
								: 'Edit bio'}
						</button>
					{/if}
				{/if}
```

Add to the `<script>` block:

```ts
	import { invalidateAll } from '$app/navigation';
	import { renderMarkdown } from '$lib/ui/markdown';

	let editingBio = $state(false);
	let bioDraft = $state('');
	let bioSaving = $state(false);
	let bioError = $state('');

	function startBioEdit() {
		bioDraft = person.bio ?? '';
		bioError = '';
		editingBio = true;
	}
	async function saveBio() {
		bioSaving = true;
		bioError = '';
		const res = await fetch(`/api/people/${person.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ bio: bioDraft })
		});
		bioSaving = false;
		if (!res.ok) {
			bioError = 'Could not save.';
			return;
		}
		editingBio = false;
		await invalidateAll();
	}
```

Add to the `<style>` block:

```css
	.bio-md :global(p) {
		margin: 0 0 12px;
	}
	.bio-md :global(em) {
		font-style: normal; /* italics forbidden app-wide */
	}
	.bio-md :global(a) {
		color: var(--dawn);
		text-decoration: none;
	}
	.bio-edit {
		width: 100%;
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		border: none;
		padding: 14px;
	}
	.bio-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}
	.bio-actions button,
	.edit {
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		background: none;
		border: none;
		cursor: pointer;
		min-height: 44px;
		padding: 0 10px 0 0;
		text-align: left;
	}
	.bio-actions button[data-testid='bio-save'] {
		color: var(--dawn);
	}
	.bio-err {
		font-family: var(--font-sans);
		font-size: 11px;
		color: var(--dawn);
	}
	.edit {
		display: block;
		margin-top: 12px;
	}
```

- [ ] **Step 7: Verify**

Run: `pnpm check` — Expected: 0 errors.
Run: `pnpm vitest run src/lib/ui` — Expected: PASS.
Manual: as an editor, "Edit bio" appears; as a linked non-editor user the copy is exactly **"Edit bio — you are linked to this person"** (mockup's `.edit` treatment: 10px sans, `.2em`, uppercase, 45% cream). `**bold**` markdown renders as `<strong>`; `*italic*` renders upright (no italics).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/ui/markdown.ts src/lib/ui/markdown.test.ts src/routes/people/[id]/+page.svelte
git commit -m "feat: person bio — sanitized markdown rendering and own-bio editing"
```

---

### Task 9: Person timeline — year-chunked masonry with age captions

**Files:**
- Modify: `src/lib/ui/MediaCard.svelte` (add `captionRight` prop)
- Modify: `src/lib/ui/MasonryGrid.svelte` (add `captionRightFor` prop)
- Create: `src/lib/ui/age-caption.ts` — Test: `src/lib/ui/age-caption.test.ts`
- Create: `src/lib/ui/PersonYearSection.svelte`
- Modify: `src/routes/people/[id]/+page.svelte` (append the years block)

**Interfaces:**
- Consumes: `MasonryGrid`/`MediaCard` (Phase 03), `GET /api/items?people=<id>&year=<y>&limit=100` (Contract 6), `ItemDTO` (Contract 6 — `people[].age` already computed by Phase 02), `person.years` (Task 3).
- Produces:
  - `MediaCard.svelte` new prop: `captionRight?: string | null` (default `null`) — when set, replaces the caption row's right-hand people/event text; existing callers unchanged.
  - `MasonryGrid.svelte` new prop: `captionRightFor?: ((item: ItemDTO) => string | null) | null` (default `null`), forwarded per item as `captionRight`.
  - `export function ageCaption(item: ItemDTO, personId: string): string | null` — `"age 53"` or null.
  - `PersonYearSection.svelte` props: `{ personId: string; year: number; count: number; age: number | null; allYears: number[] }`.

- [ ] **Step 1: Write the failing caption test**

Create `src/lib/ui/age-caption.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ItemDTO } from '$lib/domain/dtos';
import { ageCaption } from './age-caption';

const item = (people: { id: string; name: string; accentColor: string; age?: number }[]) =>
	({ people }) as unknown as ItemDTO;

describe('ageCaption', () => {
	it('returns "age N" for the tagged person', () => {
		expect(ageCaption(item([{ id: 'p1', name: 'M', accentColor: '#FA7B62', age: 53 }]), 'p1')).toBe('age 53');
	});
	it('returns null when the person has no age on this item', () => {
		expect(ageCaption(item([{ id: 'p1', name: 'M', accentColor: '#FA7B62' }]), 'p1')).toBeNull();
	});
	it('returns null when the person is not on the item', () => {
		expect(ageCaption(item([]), 'p1')).toBeNull();
	});
	it('treats age 0 as valid', () => {
		expect(ageCaption(item([{ id: 'p1', name: 'M', accentColor: '#FA7B62', age: 0 }]), 'p1')).toBe('age 0');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/age-caption.test.ts`
Expected: FAIL — "Failed to resolve import './age-caption'".

- [ ] **Step 3: Implement `age-caption.ts`**

Create `src/lib/ui/age-caption.ts`:

```ts
import type { ItemDTO } from '$lib/domain/dtos';

/** Right-side caption for a person timeline card: "age 53" (mockup), else null. */
export function ageCaption(item: ItemDTO, personId: string): string | null {
	const p = item.people.find((p) => p.id === personId);
	return p && p.age != null ? `age ${p.age}` : null;
}
```

Run: `pnpm vitest run src/lib/ui/age-caption.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 4: Add the caption props to the Phase 03 components**

These are surgical edits to existing Phase 03/04 files — match the file's existing style; do not restructure anything else.

`src/lib/ui/MediaCard.svelte`:
1. In the `$props()` destructure add `captionRight = null` and extend the prop type with `captionRight?: string | null`.
2. In the caption row markup, the right-hand span currently renders the people/event text (e.g. `{rightLabel}` or similar). Change it to prefer the override:

```svelte
<span class="cap-right">{captionRight ?? rightLabel}</span>
```

(keep the existing variable name for the default — only wrap it with `captionRight ?? …`).

`src/lib/ui/MasonryGrid.svelte`:
1. In the `$props()` destructure add `captionRightFor = null` typed `((item: ItemDTO) => string | null) | null`.
2. Where each `MediaCard` is rendered, pass the computed override:

```svelte
<MediaCard {item} captionRight={captionRightFor ? captionRightFor(item) : null} />
```

Run: `pnpm check` — Expected: 0 errors. Run `pnpm vitest run` — Expected: all existing Phase 03/04 component tests still PASS (props are additive with null defaults).

- [ ] **Step 5: Write `PersonYearSection.svelte`**

Create `src/lib/ui/PersonYearSection.svelte`:

```svelte
<script lang="ts">
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import { ageCaption } from '$lib/ui/age-caption';
	import type { ItemDTO } from '$lib/domain/dtos';

	let {
		personId,
		year,
		count,
		age,
		allYears
	}: { personId: string; year: number; count: number; age: number | null; allYears: number[] } =
		$props();

	let items = $state<ItemDTO[]>([]);
	let loaded = $state(false);

	$effect(() => {
		let cancelled = false;
		fetch(`/api/items?people=${personId}&year=${year}&limit=100`)
			.then((r) => r.json())
			.then((d) => {
				if (!cancelled) {
					items = d.items;
					loaded = true;
				}
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<section class="years" id={`y-${year}`} data-testid={`year-${year}`}>
	<header class="yhdr">
		<h3>{year}</h3>
		<span class="age" data-testid={`year-meta-${year}`}>
			{age != null ? `Age ${age} · ` : ''}{count} {count === 1 ? 'moment' : 'moments'}
		</span>
		<details class="jump">
			<summary>All years ↓</summary>
			<nav>
				{#each allYears as y (y)}
					<a href={`#y-${y}`}>{y}</a>
				{/each}
			</nav>
		</details>
	</header>
	{#if loaded}
		<MasonryGrid {items} captionRightFor={(item) => ageCaption(item, personId)} />
	{/if}
</section>

<style>
	.years {
		padding: 34px 30px 0;
	}
	.yhdr {
		display: flex;
		align-items: baseline;
		gap: 20px;
	}
	h3 {
		font-family: var(--font-serif);
		font-size: 34px;
		font-weight: 400;
		margin: 0 0 16px;
	}
	.age {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--dawn) 70%, var(--cream) 30%);
	}
	.jump {
		margin-left: auto;
		position: relative;
	}
	.jump summary {
		list-style: none;
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	.jump summary::-webkit-details-marker {
		display: none;
	}
	.jump nav {
		position: absolute;
		right: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		background: var(--ink);
		padding: 8px 0;
		max-height: 40vh;
		overflow-y: auto;
	}
	.jump nav a {
		font-family: var(--font-serif);
		font-size: 16px;
		color: var(--cream);
		text-decoration: none;
		padding: 8px 22px;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
</style>
```

- [ ] **Step 6: Append the timeline to the person page**

In `src/routes/people/[id]/+page.svelte`, replace

```svelte
		<!-- Task 9 appends the year-chunked timeline here -->
```

with:

```svelte
		{#each person.years as y (y.year)}
			<PersonYearSection
				personId={person.id}
				year={y.year}
				count={y.count}
				age={y.age}
				allYears={person.years.map((yy) => yy.year)}
			/>
		{/each}
```

and add `import PersonYearSection from '$lib/ui/PersonYearSection.svelte';` to the script block.

- [ ] **Step 7: Verify against the mockup**

Run: `pnpm check && pnpm vitest run src/lib/ui` — Expected: 0 errors / PASS.
Manual, against the locked mockup's `.years` block: year header = 34px serif year + `Age 53 · 18 moments` in dawn-tinted 11px caps + `All years ↓` right-aligned; masonry cards show the short date left and `age N` right in the caption row; the jump menu scrolls to `#y-<year>` anchors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ui/MediaCard.svelte src/lib/ui/MasonryGrid.svelte src/lib/ui/age-caption.ts src/lib/ui/age-caption.test.ts src/lib/ui/PersonYearSection.svelte src/routes/people/[id]/+page.svelte
git commit -m "feat: person timeline — year-chunked masonry with age captions and year jump"
```

---

### Task 10: Person edit page — fields, accent swatches, avatar pick + crop drag

**Files:**
- Modify: `src/lib/ui/crop.ts` (add picker math) — Test: `src/lib/ui/crop.test.ts` (append)
- Create: `src/lib/ui/AccentSwatches.svelte`
- Create: `src/lib/ui/CropPicker.svelte`
- Create: `src/routes/people/[id]/edit/+page.server.ts`, `src/routes/people/[id]/edit/+page.svelte`

**Interfaces:**
- Consumes: `getPersonDetail`/`listPeople` (Task 3), `PATCH`/`DELETE /api/people/[id]` (Task 5), `GET /api/items?people=<id>&limit=100` (Contract 6), `ACCENTS` (Contract 4), `requireRole` (Contract 3).
- Produces:
  - `crop.ts`: `export function makePortraitCrop(imgW: number, imgH: number, hFrac: number, cx: number, cy: number): CropRect` — crop centered on `(cx, cy)` (normalized), height fraction `hFrac`, **pixel aspect locked to 4:5** (`(w·imgW)/(h·imgH) = 0.8`), clamped inside the image.
  - `AccentSwatches.svelte` props: `{ value: string (bindable) }` — 44px swatch buttons for each `ACCENTS` hex.
  - `CropPicker.svelte` props: `{ imageUrl: string; imageW: number; imageH: number; crop: CropRect (bindable) }` — drag to move, range slider to zoom.
  - Route `/people/[id]/edit` (editor+; Task 11 appends the relationships editor to this page).

- [ ] **Step 1: Append the failing crop-math tests**

Append to `src/lib/ui/crop.test.ts`:

```ts
import { makePortraitCrop } from './crop';

describe('makePortraitCrop', () => {
	it('locks pixel aspect to 4:5 on a square image', () => {
		const c = makePortraitCrop(1000, 1000, 0.5, 0.5, 0.5);
		expect(c.h).toBeCloseTo(0.5);
		expect(c.w).toBeCloseTo(0.4); // (0.4*1000)/(0.5*1000) = 0.8
		expect(c.x).toBeCloseTo(0.3);
		expect(c.y).toBeCloseTo(0.25);
	});
	it('locks pixel aspect on a landscape image', () => {
		const c = makePortraitCrop(1600, 900, 0.8, 0.5, 0.5);
		expect((c.w * 1600) / (c.h * 900)).toBeCloseTo(0.8);
	});
	it('clamps the rect inside the image', () => {
		const c = makePortraitCrop(1000, 1000, 0.5, 0.02, 0.98);
		expect(c.x).toBeCloseTo(0);
		expect(c.y).toBeCloseTo(0.5);
	});
	it('caps zoom when the requested height would overflow the width', () => {
		// very tall image: full-height 4:5 crop would need w > 1
		const c = makePortraitCrop(400, 2000, 1, 0.5, 0.5);
		expect(c.w).toBeLessThanOrEqual(1);
		expect((c.w * 400) / (c.h * 2000)).toBeCloseTo(0.8);
	});
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm vitest run src/lib/ui/crop.test.ts`
Expected: FAIL — "does not provide an export named 'makePortraitCrop'".

- [ ] **Step 3: Implement the picker math**

Append to `src/lib/ui/crop.ts`:

```ts
const PORTRAIT_ASPECT = 168 / 210; // 4:5 — the locked hero portrait

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Build a normalized crop rect centered on (cx, cy) with height fraction hFrac,
 * pixel aspect locked to 4:5, clamped inside the image.
 */
export function makePortraitCrop(
	imgW: number, imgH: number, hFrac: number, cx: number, cy: number
): CropRect {
	const maxH = Math.min(1, imgW / (PORTRAIT_ASPECT * imgH));
	const h = clamp(hFrac, 0.1, maxH);
	const w = (PORTRAIT_ASPECT * h * imgH) / imgW;
	return {
		x: clamp(cx - w / 2, 0, 1 - w),
		y: clamp(cy - h / 2, 0, 1 - h),
		w,
		h
	};
}
```

Run: `pnpm vitest run src/lib/ui/crop.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 4: Write the swatches and crop picker components**

Create `src/lib/ui/AccentSwatches.svelte`:

```svelte
<script lang="ts">
	import { ACCENTS } from '$lib/ui/tokens';

	let { value = $bindable() }: { value: string } = $props();
</script>

<div class="swatches" role="radiogroup" aria-label="Accent color">
	{#each ACCENTS as a (a.hex)}
		<button
			type="button"
			class="sw"
			class:active={value === a.hex}
			style:background={a.hex}
			role="radio"
			aria-checked={value === a.hex}
			aria-label={`Accent ${a.hex}`}
			data-testid={`accent-${a.hex.slice(1)}`}
			onclick={() => (value = a.hex)}
		></button>
	{/each}
</div>

<style>
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.sw {
		width: 44px;
		height: 44px;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	.sw.active {
		outline: 3px solid var(--cream);
		outline-offset: 2px;
	}
</style>
```

Create `src/lib/ui/CropPicker.svelte`:

```svelte
<script lang="ts">
	import type { CropRect } from '$lib/domain/people-dto';
	import { makePortraitCrop } from './crop';

	let {
		imageUrl,
		imageW,
		imageH,
		crop = $bindable()
	}: { imageUrl: string; imageW: number; imageH: number; crop: CropRect } = $props();

	let stage: HTMLDivElement;
	let dragging = $state(false);

	const center = () => ({ cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 });

	function pointAt(e: PointerEvent) {
		const r = stage.getBoundingClientRect();
		return { cx: (e.clientX - r.left) / r.width, cy: (e.clientY - r.top) / r.height };
	}
	function onDown(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onMove(e);
	}
	function onMove(e: PointerEvent) {
		if (!dragging) return;
		const p = pointAt(e);
		crop = makePortraitCrop(imageW, imageH, crop.h, p.cx, p.cy);
	}
	function onZoom(e: Event) {
		const h = Number((e.currentTarget as HTMLInputElement).value);
		const { cx, cy } = center();
		crop = makePortraitCrop(imageW, imageH, h, cx, cy);
	}
</script>

<div class="picker">
	<div
		class="stage"
		bind:this={stage}
		style:aspect-ratio={`${imageW} / ${imageH}`}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={() => (dragging = false)}
		data-testid="crop-stage"
	>
		<img src={imageUrl} alt="Avatar source" draggable="false" />
		<div
			class="rect"
			style:left={`${crop.x * 100}%`}
			style:top={`${crop.y * 100}%`}
			style:width={`${crop.w * 100}%`}
			style:height={`${crop.h * 100}%`}
		></div>
	</div>
	<label class="zoom">
		<span>Zoom</span>
		<input type="range" min="0.1" max="1" step="0.01" value={crop.h} oninput={onZoom} />
	</label>
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		overflow: hidden;
		touch-action: none;
		cursor: crosshair;
	}
	.stage img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		user-select: none;
	}
	.rect {
		position: absolute;
		outline: 2px solid var(--cream);
		box-shadow: 0 0 0 9999px color-mix(in srgb, var(--ink) 55%, transparent);
		pointer-events: none;
	}
	.zoom {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
	}
	.zoom input {
		flex: 1;
		min-height: 44px;
		accent-color: var(--dawn);
	}
</style>
```

- [ ] **Step 5: Write the edit route**

Create `src/routes/people/[id]/edit/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ROLE_RANK, requireRole } from '$lib/server/roles';
import { getPersonDetail, listPeople } from '$lib/server/people';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireRole(locals, 'editor');
	const person = await getPersonDetail(locals.db, locals.platform.storage, params.id);
	if (!person) error(404, 'Person not found');
	const all = await listPeople(locals.db, locals.platform.storage);
	return {
		person,
		others: all
			.filter((p) => p.id !== params.id)
			.map(({ id, name, accentColor }) => ({ id, name, accentColor })),
		isAdmin: ROLE_RANK[locals.user!.role] >= ROLE_RANK.admin
	};
};
```

Create `src/routes/people/[id]/edit/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import Nav from '$lib/ui/Nav.svelte';
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';
	import CropPicker from '$lib/ui/CropPicker.svelte';
	import { makePortraitCrop } from '$lib/ui/crop';
	import type { CropRect } from '$lib/domain/people-dto';
	import type { ItemDTO } from '$lib/domain/dtos';

	let { data } = $props();
	const person = data.person;

	let name = $state(person.name);
	let birthdate = $state(person.birthdate ?? '');
	let deathDate = $state(person.deathDate ?? '');
	let birthPlace = $state(person.birthPlace ?? '');
	let accentColor = $state(person.accentColor);
	let avatarItemId = $state<string | null>(person.avatarItemId);
	let avatarCrop = $state<CropRect | null>(person.avatarCrop);
	let saveError = $state('');
	let deleteError = $state('');

	let taggedItems = $state<ItemDTO[]>([]);
	$effect(() => {
		fetch(`/api/items?people=${person.id}&limit=100`)
			.then((r) => r.json())
			.then((d) => (taggedItems = d.items));
	});
	const selectedItem = $derived(taggedItems.find((i) => i.id === avatarItemId) ?? null);

	function pickAvatar(item: ItemDTO) {
		avatarItemId = item.id;
		avatarCrop = makePortraitCrop(item.width, item.height, 0.9, 0.5, 0.4);
	}
	function clearAvatar() {
		avatarItemId = null;
		avatarCrop = null;
	}

	async function save() {
		saveError = '';
		const res = await fetch(`/api/people/${person.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name,
				birthdate: birthdate || null,
				deathDate: deathDate || null,
				birthPlace: birthPlace || null,
				accentColor,
				avatarItemId,
				avatarCrop
			})
		});
		if (!res.ok) {
			saveError = ((await res.json().catch(() => null)) as { message?: string })?.message ?? 'Could not save.';
			return;
		}
		await goto(`/people/${person.id}`);
	}

	async function destroy() {
		deleteError = '';
		if (!confirm(`Delete ${person.name}? This cannot be undone.`)) return;
		const res = await fetch(`/api/people/${person.id}`, { method: 'DELETE' });
		if (res.status === 409) {
			const body = await res.json();
			deleteError = `Still tagged in ${body.count} item${body.count === 1 ? '' : 's'} — untag first.`;
			return;
		}
		if (!res.ok) {
			deleteError = 'Could not delete.';
			return;
		}
		await goto('/people');
	}
</script>

<svelte:head><title>Edit {person.name} — Shoebox</title></svelte:head>

<div class="page">
	<Nav />
	<div class="wrap">
		<a class="back" href={`/people/${person.id}`}>← Back to {person.name}</a>
		<h1>Edit person</h1>

		<section>
			<div class="label">Details</div>
			<label class="field"><span>Name</span><input data-testid="edit-name" bind:value={name} /></label>
			<div class="row">
				<label class="field"><span>Born</span><input type="date" data-testid="edit-birthdate" bind:value={birthdate} /></label>
				<label class="field"><span>Died</span><input type="date" data-testid="edit-deathdate" bind:value={deathDate} /></label>
			</div>
			<label class="field"><span>Birth place</span><input data-testid="edit-birthplace" bind:value={birthPlace} /></label>
		</section>

		<section>
			<div class="label">Accent</div>
			<AccentSwatches bind:value={accentColor} />
		</section>

		<section>
			<div class="label">Portrait</div>
			{#if selectedItem && avatarCrop}
				<div class="cropwrap">
					<CropPicker
						imageUrl={selectedItem.urls.thumb800}
						imageW={selectedItem.width}
						imageH={selectedItem.height}
						bind:crop={avatarCrop}
					/>
					<button class="minor" type="button" onclick={clearAvatar}>Remove portrait</button>
				</div>
			{/if}
			<div class="thumbs" data-testid="avatar-picker">
				{#each taggedItems as item (item.id)}
					<button
						type="button"
						class="thumb"
						class:sel={item.id === avatarItemId}
						onclick={() => pickAvatar(item)}
					>
						<img src={item.urls.thumb400} alt={item.title ?? 'Tagged item'} />
					</button>
				{:else}
					<p class="hint">Tag {person.name} in an item to pick a portrait.</p>
				{/each}
			</div>
		</section>

		<!-- Task 11 appends the relationships editor here -->

		<div class="actions">
			<button class="save" data-testid="save-person" onclick={save}>Save</button>
			{#if saveError}<span class="err">{saveError}</span>{/if}
			{#if data.isAdmin}
				<button class="danger" data-testid="delete-person" onclick={destroy}>Delete person</button>
				{#if deleteError}<span class="err" data-testid="delete-error">{deleteError}</span>{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--ink);
		color: var(--cream);
	}
	.wrap {
		max-width: 760px;
		padding: 30px;
	}
	.back {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		text-decoration: none;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: 40px;
		font-weight: 400;
		margin: 14px 0 26px;
	}
	section {
		margin-bottom: 34px;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		margin-bottom: 14px;
	}
	.field {
		display: block;
		margin-bottom: 14px;
	}
	.field span {
		display: block;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		margin-bottom: 6px;
	}
	.field input {
		width: 100%;
		font-family: var(--font-serif);
		font-size: 17px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		border: none;
		color: var(--cream);
		padding: 12px 14px;
		min-height: 44px;
		color-scheme: dark;
	}
	.row {
		display: flex;
		gap: 14px;
	}
	.row .field {
		flex: 1;
	}
	.cropwrap {
		max-width: 420px;
		margin-bottom: 16px;
	}
	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 8px;
	}
	.thumb {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		aspect-ratio: 1;
		overflow: hidden;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.thumb.sel {
		outline: 3px solid var(--dawn);
		outline-offset: -3px;
	}
	.hint {
		font-family: var(--font-serif);
		font-size: 15px;
		opacity: 0.7;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
	}
	.save,
	.danger,
	.minor {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		border: none;
		cursor: pointer;
		min-height: 44px;
		padding: 0 22px;
	}
	.save {
		background: var(--dawn);
		color: var(--ink);
	}
	.danger {
		background: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
	}
	.minor {
		background: none;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		padding: 0;
	}
	.err {
		font-family: var(--font-sans);
		font-size: 11px;
		color: var(--dawn);
	}
</style>
```

- [ ] **Step 6: Verify**

Run: `pnpm check` — Expected: 0 errors.
Manual: as editor open `/people/{id}/edit` — name/dates/place fields work; accent swatches are 44px squares (selection outline, no radius); the portrait picker lists only items the person is tagged in; picking one shows the drag/zoom crop (rect stays 4:5); Save lands on the person page with the new accent room + portrait; admin Delete on a tagged person surfaces the 409 count message.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/crop.ts src/lib/ui/crop.test.ts src/lib/ui/AccentSwatches.svelte src/lib/ui/CropPicker.svelte src/routes/people/[id]/edit
git commit -m "feat: person edit — fields, accent swatches, portrait pick with 4:5 crop drag"
```

---

### Task 11: Relationships editor UI (live derived family)

**Files:**
- Create: `src/lib/ui/RelEditor.svelte`
- Modify: `src/routes/people/[id]/edit/+page.svelte` (append the section)

**Interfaces:**
- Consumes: `PATCH /api/people/[id]/relationships` (Task 5), `canonicalRel`/`Rel` (Task 1), `FamilyRefs`/`PersonRef` (Task 3), `Avatar.svelte`.
- Produces: `RelEditor.svelte` props: `{ personId: string; others: PersonRef[]; family: FamilyRefs }`.

- [ ] **Step 1: Write the component**

Create `src/lib/ui/RelEditor.svelte`:

```svelte
<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import { canonicalRel, type Rel } from '$lib/domain/relationships';
	import type { FamilyRefs, PersonRef } from '$lib/domain/people-dto';

	let {
		personId,
		others,
		family: initialFamily
	}: { personId: string; others: PersonRef[]; family: FamilyRefs } = $props();

	type Kind = 'parent' | 'child' | 'spouse' | 'sibling';
	let family = $state(initialFamily);
	let kind = $state<Kind>('spouse');
	let otherId = $state('');
	let relError = $state('');

	function relFor(k: Kind, other: string): Rel {
		if (k === 'parent') return { personA: other, personB: personId, type: 'parent-of' };
		if (k === 'child') return { personA: personId, personB: other, type: 'parent-of' };
		return canonicalRel({
			personA: personId,
			personB: other,
			type: k === 'spouse' ? 'spouse-of' : 'sibling-of'
		});
	}

	async function patch(body: { add?: Rel[]; remove?: Rel[] }) {
		relError = '';
		const res = await fetch(`/api/people/${personId}/relationships`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			relError =
				res.status === 409 ? 'That relationship already exists.' : 'Could not update relationships.';
			return;
		}
		family = (await res.json()).family;
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		if (!otherId) return;
		patch({ add: [relFor(kind, otherId)] });
	}

	// Direct rows are removable; grand* rows are derived (display only).
	const rows = $derived(
		[
			{ label: 'Parents', list: family.parents, kind: 'parent' as Kind },
			{ label: 'Spouse', list: family.spouses, kind: 'spouse' as Kind },
			{ label: 'Children', list: family.children, kind: 'child' as Kind },
			{ label: 'Siblings', list: family.siblings, kind: 'sibling' as Kind },
			{ label: 'Grandparents', list: family.grandparents, kind: null },
			{ label: 'Grandkids', list: family.grandchildren, kind: null }
		].filter((r) => r.list.length > 0)
	);
</script>

<div class="releditor" data-testid="rel-editor">
	<form class="addrow" onsubmit={add}>
		<select bind:value={kind} data-testid="rel-kind" aria-label="Relationship">
			<option value="spouse">Spouse</option>
			<option value="parent">Parent</option>
			<option value="child">Child</option>
			<option value="sibling">Sibling</option>
		</select>
		<select bind:value={otherId} data-testid="rel-person" aria-label="Person">
			<option value="" disabled>Choose a person…</option>
			{#each others as o (o.id)}
				<option value={o.id}>{o.name}</option>
			{/each}
		</select>
		<button type="submit" data-testid="rel-add">Add</button>
		{#if relError}<span class="err" data-testid="rel-error">{relError}</span>{/if}
	</form>

	{#each rows as row (row.label)}
		<div class="grp" data-testid={`rel-row-${row.label.toLowerCase()}`}>
			<span class="g">{row.label}</span>
			<span class="names">
				{#each row.list as m (m.id)}
					<span class="p">
						<Avatar name={m.name} accentColor={m.accentColor} size={19} />{m.name}
						{#if row.kind}
							<button
								type="button"
								class="x"
								aria-label={`Remove ${m.name}`}
								onclick={() => patch({ remove: [relFor(row.kind!, m.id)] })}
							>×</button>
						{/if}
					</span>
				{/each}
			</span>
		</div>
	{/each}
</div>

<style>
	.addrow {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}
	select {
		font-family: var(--font-serif);
		font-size: 16px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		color: var(--cream);
		border: none;
		padding: 10px 12px;
		min-height: 44px;
	}
	.addrow button[type='submit'] {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		background: var(--dawn);
		color: var(--ink);
		border: none;
		min-height: 44px;
		padding: 0 18px;
		cursor: pointer;
	}
	.grp {
		margin-bottom: 14px;
		display: flex;
		align-items: baseline;
		gap: 14px;
	}
	.g {
		flex: none;
		width: 96px;
		font-family: var(--font-sans);
		font-size: 9.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
	}
	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		font-family: var(--font-serif);
		font-size: 17px;
	}
	.p {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.x {
		background: none;
		border: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		font-size: 16px;
		cursor: pointer;
		min-width: 32px;
		min-height: 32px;
	}
	.err {
		font-family: var(--font-sans);
		font-size: 11px;
		color: var(--dawn);
	}
</style>
```

- [ ] **Step 2: Mount it on the edit page**

In `src/routes/people/[id]/edit/+page.svelte`, replace

```svelte
		<!-- Task 11 appends the relationships editor here -->
```

with:

```svelte
		<section>
			<div class="label">Family</div>
			<RelEditor personId={person.id} others={data.others} family={person.family} />
		</section>
```

and add `import RelEditor from '$lib/ui/RelEditor.svelte';` to the script block.

- [ ] **Step 3: Verify**

Run: `pnpm check` — Expected: 0 errors.
Manual: add "Spouse → Frank" — the Spouse row appears immediately (response family, no reload); add three children; remove one with ×; adding the same spouse again shows "That relationship already exists."; grandparent/grandkid rows (when derivable) render without × buttons. Reload the person page: family rows match.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ui/RelEditor.svelte src/routes/people/[id]/edit/+page.svelte
git commit -m "feat: relationships editor with live derived family"
```

---

### Task 12: Album DTO + album service

**Files:**
- Create: `src/lib/domain/album-dto.ts`
- Create: `src/lib/server/albums.ts` — Test: `src/lib/server/albums.test.ts`

**Interfaces:**
- Consumes: schema tables (Contract 1), `Db`, `StorageAdapter.mediaUrl`, testing helpers (Task 3), `SessionUser` (Contract 2), `ROLE_RANK` (Contract 3), `nanoid`.
- Produces:
  - `src/lib/domain/album-dto.ts`:
    - `export interface AlbumDTO { id: string; title: string; description: string|null; coverItemId: string|null; coverUrl: string|null; itemCount: number; createdBy: { id: string; username: string; accentColor: string }; createdAt: string }`
  - `src/lib/server/albums.ts`:
    - `export async function listAlbums(db: Db, storage: StorageAdapter): Promise<AlbumDTO[]>` — live (non-deleted) albums, newest first; `coverUrl` = mediaUrl of the cover item's `thumb_400`.
    - `export async function createAlbum(db: Db, user: SessionUser, input: { title: string; description?: string|null }): Promise<AlbumDTO>`
    - `export async function getAlbumDetail(db: Db, storage: StorageAdapter, id: string): Promise<{ album: AlbumDTO; itemIds: string[] } | null>` — `itemIds` ordered by `position` asc; null when missing or soft-deleted.
    - `export function canEditAlbum(user: SessionUser, album: { createdBy: { id: string } }): boolean` — editor+ or creator.
    - `export async function updateAlbum(db: Db, id: string, patch: { title?: string; description?: string|null; coverItemId?: string|null }): Promise<void>` — validates cover is a member (400).
    - `export async function softDeleteAlbum(db: Db, id: string): Promise<void>`
    - `export async function addAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void>` — appends after max position, skips existing members, sets a null cover to the first added item.
    - `export async function removeAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void>` — clears the cover (→ first remaining member or null) if removed.
    - `export async function reorderAlbum(db: Db, albumId: string, positions: { itemId: string; position: number }[]): Promise<void>` — 400 if any itemId is not a member.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/albums.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
	addThumbs, makeItem, makeTestDb, makeUser, sessionUser, stubStorage, type TestDb
} from './testing/db';
import {
	addAlbumItems, canEditAlbum, createAlbum, getAlbumDetail, listAlbums,
	removeAlbumItems, reorderAlbum, softDeleteAlbum, updateAlbum
} from './albums';

let db: TestDb;
let editor: ReturnType<typeof sessionUser>;
let uploader: ReturnType<typeof sessionUser>;
beforeEach(async () => {
	db = makeTestDb();
	editor = sessionUser(await makeUser(db, { role: 'editor' }));
	uploader = sessionUser(await makeUser(db, { role: 'uploader' }));
});

async function threeItems() {
	const out = [];
	for (let i = 0; i < 3; i++) {
		const item = await makeItem(db, { uploadedBy: editor.id });
		await addThumbs(db, item.id);
		out.push(item);
	}
	return out;
}

describe('create/list', () => {
	it('creates an album and lists it with creator identity and count', async () => {
		const a = await createAlbum(db, uploader, { title: 'Summer at the Lake' });
		expect(a.title).toBe('Summer at the Lake');
		expect(a.createdBy.id).toBe(uploader.id);
		const [listed] = await listAlbums(db, stubStorage);
		expect(listed.itemCount).toBe(0);
		expect(listed.coverUrl).toBeNull();
	});

	it('excludes soft-deleted albums', async () => {
		const a = await createAlbum(db, editor, { title: 'Gone' });
		await softDeleteAlbum(db, a.id);
		expect(await listAlbums(db, stubStorage)).toEqual([]);
		expect(await getAlbumDetail(db, stubStorage, a.id)).toBeNull();
	});
});

describe('membership & cover', () => {
	it('appends with increasing positions, skips duplicates, auto-sets cover', async () => {
		const [i1, i2, i3] = await threeItems();
		const a = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, a.id, [i1.id, i2.id]);
		await addAlbumItems(db, a.id, [i2.id, i3.id]); // i2 already a member
		const d = (await getAlbumDetail(db, stubStorage, a.id))!;
		expect(d.itemIds).toEqual([i1.id, i2.id, i3.id]);
		expect(d.album.coverItemId).toBe(i1.id);
		expect(d.album.coverUrl).toBe(`/media/media/${i1.id}/thumb_400.webp`);
		expect(d.album.itemCount).toBe(3);
	});

	it('reassigns the cover when the cover item is removed', async () => {
		const [i1, i2] = await threeItems();
		const a = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, a.id, [i1.id, i2.id]);
		await removeAlbumItems(db, a.id, [i1.id]);
		const d = (await getAlbumDetail(db, stubStorage, a.id))!;
		expect(d.itemIds).toEqual([i2.id]);
		expect(d.album.coverItemId).toBe(i2.id);
	});

	it('validates an explicit cover is a member', async () => {
		const [i1, i2] = await threeItems();
		const a = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, a.id, [i1.id]);
		await expect(updateAlbum(db, a.id, { coverItemId: i2.id })).rejects.toMatchObject({ status: 400 });
		await updateAlbum(db, a.id, { coverItemId: i1.id, title: 'Lake Days' });
		const d = (await getAlbumDetail(db, stubStorage, a.id))!;
		expect(d.album.title).toBe('Lake Days');
	});
});

describe('reorder', () => {
	it('applies a batched position update', async () => {
		const [i1, i2, i3] = await threeItems();
		const a = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, a.id, [i1.id, i2.id, i3.id]);
		await reorderAlbum(db, a.id, [
			{ itemId: i3.id, position: 0 },
			{ itemId: i1.id, position: 1 },
			{ itemId: i2.id, position: 2 }
		]);
		const d = (await getAlbumDetail(db, stubStorage, a.id))!;
		expect(d.itemIds).toEqual([i3.id, i1.id, i2.id]);
	});

	it('rejects positions for non-members', async () => {
		const [i1, , i3] = await threeItems();
		const a = await createAlbum(db, editor, { title: 'Lake' });
		await addAlbumItems(db, a.id, [i1.id]);
		await expect(
			reorderAlbum(db, a.id, [{ itemId: i3.id, position: 0 }])
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('canEditAlbum', () => {
	it('allows editor+ and the creator, denies others', async () => {
		const a = await createAlbum(db, uploader, { title: 'Mine' });
		const stranger = sessionUser(await makeUser(db, { role: 'uploader' }));
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		expect(canEditAlbum(editor, a)).toBe(true);
		expect(canEditAlbum(uploader, a)).toBe(true);
		expect(canEditAlbum(stranger, a)).toBe(false);
		expect(canEditAlbum(viewer, a)).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/albums.test.ts`
Expected: FAIL — "Failed to resolve import './albums'".

- [ ] **Step 3: Write the DTO and service**

Create `src/lib/domain/album-dto.ts`:

```ts
export interface AlbumDTO {
	id: string;
	title: string;
	description: string | null;
	coverItemId: string | null;
	coverUrl: string | null; // thumb_400 of the cover item
	itemCount: number;
	createdBy: { id: string; username: string; accentColor: string };
	createdAt: string; // ISO
}
```

Create `src/lib/server/albums.ts`:

```ts
import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AlbumDTO } from '$lib/domain/album-dto';
import type { Db } from './db';
import type { StorageAdapter } from './platform/types';
import { ROLE_RANK } from './roles';
import { albumItems, albums, itemFiles, users } from './db/schema';

type AlbumRow = typeof albums.$inferSelect;
type SessionUser = NonNullable<App.Locals['user']>;

async function toDTOs(db: Db, storage: StorageAdapter, rows: AlbumRow[]): Promise<AlbumDTO[]> {
	if (!rows.length) return [];
	const ids = rows.map((r) => r.id);
	const counts = new Map(
		(
			await db
				.select({ albumId: albumItems.albumId, c: sql<number>`count(*)` })
				.from(albumItems)
				.where(inArray(albumItems.albumId, ids))
				.groupBy(albumItems.albumId)
		).map((r) => [r.albumId, r.c])
	);
	const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
	const creators = new Map(
		(
			await db
				.select({ id: users.id, username: users.username, accentColor: users.accentColor })
				.from(users)
				.where(inArray(users.id, creatorIds))
		).map((u) => [u.id, u])
	);
	const coverIds = rows.map((r) => r.coverItemId).filter((v): v is string => !!v);
	const coverKeys = new Map(
		coverIds.length
			? (
					await db
						.select({ itemId: itemFiles.itemId, key: itemFiles.storageKey })
						.from(itemFiles)
						.where(and(inArray(itemFiles.itemId, coverIds), eq(itemFiles.kind, 'thumb_400')))
				).map((r) => [r.itemId, r.key])
			: []
	);
	const out: AlbumDTO[] = [];
	for (const r of rows) {
		const key = r.coverItemId ? coverKeys.get(r.coverItemId) : undefined;
		out.push({
			id: r.id,
			title: r.title,
			description: r.description,
			coverItemId: r.coverItemId,
			coverUrl: key ? await storage.mediaUrl(key) : null,
			itemCount: counts.get(r.id) ?? 0,
			createdBy: creators.get(r.createdBy) ?? { id: r.createdBy, username: '?', accentColor: '#FA7B62' },
			createdAt: r.createdAt.toISOString()
		});
	}
	return out;
}

export async function listAlbums(db: Db, storage: StorageAdapter): Promise<AlbumDTO[]> {
	const rows = await db.select().from(albums).where(isNull(albums.deletedAt));
	rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	return toDTOs(db, storage, rows);
}

export async function createAlbum(
	db: Db, user: SessionUser, input: { title: string; description?: string | null }
): Promise<AlbumDTO> {
	const id = nanoid(12);
	await db.insert(albums).values({
		id,
		title: input.title,
		description: input.description ?? null,
		createdBy: user.id,
		createdAt: new Date()
	});
	return {
		id,
		title: input.title,
		description: input.description ?? null,
		coverItemId: null,
		coverUrl: null,
		itemCount: 0,
		createdBy: { id: user.id, username: user.username, accentColor: user.accentColor },
		createdAt: new Date().toISOString()
	};
}

async function liveAlbum(db: Db, id: string): Promise<AlbumRow | null> {
	const row = (await db.select().from(albums).where(eq(albums.id, id)))[0];
	return row && !row.deletedAt ? row : null;
}

export async function getAlbumDetail(
	db: Db, storage: StorageAdapter, id: string
): Promise<{ album: AlbumDTO; itemIds: string[] } | null> {
	const row = await liveAlbum(db, id);
	if (!row) return null;
	const members = await db
		.select({ itemId: albumItems.itemId })
		.from(albumItems)
		.where(eq(albumItems.albumId, id))
		.orderBy(asc(albumItems.position));
	const [album] = await toDTOs(db, storage, [row]);
	return { album, itemIds: members.map((m) => m.itemId) };
}

export function canEditAlbum(user: SessionUser, album: { createdBy: { id: string } }): boolean {
	return ROLE_RANK[user.role] >= ROLE_RANK.editor || album.createdBy.id === user.id;
}

async function memberIds(db: Db, albumId: string): Promise<string[]> {
	return (
		await db
			.select({ itemId: albumItems.itemId })
			.from(albumItems)
			.where(eq(albumItems.albumId, albumId))
			.orderBy(asc(albumItems.position))
	).map((m) => m.itemId);
}

export async function updateAlbum(
	db: Db, id: string,
	patch: { title?: string; description?: string | null; coverItemId?: string | null }
): Promise<void> {
	const row = await liveAlbum(db, id);
	if (!row) error(404, 'album not found');
	if (patch.title !== undefined && !patch.title.trim()) error(400, 'title must not be empty');
	if (patch.coverItemId != null) {
		const members = await memberIds(db, id);
		if (!members.includes(patch.coverItemId)) error(400, 'cover must be an album member');
	}
	const set: Record<string, unknown> = {};
	if (patch.title !== undefined) set.title = patch.title.trim();
	if (patch.description !== undefined) set.description = patch.description;
	if (patch.coverItemId !== undefined) set.coverItemId = patch.coverItemId;
	if (Object.keys(set).length) await db.update(albums).set(set).where(eq(albums.id, id));
}

export async function softDeleteAlbum(db: Db, id: string): Promise<void> {
	const row = await liveAlbum(db, id);
	if (!row) error(404, 'album not found');
	await db.update(albums).set({ deletedAt: new Date() }).where(eq(albums.id, id));
}

export async function addAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');
	const existing = await memberIds(db, albumId);
	let next = existing.length
		? Math.max(
				...(
					await db
						.select({ p: albumItems.position })
						.from(albumItems)
						.where(eq(albumItems.albumId, albumId))
				).map((r) => r.p)
			) + 1
		: 0;
	const toAdd = itemIds.filter((id, i, a) => !existing.includes(id) && a.indexOf(id) === i);
	for (const itemId of toAdd) {
		await db.insert(albumItems).values({ albumId, itemId, position: next++ });
	}
	if (!row.coverItemId && toAdd.length) {
		await db.update(albums).set({ coverItemId: toAdd[0] }).where(eq(albums.id, albumId));
	}
}

export async function removeAlbumItems(db: Db, albumId: string, itemIds: string[]): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');
	if (!itemIds.length) return;
	await db
		.delete(albumItems)
		.where(and(eq(albumItems.albumId, albumId), inArray(albumItems.itemId, itemIds)));
	if (row.coverItemId && itemIds.includes(row.coverItemId)) {
		const remaining = await memberIds(db, albumId);
		await db.update(albums).set({ coverItemId: remaining[0] ?? null }).where(eq(albums.id, albumId));
	}
}

export async function reorderAlbum(
	db: Db, albumId: string, positions: { itemId: string; position: number }[]
): Promise<void> {
	const row = await liveAlbum(db, albumId);
	if (!row) error(404, 'album not found');
	const members = await memberIds(db, albumId);
	for (const p of positions) {
		if (!members.includes(p.itemId)) error(400, 'position update for a non-member item');
		if (!Number.isInteger(p.position) || p.position < 0) error(400, 'invalid position');
	}
	for (const p of positions) {
		await db
			.update(albumItems)
			.set({ position: p.position })
			.where(and(eq(albumItems.albumId, albumId), eq(albumItems.itemId, p.itemId)));
	}
}
```

(If `NonNullable<App.Locals['user']>` displeases the compiler in your setup, import the `SessionUser` type from where Phase 01 exported it — e.g. `import type { SessionUser } from '$lib/server/auth';` — and use that; the shape is Contract 2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/albums.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
pnpm check
git add src/lib/domain/album-dto.ts src/lib/server/albums.ts src/lib/server/albums.test.ts
git commit -m "feat: album service — CRUD, membership, cover rules, batched reorder"
```

---

### Task 13: Albums API routes

**Files:**
- Create: `src/routes/api/albums/+server.ts` — Test: `src/routes/api/albums/server.test.ts`
- Create: `src/routes/api/albums/[id]/+server.ts` — Test: `src/routes/api/albums/[id]/server.test.ts`
- Create: `src/routes/api/albums/[id]/items/+server.ts` — Test: `src/routes/api/albums/[id]/items/server.test.ts`

**Interfaces:**
- Consumes: Task 12 service, `requireRole` (Contract 3), `getItemDTOsByIds` (Phase 02, see Consumed Interfaces).
- Produces (HTTP contract for Tasks 14–15 and e2e):
  - `GET /api/albums` (user+) → `{ albums: AlbumDTO[] }`
  - `POST /api/albums` (uploader+) `{ title, description? }` → `201 { album: AlbumDTO }`; blank title → 400
  - `GET /api/albums/[id]` (user+) → `{ album: AlbumDTO, items: ItemDTO[] }` (position order) | 404
  - `PATCH /api/albums/[id]` (creator or editor+) `{ title?, description?, coverItemId? }` → `{ album: AlbumDTO }`
  - `DELETE /api/albums/[id]` (creator or editor+) → `{ ok: true }` (soft delete)
  - `POST /api/albums/[id]/items` (creator or editor+) `{ add?: string[], remove?: string[] }` → `{ ok: true }`
  - `PATCH /api/albums/[id]/items` (creator or editor+) `{ positions: { itemId, position }[] }` → `{ ok: true }`

- [ ] **Step 1: Write the failing tests**

Create `src/routes/api/albums/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { GET, POST } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		request: new Request('http://test/api/albums', {
			method: body ? 'POST' : 'GET',
			body: body ? JSON.stringify(body) : undefined
		})
	} as never;
}

describe('/api/albums', () => {
	it('401s without a session and 403s creation below uploader', async () => {
		await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		await expect(POST(evt(viewer, { title: 'X' }))).rejects.toMatchObject({ status: 403 });
	});
	it('uploader creates an album; anyone signed in lists it', async () => {
		const up = sessionUser(await makeUser(db, { role: 'uploader' }));
		const res = await POST(evt(up, { title: 'Summer at the Lake' }));
		expect(res.status).toBe(201);
		const viewer = sessionUser(await makeUser(db, { role: 'user' }));
		const { albums } = await (await GET(evt(viewer))).json();
		expect(albums).toHaveLength(1);
		expect(albums[0].title).toBe('Summer at the Lake');
	});
	it('400s on a blank title', async () => {
		const up = sessionUser(await makeUser(db, { role: 'uploader' }));
		await expect(POST(evt(up, { title: ' ' }))).rejects.toMatchObject({ status: 400 });
	});
});
```

Create `src/routes/api/albums/[id]/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { createAlbum } from '$lib/server/albums';
import { DELETE, GET, PATCH } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, id: string, body?: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/albums/${id}`, {
			method: 'PATCH', body: JSON.stringify(body ?? {})
		})
	} as never;
}

describe('/api/albums/[id]', () => {
	it('GET 404s for a missing album', async () => {
		const u = sessionUser(await makeUser(db, {}));
		await expect(GET(evt(u, 'nope'))).rejects.toMatchObject({ status: 404 });
	});
	it('creator (uploader) can PATCH and DELETE their own album; strangers cannot', async () => {
		const up = sessionUser(await makeUser(db, { role: 'uploader' }));
		const stranger = sessionUser(await makeUser(db, { role: 'uploader' }));
		const album = await createAlbum(db, up, { title: 'Mine' });
		await expect(PATCH(evt(stranger, album.id, { title: 'Stolen' }))).rejects.toMatchObject({ status: 403 });
		const res = await PATCH(evt(up, album.id, { title: 'Mine Renamed' }));
		expect((await res.json()).album.title).toBe('Mine Renamed');
		const del = await DELETE(evt(up, album.id));
		expect(await del.json()).toEqual({ ok: true });
		await expect(GET(evt(up, album.id))).rejects.toMatchObject({ status: 404 });
	});
});
```

Create `src/routes/api/albums/[id]/items/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
	addThumbs, makeItem, makeTestDb, makeUser, sessionUser, stubStorage, type TestDb
} from '$lib/server/testing/db';
import { createAlbum, getAlbumDetail } from '$lib/server/albums';
import { PATCH, POST } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, id: string, body: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/albums/${id}/items`, {
			method: 'POST', body: JSON.stringify(body)
		})
	} as never;
}

describe('/api/albums/[id]/items', () => {
	it('adds, removes, and reorders for the creator', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const album = await createAlbum(db, ed, { title: 'Lake' });
		const i1 = await makeItem(db, { uploadedBy: ed.id });
		const i2 = await makeItem(db, { uploadedBy: ed.id });
		await addThumbs(db, i1.id);
		await addThumbs(db, i2.id);
		await POST(evt(ed, album.id, { add: [i1.id, i2.id] }));
		await PATCH(evt(ed, album.id, {
			positions: [{ itemId: i2.id, position: 0 }, { itemId: i1.id, position: 1 }]
		}));
		const d = (await getAlbumDetail(db, stubStorage, album.id))!;
		expect(d.itemIds).toEqual([i2.id, i1.id]);
		await POST(evt(ed, album.id, { remove: [i2.id] }));
		expect((await getAlbumDetail(db, stubStorage, album.id))!.itemIds).toEqual([i1.id]);
	});
	it('403s for a non-creator below editor', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const up = sessionUser(await makeUser(db, { role: 'uploader' }));
		const album = await createAlbum(db, ed, { title: 'Lake' });
		await expect(POST(evt(up, album.id, { add: [] }))).rejects.toMatchObject({ status: 403 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/routes/api/albums`
Expected: FAIL ×3 — "Failed to resolve import './+server'".

- [ ] **Step 3: Write the routes**

Create `src/routes/api/albums/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { createAlbum, listAlbums } from '$lib/server/albums';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, 'user');
	return json({ albums: await listAlbums(locals.db, locals.platform.storage) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireRole(locals, 'uploader');
	const body = (await request.json().catch(() => null)) as { title?: string; description?: string } | null;
	if (!body || typeof body.title !== 'string' || !body.title.trim()) error(400, 'title is required');
	const album = await createAlbum(locals.db, user, {
		title: body.title.trim(),
		description: body.description ?? null
	});
	return json({ album }, { status: 201 });
};
```

Create `src/routes/api/albums/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { canEditAlbum, getAlbumDetail, softDeleteAlbum, updateAlbum } from '$lib/server/albums';
import { getItemDTOsByIds } from '$lib/server/items';

async function loadOr404(locals: App.Locals, id: string) {
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, id);
	if (!detail) error(404, 'album not found');
	return detail;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	requireRole(locals, 'user');
	const { album, itemIds } = await loadOr404(locals, params.id);
	const items = await getItemDTOsByIds(locals.db, locals.platform.storage, itemIds);
	return json({ album, items });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = requireRole(locals, 'uploader');
	const { album } = await loadOr404(locals, params.id);
	if (!canEditAlbum(user, album)) error(403, 'not your album');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) error(400, 'invalid body');
	await updateAlbum(locals.db, params.id, {
		title: body.title as string | undefined,
		description: body.description as string | null | undefined,
		coverItemId: body.coverItemId as string | null | undefined
	});
	const { album: updated } = await loadOr404(locals, params.id);
	return json({ album: updated });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = requireRole(locals, 'uploader');
	const { album } = await loadOr404(locals, params.id);
	if (!canEditAlbum(user, album)) error(403, 'not your album');
	await softDeleteAlbum(locals.db, params.id);
	return json({ ok: true });
};
```

Create `src/routes/api/albums/[id]/items/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import {
	addAlbumItems, canEditAlbum, getAlbumDetail, removeAlbumItems, reorderAlbum
} from '$lib/server/albums';

async function editableAlbum(locals: App.Locals, id: string) {
	const user = requireRole(locals, 'uploader');
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, id);
	if (!detail) error(404, 'album not found');
	if (!canEditAlbum(user, detail.album)) error(403, 'not your album');
	return detail;
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	await editableAlbum(locals, params.id);
	const body = (await request.json().catch(() => null)) as { add?: unknown; remove?: unknown } | null;
	if (!body) error(400, 'invalid body');
	const add = body.add ?? [];
	const remove = body.remove ?? [];
	if (!Array.isArray(add) || !Array.isArray(remove)) error(400, 'add and remove must be arrays');
	if (add.length) await addAlbumItems(locals.db, params.id, add as string[]);
	if (remove.length) await removeAlbumItems(locals.db, params.id, remove as string[]);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	await editableAlbum(locals, params.id);
	const body = (await request.json().catch(() => null)) as { positions?: unknown } | null;
	if (!body || !Array.isArray(body.positions)) error(400, 'positions array required');
	await reorderAlbum(locals.db, params.id, body.positions as { itemId: string; position: number }[]);
	return json({ ok: true });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/routes/api/albums`
Expected: PASS (7 tests across 3 files).

- [ ] **Step 5: Commit**

```bash
pnpm check
git add src/routes/api/albums
git commit -m "feat: albums API — CRUD, membership add/remove, batched position updates"
```

---

### Task 14: Albums pages — cover-led index + album room with pointer drag-reorder

**Files:**
- Create: `src/lib/ui/reorder.ts` — Test: `src/lib/ui/reorder.test.ts`
- Create: `src/lib/ui/ReorderGrid.svelte`
- Create: `src/routes/albums/+page.server.ts`, `src/routes/albums/+page.svelte`
- Create: `src/routes/albums/[id]/+page.server.ts`, `src/routes/albums/[id]/+page.svelte`

**Interfaces:**
- Consumes: Tasks 12–13, `getItemDTOsByIds` (Phase 02), `MasonryGrid` (Phase 03), `personRoomFor`/`GRAIN_URI` (Contract 4), `Nav.svelte`.
- Produces:
  - `reorder.ts`: `export function moveItem<T>(arr: readonly T[], from: number, to: number): T[]`; `export function positionsFrom(ids: readonly string[]): { itemId: string; position: number }[]`.
  - `ReorderGrid.svelte` props: `{ items: ItemDTO[]; coverItemId: string | null; onCommit: (positions: { itemId: string; position: number }[]) => void; onCover: (itemId: string) => void }`.

- [ ] **Step 1: Write the failing reorder test**

Create `src/lib/ui/reorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moveItem, positionsFrom } from './reorder';

describe('moveItem', () => {
	it('moves forward', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
	});
	it('moves backward', () => {
		expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
	});
	it('is identity for same index and does not mutate', () => {
		const src = ['a', 'b'];
		expect(moveItem(src, 1, 1)).toEqual(['a', 'b']);
		expect(src).toEqual(['a', 'b']);
	});
});

describe('positionsFrom', () => {
	it('maps ids to sequential positions', () => {
		expect(positionsFrom(['x', 'y'])).toEqual([
			{ itemId: 'x', position: 0 },
			{ itemId: 'y', position: 1 }
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/reorder.test.ts`
Expected: FAIL — "Failed to resolve import './reorder'".

- [ ] **Step 3: Implement `reorder.ts`**

Create `src/lib/ui/reorder.ts`:

```ts
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
	const out = [...arr];
	const [moved] = out.splice(from, 1);
	out.splice(to, 0, moved);
	return out;
}

export function positionsFrom(ids: readonly string[]): { itemId: string; position: number }[] {
	return ids.map((itemId, position) => ({ itemId, position }));
}
```

Run: `pnpm vitest run src/lib/ui/reorder.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 4: Write `ReorderGrid.svelte`**

Create `src/lib/ui/ReorderGrid.svelte`:

```svelte
<script lang="ts">
	import type { ItemDTO } from '$lib/domain/dtos';
	import { moveItem, positionsFrom } from './reorder';

	let {
		items,
		coverItemId,
		onCommit,
		onCover
	}: {
		items: ItemDTO[];
		coverItemId: string | null;
		onCommit: (positions: { itemId: string; position: number }[]) => void;
		onCover: (itemId: string) => void;
	} = $props();

	let order = $state(items.map((i) => i.id));
	const byId = $derived(new Map(items.map((i) => [i.id, i])));
	let draggingId = $state<string | null>(null);
	let dirty = $state(false);

	function onDown(e: PointerEvent, id: string) {
		draggingId = id;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!draggingId) return;
		const el = document
			.elementsFromPoint(e.clientX, e.clientY)
			.find((n) => (n as HTMLElement).dataset?.reorderId) as HTMLElement | undefined;
		const overId = el?.dataset.reorderId;
		if (!overId || overId === draggingId) return;
		const from = order.indexOf(draggingId);
		const to = order.indexOf(overId);
		order = moveItem(order, from, to);
		dirty = true;
	}
	function onUp() {
		if (draggingId && dirty) {
			onCommit(positionsFrom(order));
			dirty = false;
		}
		draggingId = null;
	}
</script>

<div class="rgrid" data-testid="reorder-grid" onpointermove={onMove} onpointerup={onUp}>
	{#each order as id, index (id)}
		{@const item = byId.get(id)}
		{#if item}
			<div
				class="tile"
				class:dragging={draggingId === id}
				data-reorder-id={id}
				data-testid="reorder-tile"
				onpointerdown={(e) => onDown(e, id)}
			>
				<img src={item.urls.thumb400} alt={item.title ?? `Item ${index + 1}`} draggable="false" />
				<button
					type="button"
					class="cover"
					class:iscover={coverItemId === id}
					data-testid="set-cover"
					onclick={() => onCover(id)}
				>
					{coverItemId === id ? 'Cover' : 'Set cover'}
				</button>
			</div>
		{/if}
	{/each}
</div>

<style>
	.rgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 10px;
		touch-action: none;
	}
	.tile {
		position: relative;
		aspect-ratio: 1;
		cursor: grab;
		user-select: none;
	}
	.tile.dragging {
		opacity: 0.65;
		outline: 2px solid var(--dawn);
	}
	.tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		pointer-events: none;
	}
	.cover {
		position: absolute;
		left: 0;
		bottom: 0;
		font-family: var(--font-sans);
		font-size: 9px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		background: var(--ink);
		color: var(--cream);
		border: none;
		min-height: 32px;
		padding: 0 10px;
		cursor: pointer;
	}
	.cover.iscover {
		background: var(--dawn);
		color: var(--ink);
	}
</style>
```

- [ ] **Step 5: Write the albums index**

Create `src/routes/albums/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ROLE_RANK } from '$lib/server/roles';
import { listAlbums } from '$lib/server/albums';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		albums: await listAlbums(locals.db, locals.platform.storage),
		canCreate: ROLE_RANK[locals.user.role] >= ROLE_RANK.uploader
	};
};
```

Create `src/routes/albums/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import Nav from '$lib/ui/Nav.svelte';
	import { personRoomFor } from '$lib/ui/tokens';

	let { data } = $props();
	let creating = $state(false);
	let newTitle = $state('');

	async function createAlbum(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/albums', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: newTitle })
		});
		if (!res.ok) return;
		const { album } = await res.json();
		await goto(`/albums/${album.id}`);
	}
	const fallback = (accent: string) => {
		const s = personRoomFor(accent).stops;
		return `linear-gradient(165deg, ${s[0]} 0%, ${s[1]} 55%, ${s[2]} 135%)`;
	};
</script>

<svelte:head><title>Albums — Shoebox</title></svelte:head>

<div class="page">
	<Nav />
	<header class="head">
		<span class="label">Albums</span>
		{#if data.canCreate}
			{#if creating}
				<form class="newform" onsubmit={createAlbum}>
					<input name="title" placeholder="Album title" bind:value={newTitle} required />
					<button type="submit" data-testid="create-album">Create</button>
					<button type="button" onclick={() => (creating = false)}>Cancel</button>
				</form>
			{:else}
				<button class="new" data-testid="new-album" onclick={() => (creating = true)}>New album</button>
			{/if}
		{/if}
	</header>
	<div class="grid" data-testid="albums-grid">
		{#each data.albums as album (album.id)}
			<a class="card" href={`/albums/${album.id}`} data-testid="album-card">
				<div class="cov">
					{#if album.coverUrl}
						<img src={album.coverUrl} alt={album.title} data-testid="album-cover" />
					{:else}
						<div class="fill" style:background={fallback(album.createdBy.accentColor)}></div>
					{/if}
				</div>
				<span class="title">{album.title}</span>
				<span class="count">{album.itemCount} {album.itemCount === 1 ? 'moment' : 'moments'}</span>
			</a>
		{/each}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--ink);
		color: var(--cream);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 38px 30px 0;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.new,
	.newform button {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		background: none;
		border: none;
		color: var(--dawn);
		cursor: pointer;
		min-height: 44px;
		padding: 0 12px;
	}
	.newform {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.newform input {
		font-family: var(--font-serif);
		font-size: 17px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		border: none;
		color: var(--cream);
		padding: 10px 14px;
		min-height: 44px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 26px 18px;
		padding: 26px 30px 60px;
	}
	.card {
		text-decoration: none;
		color: var(--cream);
	}
	.cov {
		aspect-ratio: 4 / 3;
		overflow: hidden;
	}
	.cov img,
	.cov .fill {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.title {
		display: block;
		font-family: var(--font-serif);
		font-size: 21px;
		margin-top: 10px;
		line-height: 1.2;
	}
	.count {
		display: block;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.6;
		margin-top: 4px;
	}
</style>
```

- [ ] **Step 6: Write the album room page**

Create `src/routes/albums/[id]/+page.server.ts`:

```ts
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canEditAlbum, getAlbumDetail } from '$lib/server/albums';
import { getItemDTOsByIds } from '$lib/server/items';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(302, '/login');
	const detail = await getAlbumDetail(locals.db, locals.platform.storage, params.id);
	if (!detail) error(404, 'Album not found');
	const items = await getItemDTOsByIds(locals.db, locals.platform.storage, detail.itemIds);
	return { album: detail.album, items, canEdit: canEditAlbum(locals.user, detail.album) };
};
```

Create `src/routes/albums/[id]/+page.svelte`:

```svelte
<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Nav from '$lib/ui/Nav.svelte';
	import MasonryGrid from '$lib/ui/MasonryGrid.svelte';
	import ReorderGrid from '$lib/ui/ReorderGrid.svelte';
	import { GRAIN_URI, personRoomFor } from '$lib/ui/tokens';

	let { data } = $props();
	const album = $derived(data.album);
	let arranging = $state(false);

	const room = $derived(personRoomFor(album.createdBy.accentColor));
	const roomBg = $derived(
		[
			...room.pools.map((p) => `radial-gradient(${p.size} at ${p.pos}, ${p.color} 0%, transparent 65%)`),
			`linear-gradient(165deg, ${room.stops[0]} 0%, ${room.stops[1]} 55%, ${room.stops[2]} 135%)`
		].join(', ')
	);

	async function commitOrder(positions: { itemId: string; position: number }[]) {
		await fetch(`/api/albums/${album.id}/items`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ positions })
		});
		await invalidateAll();
	}
	async function setCover(itemId: string) {
		await fetch(`/api/albums/${album.id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ coverItemId: itemId })
		});
		await invalidateAll();
	}
</script>

<svelte:head><title>{album.title} — Shoebox</title></svelte:head>

<div class="room" style:background={roomBg}>
	<div class="grain" style:background-image={`url("${GRAIN_URI}")`}></div>
	<div class="content">
		<Nav />
		<header class="head">
			<span class="label">Album</span>
			<h1 data-testid="album-title">{album.title}</h1>
			{#if album.description}<p class="desc">{album.description}</p>{/if}
			<div class="meta">
				<span>{album.itemCount} {album.itemCount === 1 ? 'moment' : 'moments'}</span>
				{#if data.canEdit}
					<button class="arrange" data-testid="arrange-toggle" onclick={() => (arranging = !arranging)}>
						{arranging ? 'Done arranging' : 'Arrange'}
					</button>
				{/if}
			</div>
		</header>
		<div class="body">
			{#if arranging}
				<ReorderGrid
					items={data.items}
					coverItemId={album.coverItemId}
					onCommit={commitOrder}
					onCover={setCover}
				/>
			{:else}
				<MasonryGrid items={data.items} />
			{/if}
		</div>
	</div>
</div>

<style>
	.room {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		color: var(--cream);
	}
	.grain {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		opacity: 0.5;
		mix-blend-mode: overlay;
	}
	.content {
		position: relative;
		z-index: 2;
		padding-bottom: 80px;
	}
	.head {
		padding: 38px 30px 0;
		max-width: 860px;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: 46px;
		font-weight: 400;
		line-height: 1;
		margin: 12px 0 0;
	}
	.desc {
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.7;
		margin: 14px 0 0;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 22px;
		margin-top: 14px;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.75;
	}
	.arrange {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		background: none;
		border: none;
		color: var(--dawn);
		cursor: pointer;
		min-height: 44px;
	}
	.body {
		padding: 26px 30px 0;
	}
</style>
```

- [ ] **Step 7: Verify**

Run: `pnpm check && pnpm vitest run src/lib/ui/reorder.test.ts` — Expected: 0 errors / PASS.
Manual: `/albums` shows cover-led cards (cover thumb or creator-accent gradient, serif title, sans-caps count); "New album" (uploader+) creates and opens the album room; `Arrange` (creator/editor+) switches to the tile grid — pointer-drag a tile over another to reorder (persists on release: reload keeps the order); "Set cover" marks the cover and the index card updates.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ui/reorder.ts src/lib/ui/reorder.test.ts src/lib/ui/ReorderGrid.svelte src/routes/albums
git commit -m "feat: albums index and album room with pointer drag-reorder and cover picking"
```

---

### Task 15: Add-to-album affordance on the item room

**Files:**
- Create: `src/lib/ui/AlbumToggle.svelte`
- Modify: `src/routes/item/[id]/+page.svelte` (Phase 04 file — surgical edit)

**Interfaces:**
- Consumes: `GET /api/albums` + `POST /api/albums/[id]/items` (Task 13), `ItemDTO.albums` (Contract 6).
- Produces: `AlbumToggle.svelte` props: `{ itemId: string; memberships: { id: string; title: string }[] }`.

- [ ] **Step 1: Write the component**

Create `src/lib/ui/AlbumToggle.svelte`:

```svelte
<script lang="ts">
	import type { AlbumDTO } from '$lib/domain/album-dto';

	let { itemId, memberships }: { itemId: string; memberships: { id: string; title: string }[] } =
		$props();

	let albums = $state<AlbumDTO[] | null>(null);
	let member = $state(new Set(memberships.map((m) => m.id)));

	async function load() {
		if (albums) return;
		const res = await fetch('/api/albums');
		if (res.ok) albums = (await res.json()).albums;
	}
	async function toggle(albumId: string) {
		const inAlbum = member.has(albumId);
		const res = await fetch(`/api/albums/${albumId}/items`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(inAlbum ? { remove: [itemId] } : { add: [itemId] })
		});
		if (!res.ok) return;
		const next = new Set(member);
		if (inAlbum) next.delete(albumId);
		else next.add(albumId);
		member = next;
	}
</script>

<details class="albumtoggle" data-testid="album-toggle" ontoggle={load}>
	<summary>Albums{member.size ? ` · ${member.size}` : ''}</summary>
	{#if albums}
		<ul>
			{#each albums as album (album.id)}
				<li>
					<label>
						<input
							type="checkbox"
							checked={member.has(album.id)}
							data-testid={`album-check-${album.id}`}
							onchange={() => toggle(album.id)}
						/>
						<span>{album.title}</span>
					</label>
				</li>
			{:else}
				<li class="none">No albums yet — create one on the Albums page.</li>
			{/each}
		</ul>
	{/if}
</details>

<style>
	summary {
		list-style: none;
		cursor: pointer;
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 70%, transparent);
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	ul {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
	}
	li label {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-family: var(--font-serif);
		font-size: 16px;
		cursor: pointer;
	}
	li input {
		width: 18px;
		height: 18px;
		accent-color: var(--dawn);
	}
	.none {
		font-family: var(--font-serif);
		font-size: 15px;
		opacity: 0.7;
		padding: 8px 0;
	}
</style>
```

- [ ] **Step 2: Mount it in the item room's edit panel**

Surgical edit to the Phase 04 file `src/routes/item/[id]/+page.svelte`:
1. Add to the script block: `import AlbumToggle from '$lib/ui/AlbumToggle.svelte';`
2. Locate the **edit panel** — the block Phase 04 renders only when the current user may edit the item's metadata (the MetaForm section). Append inside it, after the existing metadata fields:

```svelte
<AlbumToggle itemId={item.id} memberships={item.albums} />
```

(`item` here is the page's `ItemDTO` variable — use whatever name the Phase 04 file already binds; `ItemDTO.albums` is `{ id, title }[]` per Contract 6.)

- [ ] **Step 3: Verify**

Run: `pnpm check` — Expected: 0 errors.
Manual: on an item room as editor/owner-of-item, the edit panel shows "Albums"; opening it lists all albums with checkboxes; checking adds the item (album page + count update after reload), unchecking removes; the summary shows the membership count.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ui/AlbumToggle.svelte src/routes/item/[id]/+page.svelte
git commit -m "feat: add-to-album toggle on the item room edit panel"
```

---

### Task 16: User↔person linking endpoint + `/profile` page

**Files:**
- Create: `src/routes/api/admin/users/[id]/+server.ts` — Test: `src/routes/api/admin/users/[id]/server.test.ts`
- Create: `src/routes/profile/+page.server.ts` — Test: `src/routes/profile/page.server.test.ts`
- Create: `src/routes/profile/+page.svelte`

**Interfaces:**
- Consumes: `requireRole` (Contract 3), `hashPassword`/`verifyPassword` (Contract 3, `$lib/server/auth`), `ACCENTS` (Contract 4), schema `users`/`people`, `AccentSwatches` (Task 10), theme/comfort stores (Phase 01 — persisted server-side on the users row; the layout already applies them from `locals.user`).
- Produces:
  - `PATCH /api/admin/users/[id]` (admin+) `{ personId: string | null }` → `200 { user: { id, username, personId } }`; unknown user → 404; unknown person → 400; person linked to another user → `409 { error: 'person-already-linked', userId }`. (The admin users **page** consuming this is Phase 08.)
  - `/profile`: form actions `account` (username), `password` (current + new), `appearance` (accent/theme/comfortMode); shows the linked person as a link.

- [ ] **Step 1: Write the failing endpoint test**

Create `src/routes/api/admin/users/[id]/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { makePerson, makeTestDb, makeUser, sessionUser, stubStorage, type TestDb } from '$lib/server/testing/db';
import { PATCH } from './+server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, id: string, body: unknown) {
	return {
		locals: { db, user, platform: { storage: stubStorage } },
		params: { id },
		request: new Request(`http://test/api/admin/users/${id}`, {
			method: 'PATCH', body: JSON.stringify(body)
		})
	} as never;
}

describe('PATCH /api/admin/users/[id]', () => {
	it('403s below admin', async () => {
		const ed = sessionUser(await makeUser(db, { role: 'editor' }));
		const target = await makeUser(db, {});
		await expect(PATCH(evt(ed, target.id, { personId: null }))).rejects.toMatchObject({ status: 403 });
	});
	it('links and unlinks a person', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const target = await makeUser(db, {});
		const meg = await makePerson(db, {});
		const res = await PATCH(evt(admin, target.id, { personId: meg.id }));
		expect((await res.json()).user).toEqual({ id: target.id, username: target.username, personId: meg.id });
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, target.id)))[0];
		expect(row.personId).toBe(meg.id);
		await PATCH(evt(admin, target.id, { personId: null }));
		const after = (await db.select().from(schema.users).where(eq(schema.users.id, target.id)))[0];
		expect(after.personId).toBeNull();
	});
	it('400s on an unknown person and 404s on an unknown user', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const target = await makeUser(db, {});
		await expect(PATCH(evt(admin, target.id, { personId: 'nope' }))).rejects.toMatchObject({ status: 400 });
		await expect(PATCH(evt(admin, 'nope', { personId: null }))).rejects.toMatchObject({ status: 404 });
	});
	it('409s when the person is already linked to another user', async () => {
		const admin = sessionUser(await makeUser(db, { role: 'admin' }));
		const meg = await makePerson(db, {});
		await makeUser(db, { personId: meg.id });
		const target = await makeUser(db, {});
		const res = await PATCH(evt(admin, target.id, { personId: meg.id }));
		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe('person-already-linked');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/api/admin/users`
Expected: FAIL — "Failed to resolve import './+server'".

- [ ] **Step 3: Write the endpoint**

Create `src/routes/api/admin/users/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { people, users } from '$lib/server/db/schema';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireRole(locals, 'admin');
	const body = (await request.json().catch(() => null)) as { personId?: unknown } | null;
	if (!body || !('personId' in body) || (body.personId !== null && typeof body.personId !== 'string'))
		error(400, 'personId (string | null) required');
	const personId = body.personId as string | null;

	const target = (await locals.db.select().from(users).where(eq(users.id, params.id)))[0];
	if (!target) error(404, 'user not found');

	if (personId !== null) {
		const person = (await locals.db.select().from(people).where(eq(people.id, personId)))[0];
		if (!person) error(400, 'unknown person');
		const linked = (
			await locals.db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.personId, personId), ne(users.id, params.id)))
		)[0];
		if (linked) return json({ error: 'person-already-linked', userId: linked.id }, { status: 409 });
	}

	await locals.db.update(users).set({ personId }).where(eq(users.id, params.id));
	return json({ user: { id: target.id, username: target.username, personId } });
};
```

Run: `pnpm vitest run src/routes/api/admin/users` — Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing profile-action tests**

Create `src/routes/profile/page.server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { makeTestDb, makeUser, sessionUser, type TestDb } from '$lib/server/testing/db';
import { hashPassword } from '$lib/server/auth';
import { actions } from './+page.server';

let db: TestDb;
beforeEach(() => { db = makeTestDb(); });

function evt(user: unknown, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		locals: { db, user },
		request: new Request('http://test/profile', { method: 'POST', body: fd })
	} as never;
}

describe('profile actions', () => {
	it('account: rejects a taken username', async () => {
		await makeUser(db, { username: 'taken' });
		const me = sessionUser(await makeUser(db, { username: 'me' }));
		const result = (await actions.account(evt(me, { username: 'taken' }))) as { status?: number };
		expect(result.status).toBe(400);
	});
	it('account: renames the user', async () => {
		const me = sessionUser(await makeUser(db, { username: 'me' }));
		await actions.account(evt(me, { username: 'renamed' }));
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.username).toBe('renamed');
	});
	it('password: requires the current password', async () => {
		const stored = await hashPassword('old-password-1');
		const me = sessionUser(await makeUser(db, { passwordHash: stored }));
		const bad = (await actions.password(
			evt(me, { current: 'wrong', next: 'new-password-1' })
		)) as { status?: number };
		expect(bad.status).toBe(400);
		const ok = await actions.password(evt(me, { current: 'old-password-1', next: 'new-password-1' }));
		expect(ok).toEqual({ saved: 'password' });
	});
	it('appearance: validates the accent and persists theme/comfort', async () => {
		const me = sessionUser(await makeUser(db, {}));
		const bad = (await actions.appearance(
			evt(me, { accentColor: '#000000', theme: 'dark' })
		)) as { status?: number };
		expect(bad.status).toBe(400);
		await actions.appearance(evt(me, { accentColor: '#FFD9A8', theme: 'dark', comfortMode: 'on' }));
		const row = (await db.select().from(schema.users).where(eq(schema.users.id, me.id)))[0];
		expect(row.accentColor).toBe('#FFD9A8');
		expect(row.theme).toBe('dark');
		expect(row.comfortMode).toBe(true);
	});
});
```

Run: `pnpm vitest run src/routes/profile` — Expected: FAIL — "Failed to resolve import './+page.server'".

- [ ] **Step 5: Write the profile load + actions**

Create `src/routes/profile/+page.server.ts`:

```ts
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { ACCENTS } from '$lib/ui/tokens';
import { people, users } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const row = (await locals.db.select().from(users).where(eq(users.id, locals.user.id)))[0];
	let linkedPerson: { id: string; name: string } | null = null;
	if (row.personId) {
		const p = (await locals.db.select().from(people).where(eq(people.id, row.personId)))[0];
		if (p) linkedPerson = { id: p.id, name: p.name };
	}
	return {
		profile: {
			username: row.username,
			role: row.role,
			accentColor: row.accentColor,
			theme: row.theme,
			comfortMode: row.comfortMode
		},
		linkedPerson
	};
};

export const actions: Actions = {
	account: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '').trim();
		if (username.length < 3 || username.length > 32)
			return fail(400, { message: 'Username must be 3–32 characters' });
		const clash = (
			await locals.db
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.username, username), ne(users.id, locals.user.id)))
		)[0];
		if (clash) return fail(400, { message: 'That username is taken' });
		await locals.db.update(users).set({ username }).where(eq(users.id, locals.user.id));
		return { saved: 'account' };
	},

	password: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const current = String(fd.get('current') ?? '');
		const next = String(fd.get('next') ?? '');
		if (next.length < 8) return fail(400, { message: 'New password must be at least 8 characters' });
		const row = (await locals.db.select().from(users).where(eq(users.id, locals.user.id)))[0];
		if (!(await verifyPassword(current, row.passwordHash)))
			return fail(400, { message: 'Current password is incorrect' });
		await locals.db
			.update(users)
			.set({ passwordHash: await hashPassword(next) })
			.where(eq(users.id, locals.user.id));
		return { saved: 'password' };
	},

	appearance: async ({ locals, request }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const fd = await request.formData();
		const accentColor = String(fd.get('accentColor') ?? '');
		const theme = String(fd.get('theme') ?? 'system');
		const comfortMode = fd.get('comfortMode') === 'on';
		if (!ACCENTS.some((a) => a.hex === accentColor))
			return fail(400, { message: 'Pick one of the accent swatches' });
		if (!['system', 'dark', 'light'].includes(theme))
			return fail(400, { message: 'Invalid theme' });
		await locals.db
			.update(users)
			.set({ accentColor, theme: theme as 'system' | 'dark' | 'light', comfortMode })
			.where(eq(users.id, locals.user.id));
		return { saved: 'appearance' };
	}
};
```

Run: `pnpm vitest run src/routes/profile` — Expected: PASS (4 tests).

- [ ] **Step 6: Write the profile page**

Create `src/routes/profile/+page.svelte`:

```svelte
<script lang="ts">
	import Nav from '$lib/ui/Nav.svelte';
	import AccentSwatches from '$lib/ui/AccentSwatches.svelte';

	let { data, form } = $props();
	let accentColor = $state(data.profile.accentColor);
</script>

<svelte:head><title>Profile — Shoebox</title></svelte:head>

<div class="page">
	<Nav />
	<div class="wrap">
		<h1>Profile</h1>
		{#if form?.message}<p class="err" data-testid="profile-error">{form.message}</p>{/if}
		{#if form?.saved}<p class="ok" data-testid="profile-saved">Saved.</p>{/if}

		<section>
			<div class="label">Account</div>
			<form method="POST" action="?/account">
				<label class="field">
					<span>Username</span>
					<input name="username" value={data.profile.username} minlength="3" maxlength="32" />
				</label>
				<button type="submit" data-testid="save-account">Save username</button>
			</form>
			<form method="POST" action="?/password">
				<label class="field"><span>Current password</span><input name="current" type="password" /></label>
				<label class="field"><span>New password</span><input name="next" type="password" minlength="8" /></label>
				<button type="submit" data-testid="save-password">Change password</button>
			</form>
		</section>

		<section>
			<div class="label">Appearance</div>
			<form method="POST" action="?/appearance">
				<AccentSwatches bind:value={accentColor} />
				<input type="hidden" name="accentColor" value={accentColor} />
				<label class="field">
					<span>Theme</span>
					<select name="theme" value={data.profile.theme}>
						<option value="system">System</option>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
					</select>
				</label>
				<label class="check">
					<input type="checkbox" name="comfortMode" checked={data.profile.comfortMode} />
					<span>Comfort mode — larger type, calmer motion</span>
				</label>
				<button type="submit" data-testid="save-appearance">Save appearance</button>
			</form>
		</section>

		<section>
			<div class="label">Linked person</div>
			{#if data.linkedPerson}
				<p class="linked" data-testid="linked-person">
					You are linked to
					<a href={`/people/${data.linkedPerson.id}`}>{data.linkedPerson.name}</a>
					— you can edit their story and birth place.
				</p>
			{:else}
				<p class="linked">Not linked to a person. An admin can link your account.</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--ink);
		color: var(--cream);
	}
	.wrap {
		max-width: 640px;
		padding: 30px;
	}
	h1 {
		font-family: var(--font-serif);
		font-size: 40px;
		font-weight: 400;
		margin: 0 0 24px;
	}
	section {
		margin-bottom: 36px;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 10.5px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
		margin-bottom: 14px;
	}
	form {
		margin-bottom: 20px;
	}
	.field {
		display: block;
		margin-bottom: 12px;
	}
	.field span {
		display: block;
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--cream) 60%, transparent);
		margin-bottom: 6px;
	}
	.field input,
	.field select {
		width: 100%;
		font-family: var(--font-serif);
		font-size: 17px;
		background: color-mix(in srgb, var(--cream) 12%, transparent);
		border: none;
		color: var(--cream);
		padding: 12px 14px;
		min-height: 44px;
		color-scheme: dark;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-serif);
		font-size: 16px;
		min-height: 44px;
		margin: 10px 0;
	}
	.check input {
		width: 18px;
		height: 18px;
		accent-color: var(--dawn);
	}
	button {
		font-family: var(--font-sans);
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		background: var(--dawn);
		color: var(--ink);
		border: none;
		cursor: pointer;
		min-height: 44px;
		padding: 0 20px;
		margin-top: 8px;
	}
	.linked {
		font-family: var(--font-serif);
		font-size: 17px;
		line-height: 1.6;
	}
	.linked a {
		color: var(--dawn);
		text-decoration: none;
	}
	.err {
		font-family: var(--font-sans);
		font-size: 12px;
		color: var(--dawn);
	}
	.ok {
		font-family: var(--font-sans);
		font-size: 12px;
		opacity: 0.8;
	}
</style>
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm check && pnpm vitest run src/routes/profile src/routes/api/admin/users` — Expected: 0 errors / PASS.
Manual: `/profile` edits username (dupe rejected with message), changes password (old required), swaps accent/theme/comfort (persisted across reload), shows the linked-person link.

```bash
git add src/routes/api/admin/users src/routes/profile
git commit -m "feat: user-person linking endpoint and profile page (account, password, appearance)"
```

---

### Task 17: Comment identity polish — shared `CommentList` with accent usernames

**Files:**
- Create: `src/lib/ui/relative-time.ts` — Test: `src/lib/ui/relative-time.test.ts` (if Phase 04 already shipped an equivalent helper, reuse it and skip these two files)
- Create: `src/lib/ui/CommentList.svelte`
- Modify: `src/lib/ui/Comments.svelte` (Phase 04 — delegate its list rendering)

**Interfaces:**
- Consumes: comment JSON shape from Phase 04 endpoints (`{ id, body, createdAt, user: { id, username, accentColor } }`), `Avatar.svelte`.
- Produces:
  - `export function relativeTime(iso: string, now?: Date): string` — "just now", "4m ago", "3h ago", "2d ago", else "Jun 14, 1994".
  - `CommentList.svelte` props: `{ comments: CommentView[]; canDelete: (c: CommentView) => boolean; ondelete: (id: string) => void }` where `CommentView = { id: string; body: string; createdAt: string; user: { id: string; username: string; accentColor: string } }` (exported from the component's module script).

- [ ] **Step 1: Write the failing relative-time test**

Create `src/lib/ui/relative-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = new Date('1994-06-14T12:00:00Z');

describe('relativeTime', () => {
	it('says just now under a minute', () => {
		expect(relativeTime('1994-06-14T11:59:30Z', NOW)).toBe('just now');
	});
	it('minutes, hours, days', () => {
		expect(relativeTime('1994-06-14T11:56:00Z', NOW)).toBe('4m ago');
		expect(relativeTime('1994-06-14T09:00:00Z', NOW)).toBe('3h ago');
		expect(relativeTime('1994-06-12T12:00:00Z', NOW)).toBe('2d ago');
	});
	it('falls back to a short date after 30 days', () => {
		expect(relativeTime('1994-01-02T12:00:00Z', NOW)).toBe('Jan 2, 1994');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ui/relative-time.test.ts`
Expected: FAIL — "Failed to resolve import './relative-time'".

- [ ] **Step 3: Implement**

Create `src/lib/ui/relative-time.ts`:

```ts
export function relativeTime(iso: string, now: Date = new Date()): string {
	const then = new Date(iso);
	const s = Math.max(0, (now.getTime() - then.getTime()) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
	return then.toLocaleDateString('en-US', {
		month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
	});
}
```

Run: `pnpm vitest run src/lib/ui/relative-time.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 4: Write `CommentList.svelte`**

Create `src/lib/ui/CommentList.svelte`:

```svelte
<script module lang="ts">
	export interface CommentView {
		id: string;
		body: string;
		createdAt: string;
		user: { id: string; username: string; accentColor: string };
	}
</script>

<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import { relativeTime } from './relative-time';

	let {
		comments,
		canDelete,
		ondelete
	}: {
		comments: CommentView[];
		canDelete: (c: CommentView) => boolean;
		ondelete: (id: string) => void;
	} = $props();
</script>

<ul class="comments" data-testid="comment-list">
	{#each comments as c (c.id)}
		<li>
			<div class="head">
				<Avatar name={c.user.username} accentColor={c.user.accentColor} size={19} />
				<span class="who" style:color={c.user.accentColor} data-testid="comment-username">
					{c.user.username}
				</span>
				<span class="when">{relativeTime(c.createdAt)}</span>
				{#if canDelete(c)}
					<button class="x" aria-label="Delete comment" onclick={() => ondelete(c.id)}>×</button>
				{/if}
			</div>
			<p class="body">{c.body}</p>
		</li>
	{/each}
</ul>

<style>
	.comments {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		margin-bottom: 18px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.who {
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.when {
		font-family: var(--font-sans);
		font-size: 10px;
		letter-spacing: 0.1em;
		color: color-mix(in srgb, var(--cream) 50%, transparent);
	}
	.x {
		margin-left: auto;
		background: none;
		border: none;
		color: color-mix(in srgb, var(--cream) 45%, transparent);
		font-size: 15px;
		cursor: pointer;
		min-width: 32px;
		min-height: 32px;
	}
	.body {
		font-family: var(--font-serif);
		font-size: 16px;
		line-height: 1.6;
		margin: 6px 0 0;
		color: color-mix(in srgb, var(--cream) 92%, transparent);
	}
</style>
```

- [ ] **Step 5: Delegate `Comments.svelte` to it and audit accent usage**

Surgical edit to the Phase 04 file `src/lib/ui/Comments.svelte`:
1. Add `import CommentList from './CommentList.svelte';` to the script block.
2. Replace its internal comment-list markup (the loop that renders avatar + username + time + body per comment) with:

```svelte
<CommentList
	{comments}
	canDelete={(c) => currentUser != null && (c.user.id === currentUser.id || isEditor)}
	ondelete={deleteComment}
/>
```

using the file's existing `comments` array, current-user variable, editor check, and delete function names — keep the **"Add a memory…"** input form exactly as Phase 04 built it. Delete the now-unused per-comment markup and any styles it orphaned.

3. Audit — run:

```bash
grep -rn "username" src/lib/ui src/routes --include='*.svelte'
```

For every hit that renders a username: it must be uppercase sans colored by that user's `accentColor` (via `CommentList`, or `style:color={user.accentColor}`), **except** the Nav account block, which stays a monogram in ink per the locked mockups (spec §10). Fix any violations found (the fix is always `style:color={...accentColor}` on the username span).

- [ ] **Step 6: Verify**

Run: `pnpm check && pnpm vitest run src/lib/ui` — Expected: 0 errors / PASS.
Manual: open an item room with comments from two users with different accents — each username renders in its own accent, 19px avatar inline, serif 16px body, relative time; author/editor sees the delete ×; the input still says "Add a memory…".

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/relative-time.ts src/lib/ui/relative-time.test.ts src/lib/ui/CommentList.svelte src/lib/ui/Comments.svelte
git commit -m "feat: shared CommentList with accent-colored usernames; comment identity audit"
```

---

### Task 18: Playwright e2e — people, relationships, linked bio, ages, albums

**Files:**
- Create: `e2e/support/seed-phase05.ts`
- Create: `e2e/people-albums.spec.ts`

**Interfaces:**
- Consumes: everything above; Contract 1 schema (direct DB seeding); Contract 3 password format; the Playwright webServer env from Phase 01 (see Consumed Interfaces — adjust `DB_PATH`/`MEDIA_PATH` constants if `playwright.config.ts` differs).
- Produces: the phase's golden-path proof.

- [ ] **Step 1: Write the seed helper**

Create `e2e/support/seed-phase05.ts`:

```ts
// Seeds deterministic phase-05 fixtures directly into the e2e SQLite DB +
// media dir. Idempotent: wipes its own 'e2e05-' rows first. Runs in the
// Playwright node process (better-sqlite3 is fine here).
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, inArray, like, or } from 'drizzle-orm';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as schema from '../../src/lib/server/db/schema';

const DB_PATH = process.env.DATABASE_PATH ?? './e2e/.data/shoebox.db';
const MEDIA_PATH = process.env.MEDIA_PATH ?? './e2e/.data/media';

// Contract 3 format: pbkdf2$310000$<salt_b64>$<hash_b64> (32-byte key — match
// Phase 01's verifyPassword derived-key length if it differs).
function hashPasswordSync(pw: string): string {
	const salt = randomBytes(16);
	const hash = pbkdf2Sync(pw, salt, 310000, 32, 'sha256');
	return `pbkdf2$310000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const WEBP_1PX = Buffer.from(
	'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
	'base64'
);

export const CREDS = {
	admin: { username: 'e2e05-admin', password: 'admin-pass-123!' },
	margaret: { username: 'e2e05-margaret', password: 'margaret-pass-123!' }
};

export async function seedPhase05() {
	const sqlite = new Database(DB_PATH);
	sqlite.pragma('busy_timeout = 5000');
	const db = drizzle(sqlite, { schema });

	// wipe our previous rows (children first)
	const oldItems = (await db.select({ id: schema.items.id }).from(schema.items))
		.map((r) => r.id)
		.filter((id) => id.startsWith('e2e05-'));
	if (oldItems.length) {
		await db.delete(schema.albumItems).where(inArray(schema.albumItems.itemId, oldItems));
		await db.delete(schema.itemPeople).where(inArray(schema.itemPeople.itemId, oldItems));
		await db.delete(schema.itemFiles).where(inArray(schema.itemFiles.itemId, oldItems));
		await db.delete(schema.comments).where(inArray(schema.comments.itemId, oldItems));
		await db.delete(schema.items).where(inArray(schema.items.id, oldItems));
	}
	// albums created by a previous UI run (nanoid ids) — wipe by the test title
	const staleAlbums = (
		await db.select({ id: schema.albums.id }).from(schema.albums)
			.where(eq(schema.albums.title, 'Summer at the Lake'))
	).map((r) => r.id);
	if (staleAlbums.length) {
		await db.delete(schema.albumItems).where(inArray(schema.albumItems.albumId, staleAlbums));
		await db.delete(schema.albums).where(inArray(schema.albums.id, staleAlbums));
	}
	// relationships added by a previous UI run reference e2e05 people (nanoid ids)
	await db.delete(schema.relationships).where(
		or(like(schema.relationships.personA, 'e2e05-%'), like(schema.relationships.personB, 'e2e05-%'))
	);
	for (const u of Object.values(CREDS)) {
		const row = (await db.select().from(schema.users).where(eq(schema.users.username, u.username)))[0];
		if (row) {
			await db.delete(schema.sessions).where(eq(schema.sessions.userId, row.id));
			await db.delete(schema.users).where(eq(schema.users.id, row.id));
		}
	}
	await db.delete(schema.people).where(like(schema.people.id, 'e2e05-%'));

	// users — admin (editor+admin rights for the whole flow) + margaret's account
	const adminId = 'e2e05-uadmin';
	const margaretUserId = 'e2e05-umeg';
	await db.insert(schema.users).values([
		{
			id: adminId, username: CREDS.admin.username,
			passwordHash: hashPasswordSync(CREDS.admin.password), role: 'admin',
			accentColor: '#FA7B62', comfortMode: false, theme: 'system', createdAt: new Date()
		},
		{
			id: margaretUserId, username: CREDS.margaret.username,
			passwordHash: hashPasswordSync(CREDS.margaret.password), role: 'user',
			accentColor: '#FFD9A8', comfortMode: false, theme: 'system', createdAt: new Date()
		}
	]);

	// people — Margaret (full detail, accent #D3826E) + family
	const people = {
		margaret: 'e2e05-margaret',
		frank: 'e2e05-frank',
		davidsr: 'e2e05-davidsr',
		carol: 'e2e05-carol',
		joe: 'e2e05-joe'
	};
	await db.insert(schema.people).values([
		{
			id: people.margaret, name: 'Margaret Torcivia', birthdate: '1941-03-15',
			deathDate: '2019-06-01', birthPlace: 'Brooklyn, New York',
			accentColor: '#D3826E', createdAt: new Date()
		},
		{ id: people.frank, name: 'Frank', accentColor: '#446179', createdAt: new Date() },
		{ id: people.davidsr, name: 'David Sr.', accentColor: '#FFD9A8', createdAt: new Date() },
		{ id: people.carol, name: 'Carol', accentColor: '#A8D8EA', createdAt: new Date() },
		{ id: people.joe, name: 'Joe', accentColor: '#FFD700', createdAt: new Date() }
	]);

	// items — 2× 1993, 3× 1994, all tagged Margaret; real 1px webp thumbs on disk
	const dates = ['1993-06-01', '1993-08-14', '1994-06-14', '1994-06-21', '1994-07-04'];
	const itemIds: string[] = [];
	for (let i = 0; i < dates.length; i++) {
		const id = `e2e05-i${i + 1}`;
		itemIds.push(id);
		await db.insert(schema.items).values({
			id, type: 'photo', title: `Moment ${i + 1}`,
			dateStart: dates[i], dateEnd: dates[i], datePrecision: 'day', sortDate: dates[i],
			width: 800, height: 600, sizeBytes: 1000, sha256: `e2e05-sha-${i}`,
			source: 'upload', status: 'ready', uploadedBy: adminId, createdAt: new Date()
		});
		const dir = path.join(MEDIA_PATH, 'media', id);
		mkdirSync(dir, { recursive: true });
		for (const kind of ['thumb_400', 'thumb_800', 'poster'] as const) {
			writeFileSync(path.join(dir, `${kind}.webp`), WEBP_1PX);
			await db.insert(schema.itemFiles).values({
				id: `${id}-${kind}`, itemId: id, kind,
				storageKey: `media/${id}/${kind}.webp`, mime: 'image/webp', width: 400, height: 300
			});
		}
		await db.insert(schema.itemPeople).values({ itemId: id, personId: people.margaret, source: 'manual' });
	}

	sqlite.close();
	return { adminId, margaretUserId, people, itemIds };
}
```

- [ ] **Step 2: Write the spec**

Create `e2e/people-albums.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { CREDS, seedPhase05 } from './support/seed-phase05';

test.describe.configure({ mode: 'serial' });

let seed: Awaited<ReturnType<typeof seedPhase05>>;
test.beforeAll(async () => {
	seed = await seedPhase05();
});

async function login(page: Page, creds: { username: string; password: string }) {
	await page.goto('/login');
	await page.fill('input[name="username"]', creds.username);
	await page.fill('input[name="password"]', creds.password);
	await page.click('button[type="submit"]');
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('editor sets relationships and the person page renders family rows', async ({ page }) => {
	await login(page, CREDS.admin);
	await page.goto(`/people/${seed.people.margaret}/edit`);
	const addRel = async (kind: string, personId: string) => {
		await page.selectOption('[data-testid="rel-kind"]', kind);
		await page.selectOption('[data-testid="rel-person"]', personId);
		await page.click('[data-testid="rel-add"]');
		await page.waitForResponse((r) => r.url().includes('/relationships') && r.ok());
	};
	await addRel('spouse', seed.people.frank);
	await addRel('child', seed.people.davidsr);
	await addRel('child', seed.people.carol);
	await addRel('child', seed.people.joe);

	await page.goto(`/people/${seed.people.margaret}`);
	await expect(page.getByTestId('family-row-spouse')).toContainText('Frank');
	const children = page.getByTestId('family-row-children');
	await expect(children).toContainText('David Sr.');
	await expect(children).toContainText('Carol');
	await expect(children).toContainText('Joe');
	// no tree view — family is label rows only
	await expect(page.getByTestId('family-rows')).toBeVisible();
});

test('person page hero, stats, accent room, and age captions match the data', async ({ page }) => {
	await login(page, CREDS.admin);
	await page.goto(`/people/${seed.people.margaret}`);
	await expect(page.getByTestId('person-eyebrow')).toHaveText('1941 — 2019 · Born Brooklyn, New York');
	await expect(page.getByTestId('person-name')).toHaveText('Margaret Torcivia');
	await expect(page.getByTestId('stat-moments')).toHaveText('5');
	await expect(page.getByTestId('stat-onfilm')).toHaveText('1993–1994');
	// the room derives from the person's accent
	await expect(page.getByTestId('person-room')).toHaveAttribute('data-accent', '#D3826E');
	const bg = await page
		.getByTestId('person-room')
		.evaluate((el) => getComputedStyle(el).backgroundImage);
	expect(bg).toContain('gradient');
	// year chunk header: born 1941-03-15 → age 53 in mid-1994, 3 moments
	await expect(page.getByTestId('year-meta-1994')).toHaveText(/Age 53 · 3 moments/);
	await expect(page.getByTestId('year-meta-1993')).toHaveText(/Age 52 · 2 moments/);
	// age caption on the cards
	await expect(page.getByTestId('year-1994').getByText('age 53').first()).toBeVisible();
});

test('linked user edits their own bio', async ({ page }) => {
	await login(page, CREDS.admin);
	// link margaret's account via the phase-05 admin endpoint
	const res = await page.request.patch(`/api/admin/users/${seed.margaretUserId}`, {
		data: { personId: seed.people.margaret }
	});
	expect(res.ok()).toBeTruthy();

	await page.context().clearCookies();
	await login(page, CREDS.margaret);
	await page.goto(`/people/${seed.people.margaret}`);
	await expect(page.getByTestId('edit-bio')).toHaveText('Edit bio — you are linked to this person');
	await page.getByTestId('edit-bio').click();
	await page.getByTestId('bio-textarea').fill('She ran the kitchen **like a bridge crew**.');
	await page.getByTestId('bio-save').click();
	await expect(page.getByTestId('person-bio')).toContainText('like a bridge crew');
	// markdown rendered (strong), never italic
	await expect(page.getByTestId('person-bio').locator('strong')).toHaveText('like a bridge crew');
});

test('album: create → add items from the item room → reorder → cover renders', async ({ page }) => {
	await login(page, CREDS.admin);
	await page.goto('/albums');
	await page.getByTestId('new-album').click();
	await page.fill('input[name="title"]', 'Summer at the Lake');
	await page.getByTestId('create-album').click();
	await page.waitForURL('**/albums/**');
	const albumId = page.url().split('/albums/')[1];

	// add two items via the item-room toggle
	for (const itemId of [seed.itemIds[2], seed.itemIds[3]]) {
		await page.goto(`/item/${itemId}`);
		await page.getByTestId('album-toggle').locator('summary').click();
		await page.getByTestId(`album-check-${albumId}`).check();
		await page.waitForResponse((r) => r.url().includes(`/api/albums/${albumId}/items`) && r.ok());
	}

	await page.goto(`/albums/${albumId}`);
	await expect(page.getByTestId('album-title')).toHaveText('Summer at the Lake');

	// reorder: drag the first tile onto the second
	await page.getByTestId('arrange-toggle').click();
	const tiles = page.getByTestId('reorder-tile');
	await expect(tiles).toHaveCount(2);
	const firstSrcBefore = await tiles.first().locator('img').getAttribute('src');
	const target = await tiles.nth(1).boundingBox();
	await tiles.first().hover();
	await page.mouse.down();
	await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 10 });
	await page.mouse.up();
	await page.waitForResponse((r) => r.url().includes(`/api/albums/${albumId}/items`) && r.ok());
	await page.reload();
	await page.getByTestId('arrange-toggle').click();
	const firstSrcAfter = await page.getByTestId('reorder-tile').first().locator('img').getAttribute('src');
	expect(firstSrcAfter).not.toBe(firstSrcBefore);

	// cover renders on the index
	await page.goto('/albums');
	const card = page.getByTestId('album-card').filter({ hasText: 'Summer at the Lake' });
	await expect(card.getByTestId('album-cover')).toBeVisible();
	await expect(card).toContainText('2 moments');
	// person page album stat now counts it (Margaret is on both items)
	await page.goto(`/people/${seed.people.margaret}`);
	await expect(page.getByTestId('stat-albums')).toHaveText('1');
});

test('people index: sorted by moments, gradient fallback card', async ({ page }) => {
	await login(page, CREDS.admin);
	await page.goto('/people');
	const cards = page.getByTestId('person-card');
	await expect(cards.first()).toContainText('Margaret Torcivia'); // most moments
	const frank = cards.filter({ hasText: 'Frank' });
	await expect(frank.getByTestId('person-card-fill')).toBeVisible(); // no avatar → accent gradient
	// create a person through the UI
	await page.getByTestId('new-person').click();
	await page.fill('input[name="name"]', 'Rose');
	await page.getByTestId('create-person').click();
	await page.waitForURL('**/edit');
	await expect(page.getByTestId('edit-name')).toHaveValue('Rose');
});
```

- [ ] **Step 3: Run the phase e2e**

Run: `pnpm exec playwright test e2e/people-albums.spec.ts`
Expected: 5 passed. If the login selectors or `DATABASE_PATH`/`MEDIA_PATH` defaults don't match Phase 01's `playwright.config.ts`, fix the two constants in `seed-phase05.ts` / the `login` helper — do not change app code for the test.

- [ ] **Step 4: Full suite green**

Run: `pnpm check && pnpm vitest run && pnpm exec playwright test`
Expected: typecheck clean, all unit tests pass, all e2e (Phases 01–05) pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/support/seed-phase05.ts e2e/people-albums.spec.ts
git commit -m "test: phase 05 e2e — relationships, linked bio, age captions, album reorder + cover"
```

---

## Phase completion checklist

- [ ] `pnpm check` clean; `pnpm vitest run` green; `pnpm exec playwright test` green (all phases).
- [ ] Person page matches the LOCKED mockup: no tree, hero top-aligned, stats locked to portrait bottom, family label rows, no nickname (Resolution 1), "Story" label (Resolution 2).
- [ ] Every username render uses the user's accent color (except the Nav ink monogram).
- [ ] No `border-radius`, no italics, no Inter, no hard-coded hex outside `tokens.ts` (accent/room values flowing from person data are fine — they originate in `ACCENTS`).
- [ ] Nothing from Phases 06/08/09 leaked in (no search UI, no share links, no faces).




