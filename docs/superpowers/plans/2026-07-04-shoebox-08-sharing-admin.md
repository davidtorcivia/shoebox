# Shoebox Phase 08 — Sharing, Admin, Comfort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the last user-facing surface of Shoebox: public share links (password/expiry/download-flag) with stripped read-only rooms, the full admin suite (users, invites, shares, trash + 30-day sweep, settings, jobs), the profile page, a comfort-mode polish pass verified by axe, and per-album zip export.

**Architecture:** Share access is a second, parallel authorization channel: `resolveShare()` in `src/lib/server/shares.ts` gates the `/share/[token]` pages, and a 24-hour hashed cookie (`sb_share_<token>`) lets the existing `/media/[...key]` route authorize signed-out image/video requests through `canAccessMedia(locals, key)` (the seam left by phase 02). Share pages use a dedicated lightweight UI kit (`src/lib/ui/share/`) so the public surface stays stripped (no Nav, no comments, no edit affordances) without forking the app components. Admin pages are thin Svelte pages over the `/api/admin/*` + `/api/invites` + `/api/shares` JSON routes fixed by master Contract 6; destructive logic lives in unit-tested modules under `src/lib/server/`. Export is a node-only streaming zip behind the `platform.features.serverDerivatives` flag (501 on Cloudflare).

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM (better-sqlite3 / D1), WebCrypto (PBKDF2 + SHA-256), nanoid, archiver (node-only, dynamic import), Vitest, Playwright + @axe-core/playwright.

**Master plan:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts (schema, platform interfaces, auth, tokens, domain signatures, API table, storage keys) are LAW. Nothing in this plan adds a table, a column, a `jobs.kind` value, or a `Platform.features` flag.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` §3 (sharing), §10 (comfort/accessibility), §11 (admin), §12 (error handling), §14 (export).

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

Master path line: `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` (Contracts 1–8; phase table row 08).

## Interfaces assumed from earlier phases (reconcile before Task 1)

Phases 01–07 shipped auth/invites, items/media, timeline, player room, people/albums/comments, search, and the worker/Arrivals. This plan consumes them through the names below. **Before starting Task 1, spend ten minutes grepping the repo for each export. Master-contract items (marked LAW) must exist exactly as written; for the convenience helpers (marked assumed), if the shipped name differs, use the shipped name and update this plan's call sites — do not create duplicates.**

| Import | Signature | Status |
|---|---|---|
| `$lib/server/auth` | `hashPassword(pw: string): Promise<string>` / `verifyPassword(pw: string, stored: string): Promise<boolean>` (PBKDF2-SHA256, 310k iters, `pbkdf2$310000$<salt_b64>$<hash_b64>`) | LAW (Contract 3) |
| `$lib/server/roles` | `requireRole(locals: App.Locals, min: Role): SessionUser`; `ROLE_RANK` | LAW (Contract 3) |
| `$lib/server/db/schema` | all tables per Contract 1 | LAW |
| `$lib/server/db` | `export type Db` (= `ReturnType<typeof drizzle>`) | assumed (phase 01) |
| `$lib/server/db/test-db` | `makeTestDb(): Promise<Db>` — in-memory better-sqlite3 + all migrations applied (the helper phase 01/02 unit tests already use; reuse whatever it is actually called) | assumed |
| `$lib/server/items` | `type ItemDTO` (shape is LAW, Contract 6); `getItemDTO(db: Db, storage: StorageAdapter, id: string): Promise<ItemDTO \| null>`; `listAlbumItemDTOs(db: Db, storage: StorageAdapter, albumId: string): Promise<ItemDTO[]>` (phase 05 album page uses it) | DTO LAW / helpers assumed |
| `$lib/server/search` | `reindexItem(db: Db, itemId: string): Promise<void>` | LAW (Contract 1 FTS note) |
| `$lib/server/media-access` | `canAccessMedia(locals: App.Locals, key: string): Promise<boolean>` — phase 02 seam, currently `return !!locals.user`; the `/media/[...key]/+server.ts` route already calls it and 403s on false | assumed seam (this phase completes it) |
| `$lib/ui/tokens` | `INK, CREAM, DAWN, ACCENTS, GRAIN_URI, FONT, MOTION, paletteFor(year), playerRoomFor(year)` | LAW (Contract 4) |
| `$lib/ui/theme` | `theme` store (`'system'\|'dark'\|'light'`), `comfort` store (boolean, mirrors `html.comfort`), `reducedMotion` store | assumed (phase 01) |
| `e2e/helpers` | `OWNER = { username, password }` used by first-run e2e; `signIn(page: Page, username: string, password: string): Promise<void>`; `seedBasicArchive(request: APIRequestContext): Promise<{ albumId: string; itemIds: string[]; personId: string }>` (uses the same upload API driving phase 02's e2e) | assumed — if phase 02–07 e2e seeds differently, wrap that mechanism under these names in `e2e/helpers.ts` rather than inventing a second seeder |

## File Structure

```
src/lib/server/
├─ shares.ts                        # Task 1 — createShare/resolveShare/rate-limit/cookie helpers (Contract 7 location)
├─ shares.test.ts                   # Task 1
├─ media-access.ts                  # Task 3 — canAccessMedia() completed (phase-02 seam)
├─ media-access.test.ts             # Task 3
├─ admin-users.ts (+ .test.ts)      # Task 9 — role-change/reset/delete-reassign guards
├─ trash.ts (+ .test.ts)            # Task 11 — listTrash/restore/purgeExpired/emptyTrash (30-day sweep)
├─ admin-settings.ts (+ .test.ts)   # Task 12 — siteName/holidaySet get+update
├─ admin-jobs.ts (+ .test.ts)       # Task 12 — listJobs/retryJob
├─ profile.ts (+ .test.ts)          # Task 13 — changeUsername/changePassword/updateAppearance
└─ platform/node-export.ts          # Task 15 — archiver zip stream (node-only carve-out)

src/lib/ui/share/
├─ ShareRoom.svelte                 # Task 5 — gradient room + grain + Shoebox wordmark footer
├─ ShareGallery.svelte              # Task 5 — read-only masonry
└─ ShareViewer.svelte               # Task 5 — lightbox/player room (single + overlay modes)

src/lib/ui/ShareDialog.svelte       # Task 7 — create/list/revoke shares (editor+)

src/routes/
├─ share/[token]/+page.server.ts    # Task 4 — resolve/gate/cookie + content load
├─ share/[token]/+page.svelte       # Task 4 (gate/expired) → Task 5/6 (album/item rooms)
├─ api/shares/+server.ts            # Task 2 — GET/POST (editor)
├─ api/shares/[id]/+server.ts       # Task 2 — DELETE (editor)
├─ api/albums/[id]/export/+server.ts# Task 15 — zip (node) / 501 (CF)
├─ admin/+layout.server.ts/.svelte  # Task 8 — admin guard + section nav
├─ admin/+page.server.ts            # Task 8 — redirect → /admin/users
├─ admin/users/+page.server.ts/.svelte     # Task 9
├─ admin/invites/+page.server.ts/.svelte   # Task 10 (replaces phase-01 stub)
├─ admin/shares/+page.server.ts/.svelte    # Task 10
├─ admin/trash/+page.server.ts/.svelte     # Task 11 (auto-sweep on load)
├─ admin/settings/+page.server.ts/.svelte  # Task 12
├─ admin/jobs/+page.server.ts/.svelte      # Task 12
├─ api/admin/users/+server.ts              # Task 9 — GET
├─ api/admin/users/[id]/+server.ts         # Task 9 — PATCH/DELETE
├─ api/admin/trash/+server.ts              # Task 11 — GET/POST/DELETE
├─ api/admin/settings/+server.ts           # Task 12 — GET/PATCH
├─ api/admin/jobs/+server.ts               # Task 12 — GET
├─ api/admin/jobs/[id]/retry/+server.ts    # Task 12 — POST
└─ profile/+page.server.ts/.svelte         # Task 13

Modified: src/hooks.server.ts, src/app.d.ts, src/routes/+layout.svelte, src/app.css,
          src/routes/albums/[id]/+page.svelte (+.server.ts), src/routes/item/[id]/+page.svelte,
          src/lib/ui/MediaCard.svelte (comfort audit)

e2e/comfort-a11y.spec.ts            # Task 14
e2e/sharing-admin.spec.ts           # Task 16
```

Forbidden in this phase: anything under `faces/` (phase 09), Dockerfiles / compose / wrangler provisioning (phase 10).

---

### Task 1: Share service — `createShare`, `resolveShare`, rate limit, cookie helpers

**Files:**
- Create: `src/lib/server/shares.ts`
- Test: `src/lib/server/shares.test.ts`

**Interfaces:**
- Consumes: `shares`, `users` tables (Contract 1); `hashPassword`/`verifyPassword` from `$lib/server/auth` (Contract 3); `nanoid`; `Db` from `$lib/server/db`; `makeTestDb` from `$lib/server/db/test-db`.
- Produces (later tasks rely on these exact names):
  - `createShare(db: Db, input: CreateShareInput): Promise<ShareRecord>`
  - `resolveShare(db: Db, token: string, password?: string, now?: Date): Promise<ShareResolution>` (Contract 7 signature + optional test clock)
  - `getShareByToken(db: Db, token: string): Promise<ShareRecord | null>`
  - `listShares(db: Db, target?: { targetType: 'album' | 'item'; targetId: string }): Promise<ShareRecord[]>`
  - `revokeShare(db: Db, id: string): Promise<void>`
  - `SHARE_COOKIE_PREFIX = 'sb_share_'`, `SHARE_COOKIE_MAX_AGE = 86400`
  - `shareCookieValue(token: string): Promise<string>` (hex sha256)
  - `_resetShareRateLimits(): void` (tests only)
  - types `CreateShareInput`, `ShareRecord`, `ShareResolution`

- [ ] **Step 1: Write the failing test**

`src/lib/server/shares.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './db/test-db';
import { users } from './db/schema';
import {
  createShare, resolveShare, getShareByToken, listShares, revokeShare,
  shareCookieValue, _resetShareRateLimits, SHARE_COOKIE_PREFIX, SHARE_COOKIE_MAX_AGE
} from './shares';
import type { Db } from './db';

let db: Db;
const OWNER_ID = 'u_owner000001';

beforeEach(async () => {
  db = await makeTestDb();
  _resetShareRateLimits();
  await db.insert(users).values({
    id: OWNER_ID, username: 'gran', passwordHash: 'x', role: 'owner',
    accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system',
    createdAt: new Date()
  });
});

describe('createShare', () => {
  it('creates a 24-char token, persists, hashes the password', async () => {
    const share = await createShare(db, {
      targetType: 'album', targetId: 'al_1', password: 'cranberry',
      expiresAt: null, allowDownload: true, createdBy: OWNER_ID
    });
    expect(share.token).toHaveLength(24);
    expect(share.hasPassword).toBe(true);
    expect(share.allowDownload).toBe(true);
    const back = await getShareByToken(db, share.token);
    expect(back?.id).toBe(share.id);
    expect(back?.targetType).toBe('album');
    // never leaks the hash
    expect(JSON.stringify(back)).not.toContain('pbkdf2$');
  });

  it('defaults: no password, no expiry, no download', async () => {
    const share = await createShare(db, { targetType: 'item', targetId: 'it_1', createdBy: OWNER_ID });
    expect(share.hasPassword).toBe(false);
    expect(share.expiresAt).toBeNull();
    expect(share.allowDownload).toBe(false);
  });
});

describe('resolveShare', () => {
  it('not_found for unknown token', async () => {
    expect(await resolveShare(db, 'nope'.repeat(6))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('expired when expiresAt is in the past', async () => {
    const s = await createShare(db, {
      targetType: 'item', targetId: 'it_1', createdBy: OWNER_ID,
      expiresAt: new Date('2000-01-01T00:00:00Z')
    });
    expect(await resolveShare(db, s.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('password_required when protected and no password given', async () => {
    const s = await createShare(db, { targetType: 'item', targetId: 'it_1', password: 'pw', createdBy: OWNER_ID });
    expect(await resolveShare(db, s.token)).toEqual({ ok: false, reason: 'password_required' });
  });

  it('wrong_password then ok with correct password', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', password: 'cranberry', createdBy: OWNER_ID });
    expect(await resolveShare(db, s.token, 'wrong')).toEqual({ ok: false, reason: 'wrong_password' });
    const res = await resolveShare(db, s.token, 'cranberry');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.share.targetType).toBe('album');
      expect(res.share.targetId).toBe('al_1');
    }
  });

  it('ok immediately when share has no password', async () => {
    const s = await createShare(db, { targetType: 'item', targetId: 'it_9', createdBy: OWNER_ID });
    const res = await resolveShare(db, s.token);
    expect(res.ok).toBe(true);
  });

  it('rate-limits password attempts to 5/min per share', async () => {
    const s = await createShare(db, { targetType: 'item', targetId: 'it_1', password: 'pw', createdBy: OWNER_ID });
    for (let i = 0; i < 5; i++) {
      expect(await resolveShare(db, s.token, 'bad')).toEqual({ ok: false, reason: 'wrong_password' });
    }
    expect(await resolveShare(db, s.token, 'bad')).toEqual({ ok: false, reason: 'rate_limited' });
    // even the CORRECT password is refused while limited
    expect(await resolveShare(db, s.token, 'pw')).toEqual({ ok: false, reason: 'rate_limited' });
    // a different share has its own bucket
    const s2 = await createShare(db, { targetType: 'item', targetId: 'it_2', password: 'pw', createdBy: OWNER_ID });
    expect((await resolveShare(db, s2.token, 'pw')).ok).toBe(true);
  });
});

describe('list/revoke', () => {
  it('lists by target and revokes', async () => {
    const a = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID });
    await createShare(db, { targetType: 'item', targetId: 'it_1', createdBy: OWNER_ID });
    expect((await listShares(db))).toHaveLength(2);
    expect(await listShares(db, { targetType: 'album', targetId: 'al_1' })).toHaveLength(1);
    await revokeShare(db, a.id);
    expect(await getShareByToken(db, a.token)).toBeNull();
    expect(await listShares(db)).toHaveLength(1);
  });
});

describe('share cookie', () => {
  it('is a stable hex sha256 of the token', async () => {
    const v1 = await shareCookieValue('abc');
    const v2 = await shareCookieValue('abc');
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(v1).not.toBe(await shareCookieValue('abd'));
    expect(SHARE_COOKIE_PREFIX).toBe('sb_share_');
    expect(SHARE_COOKIE_MAX_AGE).toBe(60 * 60 * 24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/shares.test.ts`
Expected: FAIL — `Cannot find module './shares'` (or "Failed to resolve import").

- [ ] **Step 3: Write the implementation**

`src/lib/server/shares.ts` (complete file):

```ts
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { shares } from './db/schema';
import { hashPassword, verifyPassword } from './auth';
import type { Db } from './db';

// ─── Types ────────────────────────────────────────────────────────────────

export interface CreateShareInput {
  targetType: 'album' | 'item';
  targetId: string;
  password?: string | null;
  expiresAt?: Date | null;
  allowDownload?: boolean;
  createdBy: string;
}

/** Public-safe projection of a shares row — never carries password_hash. */
export interface ShareRecord {
  id: string;
  token: string;
  targetType: 'album' | 'item';
  targetId: string;
  hasPassword: boolean;
  expiresAt: Date | null;
  allowDownload: boolean;
  createdBy: string;
}

export type ShareResolution =
  | { ok: true; share: ShareRecord }
  | { ok: false; reason: 'not_found' | 'expired' | 'password_required' | 'wrong_password' | 'rate_limited' };

type ShareRow = typeof shares.$inferSelect;

function toRecord(row: ShareRow): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    targetType: row.targetType,
    targetId: row.targetId,
    hasPassword: row.passwordHash !== null,
    expiresAt: row.expiresAt ?? null,
    allowDownload: row.allowDownload,
    createdBy: row.createdBy
  };
}

// ─── Password-attempt rate limit ──────────────────────────────────────────
// Fixed-window token bucket, 5 attempts / 60 s, keyed by share id.
// PER-INSTANCE BY DESIGN: this is a module-level Map, so it resets on
// restart and is not shared across Cloudflare isolates / multiple Node
// replicas. Acceptable for a family-scale instance (spec §12 asks only for
// "rate-limited password attempts"); a shared store is out of scope.

const RATE_CAPACITY = 5;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

function takePasswordAttempt(shareId: string, nowMs: number): boolean {
  const b = buckets.get(shareId);
  if (!b || nowMs - b.windowStart >= RATE_WINDOW_MS) {
    buckets.set(shareId, { count: 1, windowStart: nowMs });
    return true;
  }
  if (b.count >= RATE_CAPACITY) return false;
  b.count += 1;
  return true;
}

/** Test hook only. */
export function _resetShareRateLimits(): void {
  buckets.clear();
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function createShare(db: Db, input: CreateShareInput): Promise<ShareRecord> {
  const row: ShareRow = {
    id: nanoid(12),
    token: nanoid(24), // 24 nanoid chars ≈ 143 bits ≥ spec's 128-bit floor
    targetType: input.targetType,
    targetId: input.targetId,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    expiresAt: input.expiresAt ?? null,
    allowDownload: input.allowDownload ?? false,
    createdBy: input.createdBy
  };
  await db.insert(shares).values(row);
  return toRecord(row);
}

export async function getShareByToken(db: Db, token: string): Promise<ShareRecord | null> {
  const rows = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listShares(
  db: Db,
  target?: { targetType: 'album' | 'item'; targetId: string }
): Promise<ShareRecord[]> {
  const rows = target
    ? await db.select().from(shares)
        .where(and(eq(shares.targetType, target.targetType), eq(shares.targetId, target.targetId)))
    : await db.select().from(shares);
  return rows.map(toRecord);
}

/**
 * Hard delete. The shares table has no deleted_at column (master Contract 1
 * is closed); revoking a share is an access-control action on a link, not a
 * destruction of family content, so the 30-day-trash rule does not apply.
 */
export async function revokeShare(db: Db, id: string): Promise<void> {
  await db.delete(shares).where(eq(shares.id, id));
}

// ─── Resolution (Contract 7) ──────────────────────────────────────────────

export async function resolveShare(
  db: Db,
  token: string,
  password?: string,
  now: Date = new Date()
): Promise<ShareResolution> {
  const rows = await db.select().from(shares).where(eq(shares.token, token)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.passwordHash) {
    if (password === undefined) return { ok: false, reason: 'password_required' };
    if (!takePasswordAttempt(row.id, now.getTime())) return { ok: false, reason: 'rate_limited' };
    if (!(await verifyPassword(password, row.passwordHash))) return { ok: false, reason: 'wrong_password' };
  }
  return { ok: true, share: toRecord(row) };
}

// ─── Share cookie (signed-out /media authorization, Task 3/4) ────────────
// Cookie name: sb_share_<token>. Cookie value: hex sha256(token) — cheap to
// verify without a DB hit, impossible to fabricate for a token you only
// guessed the name-prefix of. 24-hour lifetime.

export const SHARE_COOKIE_PREFIX = 'sb_share_';
export const SHARE_COOKIE_MAX_AGE = 60 * 60 * 24; // 24 h, seconds

export async function shareCookieValue(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/shares.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm check
git add src/lib/server/shares.ts src/lib/server/shares.test.ts
git commit -m "feat: share service with password, expiry, rate limit, cookie helpers"
```

---

### Task 2: `/api/shares` routes (master Contract 6)

**Files:**
- Create: `src/routes/api/shares/+server.ts`
- Create: `src/routes/api/shares/[id]/+server.ts`
- Test: `src/routes/api/shares/server.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createShare`, `listShares`, `revokeShare`); `requireRole` (Contract 3); `albums`, `items` tables.
- Produces:
  - `GET /api/shares?targetType=album&targetId=al_1` (editor) → `{ shares: ShareRecord[] }` (all shares when params omitted)
  - `POST /api/shares` (editor) body `{ targetType, targetId, password?, expiry?: 'never'|'7d'|'30d'|'YYYY-MM-DD', allowDownload? }` → `201 { share: ShareRecord, url: '/share/<token>' }`
  - `DELETE /api/shares/[id]` (editor) → `204`

- [ ] **Step 1: Write the failing test**

`src/routes/api/shares/server.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { makeTestDb } from '$lib/server/db/test-db';
import { albums, items, users } from '$lib/server/db/schema';
import { getShareByToken, listShares } from '$lib/server/shares';
import type { Db } from '$lib/server/db';
import { GET, POST } from './+server';
import { DELETE } from './[id]/+server';

let db: Db;
const editor = { id: 'u_editor000001', username: 'aunt', role: 'editor', accentColor: '#FFD700', personId: null, comfortMode: false, theme: 'system' } as const;
const viewer = { ...editor, id: 'u_viewer000001', username: 'kid', role: 'user' } as const;

function event(user: typeof editor | typeof viewer | null, init?: { body?: unknown; url?: string; params?: Record<string, string> }) {
  return {
    locals: { db, user, platform: undefined as never, shareTokens: [] },
    params: init?.params ?? {},
    url: new URL(init?.url ?? 'http://localhost/api/shares'),
    request: new Request('http://localhost/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(init?.body ?? {})
    })
  } as never;
}

beforeEach(async () => {
  db = await makeTestDb();
  const now = new Date();
  await db.insert(users).values([
    { id: editor.id, username: 'aunt', passwordHash: 'x', role: 'editor', accentColor: '#FFD700', personId: null, comfortMode: false, theme: 'system', createdAt: now },
    { id: viewer.id, username: 'kid', passwordHash: 'x', role: 'user', accentColor: '#A8D8EA', personId: null, comfortMode: false, theme: 'system', createdAt: now }
  ]);
  await db.insert(albums).values({ id: 'al_1', title: 'Christmas 1994', description: null, coverItemId: null, createdBy: editor.id, createdAt: now, deletedAt: null });
  await db.insert(items).values({
    id: 'it_1', type: 'photo', title: null, description: null, dateStart: '1994-12-25', dateEnd: '1994-12-25',
    datePrecision: 'day', sortDate: '1994-12-25', duration: null, width: 800, height: 600, sizeBytes: 1000,
    sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: editor.id,
    deletedAt: null, createdAt: now
  });
});

describe('POST /api/shares', () => {
  it('rejects role < editor', async () => {
    try {
      await POST(event(viewer, { body: { targetType: 'album', targetId: 'al_1' } }));
      expect.unreachable();
    } catch (e) {
      expect(isHttpError(e) && e.status === 403).toBe(true);
    }
  });

  it('404s on a missing target', async () => {
    try {
      await POST(event(editor, { body: { targetType: 'album', targetId: 'al_missing' } }));
      expect.unreachable();
    } catch (e) {
      expect(isHttpError(e) && e.status === 404).toBe(true);
    }
  });

  it('creates album share with 7d expiry and returns the public url', async () => {
    const res = await POST(event(editor, { body: { targetType: 'album', targetId: 'al_1', password: 'pw', expiry: '7d', allowDownload: true } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe(`/share/${body.share.token}`);
    const stored = await getShareByToken(db, body.share.token);
    expect(stored?.hasPassword).toBe(true);
    expect(stored?.allowDownload).toBe(true);
    const days = (stored!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('accepts a custom ISO date expiry (even past, for testing) and never-expiry', async () => {
    const past = await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1', expiry: '2000-01-01' } }));
    const pastShare = (await past.json()).share;
    expect(new Date(pastShare.expiresAt).getFullYear()).toBe(2000);
    const never = await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1', expiry: 'never' } }));
    expect((await never.json()).share.expiresAt).toBeNull();
  });
});

describe('GET /api/shares', () => {
  it('filters by target', async () => {
    await POST(event(editor, { body: { targetType: 'album', targetId: 'al_1' } }));
    await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1' } }));
    const res = await GET(event(editor, { url: 'http://localhost/api/shares?targetType=album&targetId=al_1' }));
    const body = await res.json();
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0].targetType).toBe('album');
  });
});

describe('DELETE /api/shares/[id]', () => {
  it('revokes', async () => {
    const res = await POST(event(editor, { body: { targetType: 'item', targetId: 'it_1' } }));
    const { share } = await res.json();
    const del = await DELETE(event(editor, { params: { id: share.id } }));
    expect(del.status).toBe(204);
    expect(await listShares(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/api/shares/server.test.ts`
Expected: FAIL — `Cannot find module './+server'`.

- [ ] **Step 3: Write the implementation**

`src/routes/api/shares/+server.ts` (complete file):

```ts
import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { albums, items } from '$lib/server/db/schema';
import { createShare, listShares } from '$lib/server/shares';
import type { Db } from '$lib/server/db';

function expiresAtFrom(expiry: string | undefined | null): Date | null {
  if (!expiry || expiry === 'never') return null;
  if (expiry === '7d') return new Date(Date.now() + 7 * 86_400_000);
  if (expiry === '30d') return new Date(Date.now() + 30 * 86_400_000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw error(400, 'expiry must be never, 7d, 30d, or YYYY-MM-DD');
  const d = new Date(`${expiry}T23:59:59Z`);
  if (Number.isNaN(d.getTime())) throw error(400, 'Invalid expiry date');
  return d;
}

async function assertTargetExists(db: Db, targetType: 'album' | 'item', targetId: string): Promise<void> {
  const found =
    targetType === 'album'
      ? await db.select({ id: albums.id }).from(albums)
          .where(and(eq(albums.id, targetId), isNull(albums.deletedAt))).limit(1)
      : await db.select({ id: items.id }).from(items)
          .where(and(eq(items.id, targetId), isNull(items.deletedAt))).limit(1);
  if (found.length === 0) throw error(404, 'Share target not found');
}

export const GET: RequestHandler = async ({ locals, url }) => {
  requireRole(locals, 'editor');
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');
  const target =
    (targetType === 'album' || targetType === 'item') && targetId
      ? { targetType, targetId }
      : undefined;
  return json({ shares: await listShares(locals.db, target) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireRole(locals, 'editor');
  const body = (await request.json()) as {
    targetType?: string; targetId?: string; password?: string;
    expiry?: string; allowDownload?: boolean;
  };
  if ((body.targetType !== 'album' && body.targetType !== 'item') || !body.targetId) {
    throw error(400, 'targetType (album|item) and targetId are required');
  }
  await assertTargetExists(locals.db, body.targetType, body.targetId);
  const share = await createShare(locals.db, {
    targetType: body.targetType,
    targetId: body.targetId,
    password: body.password?.trim() ? body.password : null,
    expiresAt: expiresAtFrom(body.expiry),
    allowDownload: body.allowDownload ?? false,
    createdBy: user.id
  });
  return json({ share, url: `/share/${share.token}` }, { status: 201 });
};
```

`src/routes/api/shares/[id]/+server.ts` (complete file):

```ts
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { revokeShare } from '$lib/server/shares';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireRole(locals, 'editor');
  await revokeShare(locals.db, params.id);
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/routes/api/shares/server.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
pnpm check
git add src/routes/api/shares
git commit -m "feat: /api/shares create/list/revoke endpoints (Contract 6)"
```

---

### Task 3: Share cookies in `locals` + complete `canAccessMedia`

**Files:**
- Modify: `src/app.d.ts` (add `shareTokens` to `App.Locals`)
- Modify: `src/hooks.server.ts` (populate `locals.shareTokens` from verified `sb_share_*` cookies)
- Modify: `src/lib/server/media-access.ts` (replace the phase-02 stub with the full implementation — full contents below; if phase 02 put the seam elsewhere, move these contents there and keep the export name)
- Test: `src/lib/server/media-access.test.ts`

**Interfaces:**
- Consumes: Task 1 cookie helpers; `items`, `itemFiles`, `albumItems`, `shares` tables; storage-key convention `media/<itemId>/<kind>.<ext>` (Contract 7).
- Produces: `canAccessMedia(locals: App.Locals, key: string): Promise<boolean>` — the `/media/[...key]/+server.ts` route (phase 02) already calls this and returns 403 when false; no change to that route is needed. `App.Locals` gains `shareTokens: string[]` (additive; documented under Ambiguities).

- [ ] **Step 1: Write the failing test**

`src/lib/server/media-access.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './db/test-db';
import { albumItems, albums, itemFiles, items, users } from './db/schema';
import { createShare } from './shares';
import { canAccessMedia } from './media-access';
import type { Db } from './db';

let db: Db;
const OWNER_ID = 'u_owner000001';
const sessionUser = { id: OWNER_ID, username: 'gran', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system' } as const;

function locals(user: typeof sessionUser | null, shareTokens: string[] = []): App.Locals {
  return { db, user, shareTokens, platform: undefined as never } as unknown as App.Locals;
}

beforeEach(async () => {
  db = await makeTestDb();
  const now = new Date();
  await db.insert(users).values({ id: OWNER_ID, username: 'gran', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: now });
  await db.insert(items).values([
    { id: 'it_in', type: 'photo', title: null, description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: null, createdAt: now },
    { id: 'it_out', type: 'photo', title: null, description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'b'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: null, createdAt: now },
    { id: 'it_dead', type: 'photo', title: null, description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'c'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: now, createdAt: now }
  ]);
  await db.insert(itemFiles).values([
    { id: 'if_1', itemId: 'it_in', kind: 'thumb_800', storageKey: 'media/it_in/thumb_800.webp', mime: 'image/webp', width: 800, height: 600 },
    { id: 'if_2', itemId: 'it_in', kind: 'original', storageKey: 'media/it_in/original.jpg', mime: 'image/jpeg', width: 4000, height: 3000 },
    { id: 'if_3', itemId: 'it_out', kind: 'thumb_800', storageKey: 'media/it_out/thumb_800.webp', mime: 'image/webp', width: 800, height: 600 },
    { id: 'if_4', itemId: 'it_dead', kind: 'thumb_800', storageKey: 'media/it_dead/thumb_800.webp', mime: 'image/webp', width: 800, height: 600 }
  ]);
  await db.insert(albums).values({ id: 'al_1', title: 'Xmas', description: null, coverItemId: null, createdBy: OWNER_ID, createdAt: now, deletedAt: null });
  await db.insert(albumItems).values({ albumId: 'al_1', itemId: 'it_in', position: 0 });
});

describe('canAccessMedia', () => {
  it('always allows a session user', async () => {
    expect(await canAccessMedia(locals(sessionUser), 'media/it_out/thumb_800.webp')).toBe(true);
  });

  it('denies signed-out with no share cookies', async () => {
    expect(await canAccessMedia(locals(null), 'media/it_in/thumb_800.webp')).toBe(false);
  });

  it('album share grants exactly its album members (originals included)', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID });
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_in/thumb_800.webp')).toBe(true);
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_in/original.jpg')).toBe(true);
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_out/thumb_800.webp')).toBe(false);
  });

  it('item share grants only that item', async () => {
    const s = await createShare(db, { targetType: 'item', targetId: 'it_in', createdBy: OWNER_ID });
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_in/original.jpg')).toBe(true);
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_out/thumb_800.webp')).toBe(false);
  });

  it('denies expired shares, deleted items, forged keys', async () => {
    const expired = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, expiresAt: new Date('2000-01-01') });
    expect(await canAccessMedia(locals(null, [expired.token]), 'media/it_in/thumb_800.webp')).toBe(false);
    const dead = await createShare(db, { targetType: 'item', targetId: 'it_dead', createdBy: OWNER_ID });
    expect(await canAccessMedia(locals(null, [dead.token]), 'media/it_dead/thumb_800.webp')).toBe(false);
    const s = await createShare(db, { targetType: 'item', targetId: 'it_in', createdBy: OWNER_ID });
    expect(await canAccessMedia(locals(null, [s.token]), 'media/it_in/not_a_real_file.bin')).toBe(false);
    expect(await canAccessMedia(locals(null, [s.token]), 'not-media/it_in/original.jpg')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/media-access.test.ts`
Expected: FAIL — the phase-02 stub returns `!!locals.user`, so the album-share and item-share tests fail (`expected false to be true`). (If the file does not exist yet, FAIL is "Cannot find module './media-access'.")

- [ ] **Step 3: Write the implementation**

`src/lib/server/media-access.ts` (complete file — replaces the stub):

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { albumItems, itemFiles, items, shares } from './db/schema';

/** Contract 7 storage keys: media/<itemId>/<kind>.<ext> */
const KEY_RE = /^media\/([A-Za-z0-9_-]+)\//;

/**
 * Authorization for the /media/[...key] route (seam created in phase 02).
 * - Any session user may fetch any media (spec §3: role user+ views everything;
 *   originals are the archival copies and stream for playback).
 * - Signed-out requests are granted only when a verified share cookie
 *   (locals.shareTokens, populated by hooks.server.ts) targets the item that
 *   owns the storage key: the item itself, or an album containing it.
 */
export async function canAccessMedia(locals: App.Locals, key: string): Promise<boolean> {
  if (locals.user) return true;

  const tokens = locals.shareTokens ?? [];
  if (tokens.length === 0) return false;

  const match = KEY_RE.exec(key);
  if (!match) return false;
  const itemId = match[1];

  // The key must be a real file of a live item. Parsing the itemId from the
  // media/<itemId>/ prefix lets us hit the item_files_item index instead of
  // scanning storage_key.
  const owned = await locals.db
    .select({ id: itemFiles.id })
    .from(itemFiles)
    .innerJoin(items, eq(items.id, itemFiles.itemId))
    .where(and(eq(itemFiles.itemId, itemId), eq(itemFiles.storageKey, key), isNull(items.deletedAt)))
    .limit(1);
  if (owned.length === 0) return false;

  const now = Date.now();
  for (const token of tokens) {
    const rows = await locals.db.select().from(shares).where(eq(shares.token, token)).limit(1);
    const share = rows[0];
    if (!share) continue;
    if (share.expiresAt && share.expiresAt.getTime() <= now) continue;
    if (share.targetType === 'item') {
      if (share.targetId === itemId) return true;
      continue;
    }
    const member = await locals.db
      .select({ itemId: albumItems.itemId })
      .from(albumItems)
      .where(and(eq(albumItems.albumId, share.targetId), eq(albumItems.itemId, itemId)))
      .limit(1);
    if (member.length > 0) return true;
  }
  return false;
}
```

Modify `src/app.d.ts` — inside the existing `App.Locals` interface (which already has `user`, `platform`, `db` per Contract 2), add one line:

```ts
      /** Verified sb_share_* cookie tokens for this request (phase 08). */
      shareTokens: string[];
```

Modify `src/hooks.server.ts` — in the main `handle` hook, immediately after `event.locals.user` is assigned (keep every existing line; this is an insertion), add:

```ts
// Verified share cookies → locals.shareTokens (phase 08).
// Name sb_share_<token>, value = sha256(token); mismatches are ignored.
const shareTokens: string[] = [];
for (const { name, value } of event.cookies.getAll()) {
  if (!name.startsWith(SHARE_COOKIE_PREFIX)) continue;
  const token = name.slice(SHARE_COOKIE_PREFIX.length);
  if (value === (await shareCookieValue(token))) shareTokens.push(token);
}
event.locals.shareTokens = shareTokens;
```

with the import added at the top of `src/hooks.server.ts`:

```ts
import { SHARE_COOKIE_PREFIX, shareCookieValue } from '$lib/server/shares';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/media-access.test.ts && pnpm check`
Expected: PASS — 5 tests; typecheck clean (every place that builds `App.Locals` in tests now includes `shareTokens`; fix any phase-01/02 test fixtures the compiler flags by adding `shareTokens: []`).

- [ ] **Step 5: Commit**

```bash
git add src/app.d.ts src/hooks.server.ts src/lib/server/media-access.ts src/lib/server/media-access.test.ts
git commit -m "feat: share-cookie media authorization via canAccessMedia"
```

---
### Task 4: `/share/[token]` — resolve, password gate, expired page

**Files:**
- Create: `src/routes/share/[token]/+page.server.ts`
- Create: `src/routes/share/[token]/+page.svelte` (gate + expired + interim ok-state; Tasks 5–6 replace the ok-state branch with the real rooms)
- Modify: `src/routes/+layout.svelte` (never render Nav on `/share` routes)
- Test: `src/routes/share/[token]/page.server.test.ts`

**Interfaces:**
- Consumes: Task 1 (`resolveShare`, `getShareByToken`, cookie helpers); assumed `getItemDTO` / `listAlbumItemDTOs` from `$lib/server/items`; `albums` table.
- Produces: `load` returning the discriminated `SharePageData` used by Tasks 5–6:

```ts
type SharePageData =
  | { state: 'password'; error?: string }
  | { state: 'expired' }
  | { state: 'ok'; share: { token: string; targetType: 'album' | 'item'; allowDownload: boolean };
      album: { id: string; title: string; description: string | null } | null;
      items: ItemDTO[] };  // single-item shares: items has exactly one entry, album is null
```
  and a default form action `?/unlock` (POST `password`).

- [ ] **Step 1: Write the failing test**

`src/routes/share/[token]/page.server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { makeTestDb } from '$lib/server/db/test-db';
import { albumItems, albums, itemFiles, items, users } from '$lib/server/db/schema';
import { createShare, _resetShareRateLimits, SHARE_COOKIE_MAX_AGE } from '$lib/server/shares';
import type { Db } from '$lib/server/db';
import { load, actions } from './+page.server';

let db: Db;
const OWNER_ID = 'u_owner000001';

const fakeStorage = {
  put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: vi.fn(),
  mediaUrl: vi.fn(async (key: string) => `/media/${key}`)
};

function baseEvent(token: string, shareTokens: string[] = []) {
  const cookies = { set: vi.fn(), get: vi.fn(), getAll: vi.fn(() => []), delete: vi.fn(), serialize: vi.fn() };
  return {
    params: { token },
    locals: {
      db, user: null, shareTokens,
      platform: { name: 'node', storage: fakeStorage, queue: { enqueue: vi.fn() }, features: { ingestion: true, faces: false, serverDerivatives: true } }
    },
    cookies,
    url: new URL(`http://localhost/share/${token}`)
  } as never;
}

beforeEach(async () => {
  db = await makeTestDb();
  _resetShareRateLimits();
  const now = new Date();
  await db.insert(users).values({ id: OWNER_ID, username: 'gran', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: now });
  await db.insert(items).values({ id: 'it_1', type: 'photo', title: 'Porch', description: null, dateStart: '1994-06-14', dateEnd: '1994-06-14', datePrecision: 'day', sortDate: '1994-06-14', duration: null, width: 800, height: 600, sizeBytes: 1, sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: null, createdAt: now });
  await db.insert(itemFiles).values({ id: 'if_1', itemId: 'it_1', kind: 'thumb_800', storageKey: 'media/it_1/thumb_800.webp', mime: 'image/webp', width: 800, height: 600 });
  await db.insert(albums).values({ id: 'al_1', title: 'Summer 94', description: 'Porch days', coverItemId: null, createdBy: OWNER_ID, createdAt: now, deletedAt: null });
  await db.insert(albumItems).values({ albumId: 'al_1', itemId: 'it_1', position: 0 });
});

describe('load', () => {
  it('404s an unknown token', async () => {
    try { await load(baseEvent('missing-token-abcdefghijk')); expect.unreachable(); }
    catch (e) { expect(isHttpError(e) && e.status === 404).toBe(true); }
  });

  it('returns expired state', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, expiresAt: new Date('2000-01-01') });
    expect(await load(baseEvent(s.token))).toEqual({ state: 'expired' });
  });

  it('returns password state without a valid cookie', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, password: 'pw' });
    expect(await load(baseEvent(s.token))).toEqual({ state: 'password' });
  });

  it('serves album content when the cookie token is present, and refreshes the cookie', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, password: 'pw' });
    const ev = baseEvent(s.token, [s.token]);
    const data = await load(ev);
    expect(data.state).toBe('ok');
    if (data.state === 'ok') {
      expect(data.album?.title).toBe('Summer 94');
      expect(data.items).toHaveLength(1);
      expect(data.share.allowDownload).toBe(false);
    }
    expect((ev as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies.set).toHaveBeenCalledWith(
      `sb_share_${s.token}`, expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', maxAge: SHARE_COOKIE_MAX_AGE })
    );
  });

  it('serves passwordless shares immediately and sets the cookie', async () => {
    const s = await createShare(db, { targetType: 'item', targetId: 'it_1', createdBy: OWNER_ID });
    const ev = baseEvent(s.token);
    const data = await load(ev);
    expect(data.state).toBe('ok');
    if (data.state === 'ok') {
      expect(data.album).toBeNull();
      expect(data.items[0].id).toBe('it_1');
    }
    expect((ev as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies.set).toHaveBeenCalled();
  });
});

describe('unlock action', () => {
  function actionEvent(token: string, password: string) {
    const ev = baseEvent(token) as { request?: Request };
    const form = new URLSearchParams({ password });
    ev.request = new Request(`http://localhost/share/${token}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form
    });
    return ev as never;
  }

  it('sets the cookie and redirects on the right password', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, password: 'cranberry' });
    try { await actions.unlock(actionEvent(s.token, 'cranberry')); expect.unreachable(); }
    catch (e) { expect(isRedirect(e) && e.status === 303 && e.location === `/share/${s.token}`).toBe(true); }
  });

  it('fails 400 on a wrong password and 429 when rate limited', async () => {
    const s = await createShare(db, { targetType: 'album', targetId: 'al_1', createdBy: OWNER_ID, password: 'cranberry' });
    for (let i = 0; i < 5; i++) {
      const r = await actions.unlock(actionEvent(s.token, 'nope'));
      expect(r.status).toBe(400);
    }
    const limited = await actions.unlock(actionEvent(s.token, 'nope'));
    expect(limited.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/share/[token]/page.server.test.ts`
Expected: FAIL — `Cannot find module './+page.server'`.

- [ ] **Step 3: Write the server implementation**

`src/routes/share/[token]/+page.server.ts` (complete file):

```ts
import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { albums } from '$lib/server/db/schema';
import {
  getShareByToken, resolveShare, shareCookieValue,
  SHARE_COOKIE_MAX_AGE, SHARE_COOKIE_PREFIX
} from '$lib/server/shares';
import { getItemDTO, listAlbumItemDTOs } from '$lib/server/items';
import type { Cookies } from '@sveltejs/kit';

async function setShareCookie(cookies: Cookies, token: string, secure: boolean): Promise<void> {
  cookies.set(SHARE_COOKIE_PREFIX + token, await shareCookieValue(token), {
    path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SHARE_COOKIE_MAX_AGE
  });
}

export const load: PageServerLoad = async ({ locals, params, cookies, url }) => {
  const token = params.token;
  const share = await getShareByToken(locals.db, token);
  if (!share) throw error(404, 'This share link does not exist.');
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return { state: 'expired' as const };

  const authorized = !share.hasPassword || (locals.shareTokens ?? []).includes(token);
  if (!authorized) return { state: 'password' as const };

  // Keep the 24 h media-authorization cookie fresh on every visit.
  await setShareCookie(cookies, token, url.protocol === 'https:');

  const storage = locals.platform.storage;
  if (share.targetType === 'album') {
    const rows = await locals.db.select().from(albums)
      .where(and(eq(albums.id, share.targetId), isNull(albums.deletedAt))).limit(1);
    const album = rows[0];
    if (!album) throw error(404, 'This album is no longer available.');
    const items = await listAlbumItemDTOs(locals.db, storage, album.id);
    return {
      state: 'ok' as const,
      share: { token, targetType: 'album' as const, allowDownload: share.allowDownload },
      album: { id: album.id, title: album.title, description: album.description },
      items
    };
  }

  const item = await getItemDTO(locals.db, storage, share.targetId);
  if (!item) throw error(404, 'This memory is no longer available.');
  return {
    state: 'ok' as const,
    share: { token, targetType: 'item' as const, allowDownload: share.allowDownload },
    album: null,
    items: [item]
  };
};

export const actions: Actions = {
  unlock: async ({ locals, params, request, cookies, url }) => {
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    const res = await resolveShare(locals.db, params.token, password);
    if (res.ok) {
      await setShareCookie(cookies, params.token, url.protocol === 'https:');
      throw redirect(303, `/share/${params.token}`);
    }
    switch (res.reason) {
      case 'rate_limited':
        return fail(429, { message: 'Too many tries. Wait a minute, then try again.' });
      case 'wrong_password':
        return fail(400, { message: 'That password is not right.' });
      case 'password_required':
        return fail(400, { message: 'Enter the password.' });
      case 'expired':
        throw redirect(303, `/share/${params.token}`);
      default:
        throw error(404, 'This share link does not exist.');
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/routes/share/[token]/page.server.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Write the gate page**

`src/routes/share/[token]/+page.svelte` (complete file — the `ok` branch is intentionally minimal until Tasks 5–6):

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import { CREAM, FONT, GRAIN_URI, INK, paletteFor } from '$lib/ui/tokens';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // A fixed warm room for the gate/expired pages ('70s Yamabuki reads as
  // "family archive" without knowing the content's decade).
  const palette = paletteFor(1975);
  const room =
    `background:` +
    `radial-gradient(${palette.pools[0].size} at ${palette.pools[0].pos}, ${palette.pools[0].color}, transparent),` +
    `linear-gradient(160deg, ${palette.stops[0]}, ${palette.stops[1]} 55%, ${palette.stops[2]})`;
</script>

{#if data.state === 'password'}
  <main class="room" style={`${room}; --ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}>
    <div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
    <section class="gate">
      <p class="eyebrow">A shared memory from Shoebox</p>
      <h1>This memory is protected</h1>
      <form method="POST" action="?/unlock" use:enhance>
        <label for="share-password">Password</label>
        <input id="share-password" name="password" type="password" autocomplete="off" required />
        {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
        <button type="submit">Open</button>
      </form>
    </section>
    <footer class="wordmark">SHOEBOX</footer>
  </main>
{:else if data.state === 'expired'}
  <main class="room" style={`${room}; --ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}>
    <div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
    <section class="gate">
      <p class="eyebrow">A shared memory from Shoebox</p>
      <h1>This share link has expired</h1>
      <p class="sub">Ask whoever sent it for a fresh link.</p>
    </section>
    <footer class="wordmark">SHOEBOX</footer>
  </main>
{:else}
  <!-- Replaced by ShareRoom + ShareGallery/ShareViewer in Tasks 5–6 -->
  <main class="room" style={`${room}; --ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}>
    <section class="gate"><h1>{data.album ? data.album.title : (data.items[0].title ?? 'A memory')}</h1></section>
    <footer class="wordmark">SHOEBOX</footer>
  </main>
{/if}

<style>
  .room { position: relative; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .grain { position: absolute; inset: 0; mix-blend-mode: overlay; opacity: 0.5; pointer-events: none; }
  .gate { position: relative; width: min(440px, 100%); color: var(--ink); }
  .eyebrow { font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; opacity: var(--chrome-opacity, 0.5); margin: 0 0 12px; }
  h1 { font-family: var(--serif); font-weight: 500; font-size: 34px; line-height: 1.15; margin: 0 0 24px; }
  .sub { font-family: var(--serif); font-size: 18px; margin: 0; }
  label { display: block; font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 8px; }
  input { display: block; width: 100%; min-height: 48px; padding: 12px 14px; border: none; background: var(--cream); color: var(--ink); font-family: var(--serif); font-size: 18px; }
  input:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
  .error { font-family: var(--sans); font-size: 14px; margin: 10px 0 0; color: var(--ink); font-weight: 700; }
  button { margin-top: 16px; min-height: 48px; min-width: 120px; padding: 12px 22px; border: none; background: var(--ink); color: var(--cream); font-family: var(--sans); font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
  button:focus-visible { outline: 3px solid var(--cream); outline-offset: 2px; }
  .wordmark { position: relative; margin-top: auto; padding: 24px 0 8px; font-family: var(--sans); font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); opacity: var(--chrome-opacity, 0.5); }
</style>
```

Modify `src/routes/+layout.svelte` — the share surface must be stripped even for signed-in visitors. Wrap the existing `<Nav …/>` render (keep all its props exactly as they are) in:

```svelte
<script>
  // add to the existing script block:
  import { page } from '$app/state';
  const isShareRoute = $derived(page.route.id?.startsWith('/share/') ?? false);
</script>

{#if !isShareRoute}
  <Nav ... />   <!-- the existing Nav line, unchanged -->
{/if}
```

- [ ] **Step 6: Verify by hand and commit**

Run: `pnpm check && pnpm vitest run src/routes/share`
Expected: PASS. Then `pnpm dev`, create a password share via `curl -X POST localhost:5173/api/shares` while signed in (or via the phase e2e later) and confirm the gate renders in a private window with no nav.

```bash
git add src/routes/share src/routes/+layout.svelte
git commit -m "feat: /share/[token] resolve, password gate, expired page"
```

---

### Task 5: Share UI kit — `ShareRoom`, `ShareGallery`, `ShareViewer` + album share page

**Files:**
- Create: `src/lib/ui/share/ShareRoom.svelte`
- Create: `src/lib/ui/share/ShareGallery.svelte`
- Create: `src/lib/ui/share/ShareViewer.svelte`
- Modify: `src/routes/share/[token]/+page.svelte` (album branch of the ok-state)

**Interfaces:**
- Consumes: `SharePageData` from Task 4; `ItemDTO` (Contract 6: `urls.{poster,thumb400,thumb800,thumb1600,original?}`, `displayDate`, `shortDate`, `duration`, `type`); tokens `INK, CREAM, DAWN, FONT, GRAIN_URI, paletteFor, playerRoomFor, MOTION`.
- Produces component props (Task 6 + e2e rely on them):
  - `ShareRoom`: `{ stops: [string, string, string]; children: Snippet }` — full-page gradient + grain + `SHOEBOX` wordmark footer (`data-testid="share-wordmark"`).
  - `ShareGallery`: `{ items: ItemDTO[]; onOpen: (index: number) => void }`.
  - `ShareViewer`: `{ items: ItemDTO[]; index: number; allowDownload: boolean; single?: boolean; onClose?: () => void; onNavigate?: (index: number) => void }` — download link has `data-testid="share-download"`.

These are deliberately share-only components: the public surface must have zero nav/comments/edit affordances, so we do not reuse `Player.svelte`/`MasonryGrid.svelte` (which carry those). Decision recorded under Ambiguities.

- [ ] **Step 1: Write `ShareRoom.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CREAM, FONT, GRAIN_URI, INK } from '$lib/ui/tokens';

  let { stops, children }: { stops: [string, string, string]; children: Snippet } = $props();
</script>

<div
  class="share-room"
  style={`background:linear-gradient(165deg, ${stops[0]}, ${stops[1]} 55%, ${stops[2]});` +
    `--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
>
  <div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>
  <div class="content">
    {@render children()}
  </div>
  <footer class="wordmark" data-testid="share-wordmark">SHOEBOX</footer>
</div>

<style>
  .share-room { position: relative; min-height: 100vh; display: flex; flex-direction: column; }
  .grain { position: absolute; inset: 0; mix-blend-mode: overlay; opacity: 0.5; pointer-events: none; }
  .content { position: relative; flex: 1; width: min(1200px, 100%); margin: 0 auto; padding: 40px 24px 24px; }
  .wordmark { position: relative; text-align: center; padding: 32px 0 16px; font-family: var(--sans); font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--cream); opacity: var(--chrome-opacity, 0.5); }
</style>
```

- [ ] **Step 2: Write `ShareGallery.svelte`**

CSS-columns masonry (read-only; card = one button, whole card opens the viewer — tap = open, no hover-only behavior):

```svelte
<script lang="ts">
  import type { ItemDTO } from '$lib/server/items';

  let { items, onOpen }: { items: ItemDTO[]; onOpen: (index: number) => void } = $props();

  function mmss(seconds: number | null | undefined): string {
    if (seconds == null) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

<div class="gallery">
  {#each items as item, i (item.id)}
    <button class="card" onclick={() => onOpen(i)} aria-label={`Open ${item.title ?? item.displayDate}`}>
      <span class="frame">
        <img src={item.type === 'video' ? item.urls.poster : item.urls.thumb800} alt={item.title ?? item.displayDate} loading="lazy" />
        {#if item.type === 'video' && item.duration != null}
          <span class="duration">{mmss(item.duration)}</span>
        {/if}
      </span>
      <span class="caption">
        <span class="date">{item.shortDate}</span>
        {#if item.title}<span class="title">{item.title}</span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .gallery { columns: 3 280px; column-gap: 18px; }
  .card { display: block; width: 100%; break-inside: avoid; margin: 0 0 18px; padding: 0; border: none; background: none; text-align: left; cursor: pointer; }
  .card:focus-visible { outline: 3px solid var(--cream); outline-offset: 3px; }
  .frame { position: relative; display: block; }
  img { display: block; width: 100%; height: auto; }
  .duration { position: absolute; right: 6px; bottom: 6px; font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 5px; background: var(--ink); color: var(--cream); }
  .caption { display: flex; gap: 10px; justify-content: space-between; padding-top: 7px; font-family: var(--sans); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cream); opacity: var(--chrome-opacity, 0.5); }
</style>
```

- [ ] **Step 3: Write `ShareViewer.svelte`**

The share player/lightbox room: deep-end decade gradient, custom typographic controls (no icon kits, no comments, no edit affordances), prev/next, keyboard, gated download link.

```svelte
<script lang="ts">
  import { CREAM, DAWN, FONT, GRAIN_URI, INK, playerRoomFor } from '$lib/ui/tokens';
  import type { ItemDTO } from '$lib/server/items';

  let {
    items, index, allowDownload, single = false, onClose, onNavigate
  }: {
    items: ItemDTO[]; index: number; allowDownload: boolean;
    single?: boolean; onClose?: () => void; onNavigate?: (index: number) => void;
  } = $props();

  const item = $derived(items[index]);
  const year = $derived(item.date.dateStart ? Number(item.date.dateStart.slice(0, 4)) : 1990);
  const room = $derived(playerRoomFor(year));

  let video: HTMLVideoElement | undefined = $state();
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);

  function toggle() {
    if (!video) return;
    if (video.paused) void video.play(); else video.pause();
  }
  function seek(e: Event) {
    if (video) video.currentTime = Number((e.currentTarget as HTMLInputElement).value);
  }
  function mmss(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  function prev() { if (!single && index > 0) onNavigate?.(index - 1); }
  function next() { if (!single && index < items.length - 1) onNavigate?.(index + 1); }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !single) { e.preventDefault(); onClose?.(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === ' ' && item.type === 'video') { e.preventDefault(); toggle(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<section
  class="viewer" class:overlay={!single} role={single ? undefined : 'dialog'} aria-modal={single ? undefined : 'true'}
  aria-label={item.title ?? item.displayDate}
  style={`background:radial-gradient(90% 70% at 85% 0%, ${room.pool}, transparent),` +
    `linear-gradient(160deg, ${room.stops[0]}, ${room.stops[1]} 60%, ${room.stops[2]});` +
    `--ink:${INK}; --cream:${CREAM}; --dawn:${DAWN}; --serif:${FONT.serif}; --sans:${FONT.sans};`}
>
  <div class="grain" style={`background-image:url("${GRAIN_URI}")`}></div>

  <header class="bar">
    <span class="eyebrow">{item.displayDate}</span>
    <h1>{item.title ?? 'A memory'}</h1>
    {#if !single}
      <button class="close" onclick={() => onClose?.()}>✕ Close</button>
    {:else}
      <span></span>
    {/if}
  </header>

  <div class="stage">
    {#if !single}
      <button class="arrow" onclick={prev} disabled={index === 0} aria-label="Previous">←</button>
    {/if}
    <div class="media">
      {#if item.type === 'video'}
        <video
          bind:this={video} src={item.urls.original} poster={item.urls.poster} playsinline
          onplay={() => (playing = true)} onpause={() => (playing = false)}
          ontimeupdate={() => (time = video?.currentTime ?? 0)}
          ondurationchange={() => (duration = video?.duration ?? 0)}
          onclick={toggle}
        ></video>
        <div class="controls">
          <button class="play" onclick={toggle}>{playing ? '❚❚' : '▶'}</button>
          <span class="timecode">{mmss(time)} / {mmss(duration)}</span>
          <input class="track" type="range" min="0" max={duration || 0} step="0.01" value={time} oninput={seek} aria-label="Seek" />
        </div>
      {:else}
        <img src={item.urls.thumb1600} alt={item.title ?? item.displayDate} />
      {/if}
      {#if item.description}<p class="story">{item.description}</p>{/if}
      {#if allowDownload && item.urls.original}
        <a class="download" data-testid="share-download" href={item.urls.original} download>Download original</a>
      {/if}
    </div>
    {#if !single}
      <button class="arrow" onclick={next} disabled={index === items.length - 1} aria-label="Next">→</button>
    {/if}
  </div>
</section>

<style>
  .viewer { position: relative; min-height: 100vh; display: flex; flex-direction: column; color: var(--cream); }
  .viewer.overlay { position: fixed; inset: 0; z-index: 40; overflow-y: auto; }
  .grain { position: absolute; inset: 0; mix-blend-mode: overlay; opacity: 0.5; pointer-events: none; }
  .bar { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline; gap: 16px; padding: 22px 28px; }
  .eyebrow { font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; opacity: var(--chrome-opacity, 0.5); }
  h1 { font-family: var(--serif); font-weight: 500; font-size: 22px; margin: 0; text-align: center; }
  .close { justify-self: end; min-height: 48px; padding: 8px 14px; border: none; background: none; color: var(--cream); font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
  .stage { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; gap: 18px; padding: 0 20px 40px; }
  .arrow { min-width: 48px; min-height: 48px; border: none; background: none; color: var(--cream); font-size: 28px; cursor: pointer; }
  .arrow:disabled { opacity: 0.25; cursor: default; }
  .arrow:focus-visible, .close:focus-visible, .play:focus-visible, .download:focus-visible { outline: 3px solid var(--cream); outline-offset: 2px; }
  .media { width: min(900px, 100%); }
  video, img { display: block; width: 100%; height: auto; }
  .controls { display: flex; align-items: center; gap: 14px; padding-top: 12px; }
  .play { min-width: 48px; min-height: 48px; border: none; background: none; color: var(--cream); font-size: 18px; cursor: pointer; }
  .timecode { font-family: var(--sans); font-variant-numeric: tabular-nums; font-size: 13px; }
  .track { flex: 1; appearance: none; height: 8px; background: color-mix(in srgb, var(--cream) 25%, transparent); }
  .track::-webkit-slider-thumb { appearance: none; width: 4px; height: 28px; background: var(--cream); }
  .track::-moz-range-thumb { width: 4px; height: 28px; border: none; border-radius: 0; background: var(--cream); }
  .track::-moz-range-progress { background: var(--dawn); height: 8px; }
  .story { font-family: var(--serif); font-size: 18px; line-height: 1.5; margin: 18px 0 0; }
  .download { display: inline-block; margin-top: 18px; min-height: 48px; line-height: 48px; padding: 0 18px; background: var(--cream); color: var(--ink); font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; }
</style>
```

- [ ] **Step 4: Wire the album branch of `/share/[token]/+page.svelte`**

Replace the `{:else}` interim branch from Task 4 with (the `password`/`expired` branches stay exactly as written in Task 4):

```svelte
{:else if data.share.targetType === 'album'}
  <ShareRoom stops={paletteFor(albumYear).stops}>
    <header class="album-head">
      <p class="eyebrow">A shared album</p>
      <h1>{data.album?.title}</h1>
      {#if data.album?.description}<p class="desc">{data.album.description}</p>{/if}
    </header>
    <ShareGallery items={data.items} onOpen={(i) => (viewerIndex = i)} />
  </ShareRoom>
  {#if viewerIndex !== null}
    <ShareViewer
      items={data.items} index={viewerIndex} allowDownload={data.share.allowDownload}
      onClose={() => (viewerIndex = null)} onNavigate={(i) => (viewerIndex = i)}
    />
  {/if}
{:else}
  <!-- single-item share: Task 6 -->
{/if}
```

with these additions to the page's script block and styles:

```svelte
<script lang="ts">
  // add to existing imports from Task 4:
  import ShareRoom from '$lib/ui/share/ShareRoom.svelte';
  import ShareGallery from '$lib/ui/share/ShareGallery.svelte';
  import ShareViewer from '$lib/ui/share/ShareViewer.svelte';

  let viewerIndex: number | null = $state(null);

  const albumYear = $derived(
    data.state === 'ok' && data.items[0]?.date.dateStart
      ? Number(data.items[0].date.dateStart.slice(0, 4))
      : 1975
  );
</script>

<style>
  /* add alongside Task 4 styles */
  .album-head { color: var(--cream); margin-bottom: 28px; }
  .album-head h1 { font-family: var(--serif); font-weight: 500; font-size: 44px; margin: 0; color: var(--cream); }
  .desc { font-family: var(--serif); font-size: 18px; margin: 10px 0 0; }
</style>
```

Note: `paletteFor` and `INK/CREAM` imports already exist from Task 4.

- [ ] **Step 5: Verify and commit**

Run: `pnpm check && pnpm vitest run src/routes/share src/lib/server/shares.test.ts`
Expected: PASS (no regressions; the Task 4 server tests still pass — the load contract did not change).

Manual: `pnpm dev`, open an album share link in a private window — masonry renders, a card click opens the viewer, no nav anywhere, wordmark footer present.

```bash
git add src/lib/ui/share src/routes/share/[token]/+page.svelte
git commit -m "feat: public share room, gallery and viewer for album shares"
```

---

### Task 6: Single-item share room

**Files:**
- Modify: `src/routes/share/[token]/+page.svelte` (item branch)

**Interfaces:**
- Consumes: Task 5 components; `SharePageData` (`targetType === 'item'` ⇒ `items` has exactly one entry).
- Produces: the final `/share/[token]` page — all four states rendered.

- [ ] **Step 1: Fill the item branch**

Replace the `{:else}` + `<!-- single-item share: Task 6 -->` comment from Task 5 with:

```svelte
{:else}
  <ShareViewer items={data.items} index={0} allowDownload={data.share.allowDownload} single />
  <footer class="item-wordmark" data-testid="share-wordmark">SHOEBOX</footer>
{/if}
```

and add to the style block:

```svelte
  .item-wordmark { position: fixed; left: 0; right: 0; bottom: 0; text-align: center; padding: 12px 0; font-family: var(--sans); font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--cream); opacity: var(--chrome-opacity, 0.5); pointer-events: none; }
```

(`single` mode renders the viewer as an in-flow full-height room: no close button, no prev/next arrows, `role="dialog"` omitted — see `ShareViewer.svelte`.)

- [ ] **Step 2: Verify and commit**

Run: `pnpm check && pnpm vitest run src/routes/share`
Expected: PASS.

Manual: create an item share for a video; the private-window page shows the player room, spacebar toggles playback, "Download original" appears only when the share was created with `allowDownload: true`.

```bash
git add src/routes/share/[token]/+page.svelte
git commit -m "feat: single-item public share room"
```

---

### Task 7: Share management dialog + authenticated "Download original"

**Files:**
- Create: `src/lib/ui/ShareDialog.svelte`
- Modify: `src/routes/albums/[id]/+page.svelte` (share button, editor+)
- Modify: `src/routes/item/[id]/+page.svelte` (share button editor+, download link user+)

**Interfaces:**
- Consumes: `/api/shares` (Task 2); `ShareRecord` type from Task 1 (client-side via `import type`); the signed-in user from page data (`data.user: SessionUser` — provided by the root layout since phase 01).
- Produces: `ShareDialog` props `{ targetType: 'album' | 'item'; targetId: string; open: boolean; onClose: () => void }`. Buttons rendered with `data-testid="share-button"`; created-link input with `data-testid="share-link"`.

- [ ] **Step 1: Write `ShareDialog.svelte`**

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { CREAM, FONT, INK } from '$lib/ui/tokens';
  import type { ShareRecord } from '$lib/server/shares';

  let { targetType, targetId, open, onClose }:
    { targetType: 'album' | 'item'; targetId: string; open: boolean; onClose: () => void } = $props();

  let shares: ShareRecord[] = $state([]);
  let usePassword = $state(false);
  let password = $state('');
  let expiry = $state<'never' | '7d' | '30d' | 'custom'>('never');
  let customDate = $state('');
  let allowDownload = $state(false);
  let busy = $state(false);
  let createdUrl: string | null = $state(null);
  let copied = $state('');

  async function refresh() {
    const res = await fetch(`/api/shares?targetType=${targetType}&targetId=${targetId}`);
    if (res.ok) shares = (await res.json()).shares;
  }
  $effect(() => { if (open) void refresh(); });

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType, targetId,
          password: usePassword ? password : undefined,
          expiry: expiry === 'custom' ? customDate : expiry,
          allowDownload
        })
      });
      if (res.ok) {
        const body = await res.json();
        createdUrl = new URL(body.url, location.origin).href;
        password = ''; usePassword = false;
        await refresh();
      }
    } finally { busy = false; }
  }

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    copied = id;
    setTimeout(() => (copied = ''), 1500);
  }

  async function revoke(id: string) {
    await fetch(`/api/shares/${id}`, { method: 'DELETE' });
    await refresh();
    await invalidateAll();
  }
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={onClose}></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Share"
    style={`--ink:${INK}; --cream:${CREAM}; --serif:${FONT.serif}; --sans:${FONT.sans};`}>
    <header>
      <h2>Share this {targetType}</h2>
      <button class="close" onclick={onClose}>✕ Close</button>
    </header>

    <form onsubmit={create}>
      <label class="row">
        <input type="checkbox" bind:checked={usePassword} /> Require a password
      </label>
      {#if usePassword}
        <input class="text" type="text" bind:value={password} placeholder="Password" autocomplete="off" required />
      {/if}
      <label class="stack">Expires
        <select bind:value={expiry}>
          <option value="never">Never</option>
          <option value="7d">In 7 days</option>
          <option value="30d">In 30 days</option>
          <option value="custom">On a date…</option>
        </select>
      </label>
      {#if expiry === 'custom'}
        <input class="text" type="date" bind:value={customDate} required />
      {/if}
      <label class="row">
        <input type="checkbox" bind:checked={allowDownload} /> Allow downloading originals
      </label>
      <button class="primary" type="submit" disabled={busy}>Create share link</button>
    </form>

    {#if createdUrl}
      <div class="created">
        <input class="text" data-testid="share-link" readonly value={createdUrl} onfocus={(e) => e.currentTarget.select()} />
        <button onclick={() => copy(createdUrl ?? '', 'new')}>{copied === 'new' ? 'Copied' : 'Copy link'}</button>
      </div>
    {/if}

    {#if shares.length > 0}
      <h3>Existing links</h3>
      <ul>
        {#each shares as s (s.id)}
          <li>
            <span class="meta">
              {s.hasPassword ? 'Password' : 'Open'} ·
              {s.expiresAt ? `expires ${new Date(s.expiresAt).toLocaleDateString()}` : 'never expires'} ·
              {s.allowDownload ? 'downloads on' : 'view only'}
            </span>
            <span class="actions">
              <button onclick={() => copy(new URL(`/share/${s.token}`, location.origin).href, s.id)}>
                {copied === s.id ? 'Copied' : 'Copy link'}
              </button>
              <button onclick={() => revoke(s.id)}>Revoke</button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: color-mix(in srgb, var(--ink, #000) 60%, transparent); }
  .dialog { position: fixed; z-index: 51; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 32px)); max-height: 85vh; overflow-y: auto; background: var(--cream); color: var(--ink); padding: 24px; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
  h2 { font-family: var(--serif); font-weight: 500; font-size: 24px; margin: 0; }
  h3 { font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; margin: 22px 0 8px; }
  .close, button { min-height: 48px; border: none; cursor: pointer; font-family: var(--sans); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; background: none; color: var(--ink); }
  .primary { background: var(--ink); color: var(--cream); padding: 0 20px; margin-top: 14px; }
  form { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: center; gap: 10px; min-height: 48px; font-family: var(--sans); font-size: 14px; }
  .row input[type='checkbox'] { width: 22px; height: 22px; }
  .stack { display: flex; flex-direction: column; gap: 6px; font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
  select, .text { min-height: 48px; border: none; background: color-mix(in srgb, var(--ink) 8%, var(--cream)); color: var(--ink); font-family: var(--serif); font-size: 16px; padding: 0 12px; }
  .created { display: flex; gap: 8px; margin-top: 14px; }
  .created .text { flex: 1; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 48px; }
  .meta { font-family: var(--serif); font-size: 15px; }
  .actions { display: flex; gap: 4px; }
  :is(button, select, input):focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
</style>
```

- [ ] **Step 2: Mount on the album page**

Modify `src/routes/albums/[id]/+page.svelte` (phase 05 file). In its script block add:

```svelte
import ShareDialog from '$lib/ui/ShareDialog.svelte';
let shareOpen = $state(false);
const canShare = $derived(!!data.user && ['editor', 'admin', 'owner'].includes(data.user.role));
```

In the album header's action area (next to the existing edit affordances — if the header has no action row, add a `<div class="actions">` after the title), add:

```svelte
{#if canShare}
  <button data-testid="share-button" onclick={() => (shareOpen = true)}>Share</button>
  <ShareDialog targetType="album" targetId={data.album.id} open={shareOpen} onClose={() => (shareOpen = false)} />
{/if}
```

(The button inherits the page's existing action-button styling; if none exists, style it as the sans uppercase text button pattern used in `ShareDialog`.) `data.album.id` is the phase-05 album page's own load data — keep whatever property name it actually uses.

- [ ] **Step 3: Mount on the item room + authenticated download**

Modify `src/routes/item/[id]/+page.svelte` (phase 04 file). Script block additions:

```svelte
import ShareDialog from '$lib/ui/ShareDialog.svelte';
let shareOpen = $state(false);
const canShare = $derived(!!data.user && ['editor', 'admin', 'owner'].includes(data.user.role));
```

In the right rail, below the provenance/date block (any signed-in user is role user+ — spec §3/§14: originals are the archival copies):

```svelte
{#if data.item.urls.original}
  <a class="download-original" data-testid="download-original" href={data.item.urls.original} download>
    Download original
  </a>
{/if}
{#if canShare}
  <button data-testid="share-button" onclick={() => (shareOpen = true)}>Share</button>
  <ShareDialog targetType="item" targetId={data.item.id} open={shareOpen} onClose={() => (shareOpen = false)} />
{/if}
```

with rail styling (add to the page's style block, colors via the page's existing token vars):

```svelte
.download-original { display: inline-block; min-height: 48px; line-height: 48px; font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cream); text-decoration: none; }
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm check`
Expected: clean.

Manual: as owner, album page and item room show **Share**; dialog creates a link with password toggle / expiry picker (never/7d/30d/custom) / download toggle, lists it, copies it, revokes it. As a `user`-role account, no Share button, but **Download original** is present in the item room.

```bash
git add src/lib/ui/ShareDialog.svelte src/routes/albums/[id]/+page.svelte src/routes/item/[id]/+page.svelte
git commit -m "feat: share management dialog and authenticated original download"
```

---
### Task 8: Admin shell — guard, layout, section nav

**Files:**
- Create: `src/routes/admin/+layout.server.ts`
- Create: `src/routes/admin/+layout.svelte`
- Create: `src/routes/admin/+page.server.ts`
- Test: `src/routes/admin/layout.server.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Contract 3).
- Produces: every `/admin/*` page runs behind `requireRole(locals, 'admin')`; layout data `{ user: SessionUser }`; `/admin` redirects to `/admin/users`.

- [ ] **Step 1: Write the failing test**

`src/routes/admin/layout.server.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { load } from './+layout.server';
import { load as indexLoad } from './+page.server';

const admin = { id: 'u_admin0000001', username: 'ada', role: 'admin', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system' } as const;
const editor = { ...admin, role: 'editor' } as const;

function ev(user: typeof admin | null) {
  return { locals: { user, db: undefined as never, platform: undefined as never, shareTokens: [] } } as never;
}

describe('/admin guard', () => {
  it('403s editors', async () => {
    try { await load(ev(editor)); expect.unreachable(); }
    catch (e) { expect(isHttpError(e) && e.status === 403).toBe(true); }
  });
  it('401s signed-out', async () => {
    try { await load(ev(null)); expect.unreachable(); }
    catch (e) { expect(isHttpError(e) && e.status === 401).toBe(true); }
  });
  it('passes admins through with user data', async () => {
    expect(await load(ev(admin))).toEqual({ user: admin });
  });
  it('/admin redirects to /admin/users', async () => {
    try { await indexLoad(ev(admin)); expect.unreachable(); }
    catch (e) { expect(isRedirect(e) && e.location === '/admin/users').toBe(true); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/admin/layout.server.test.ts`
Expected: FAIL — `Cannot find module './+layout.server'`.

- [ ] **Step 3: Write the implementation**

`src/routes/admin/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = requireRole(locals, 'admin');
  return { user };
};
```

`src/routes/admin/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  throw redirect(302, '/admin/users');
};
```

`src/routes/admin/+layout.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { FONT } from '$lib/ui/tokens';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const sections = [
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/invites', label: 'Invites' },
    { href: '/admin/shares', label: 'Shares' },
    { href: '/admin/trash', label: 'Trash' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/jobs', label: 'Jobs' }
  ];
</script>

<div class="admin" style={`--serif:${FONT.serif}; --sans:${FONT.sans};`}>
  <header>
    <h1>Admin</h1>
    <nav aria-label="Admin sections">
      {#each sections as s (s.href)}
        <a href={s.href} aria-current={page.url.pathname.startsWith(s.href) ? 'page' : undefined}>{s.label}</a>
      {/each}
    </nav>
  </header>
  <main>{@render children()}</main>
</div>

<style>
  .admin { width: min(1100px, 100%); margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-family: var(--serif); font-weight: 500; font-size: 40px; margin: 0 0 18px; }
  nav { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 28px; }
  nav a { display: inline-flex; align-items: center; min-height: 48px; padding: 0 16px; font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; color: inherit; opacity: var(--chrome-opacity, 0.5); }
  nav a[aria-current='page'] { opacity: 1; font-weight: 700; }
  nav a:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

(The admin pages inherit the app's root layout room/theming from phase 01; admin content itself is deliberately plain typographic chrome.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/routes/admin/layout.server.test.ts && pnpm check`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin
git commit -m "feat: admin shell with role guard and section nav"
```

---

### Task 9: Admin users — list, role change (owner-gated), reset password, link person, delete-with-reassign

**Files:**
- Create: `src/lib/server/admin-users.ts`
- Test: `src/lib/server/admin-users.test.ts`
- Create: `src/routes/api/admin/users/+server.ts`
- Create: `src/routes/api/admin/users/[id]/+server.ts`
- Create: `src/routes/admin/users/+page.server.ts`
- Create: `src/routes/admin/users/+page.svelte`

**Interfaces:**
- Consumes: `users, people, sessions, items, albums, comments, invites, shares` tables; `hashPassword`; `nanoid`; `SessionUser`.
- Produces:
  - `listUsers(db: Db): Promise<AdminUserRow[]>` where `AdminUserRow = { id; username; role: Role; accentColor; personId: string | null; personName: string | null; createdAt: Date }`
  - `changeRole(db: Db, actor: SessionUser, userId: string, newRole: Exclude<Role, 'owner'>): Promise<void>`
  - `resetPassword(db: Db, actor: SessionUser, userId: string): Promise<string>` (returns the one-time temp password; kills the target's sessions)
  - `linkPerson(db: Db, userId: string, personId: string | null): Promise<void>`
  - `deleteUser(db: Db, actor: SessionUser, userId: string): Promise<void>` (reassigns all authored content to the owner)
  - HTTP: `GET /api/admin/users` → `{ users: AdminUserRow[] }`; `PATCH /api/admin/users/[id]` body one of `{ role }`, `{ resetPassword: true }` → `{ tempPassword }`, `{ personId: string | null }`; `DELETE /api/admin/users/[id]` → `204`.

**Guard matrix (spec §3 / §11 + prompt):** role changes **to or from** `admin` require the actor to be the owner; the owner's role can never change; nobody can be promoted to `owner`; admin passwords reset only by owner; the owner's password only by the owner themself; the owner cannot be deleted; you cannot delete yourself; deleting an admin requires owner.

- [ ] **Step 1: Write the failing test**

`src/lib/server/admin-users.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './db/test-db';
import { albums, comments, items, people, sessions, users } from './db/schema';
import { verifyPassword } from './auth';
import { changeRole, deleteUser, linkPerson, listUsers, resetPassword } from './admin-users';
import type { Db } from './db';

let db: Db;
const owner = { id: 'u_owner0000001', username: 'gran', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system' } as const;
const admin = { id: 'u_admin0000001', username: 'ada', role: 'admin', accentColor: '#FFD700', personId: null, comfortMode: false, theme: 'system' } as const;

async function expectStatus(fn: () => Promise<unknown>, status: number) {
  try { await fn(); expect.unreachable(); }
  catch (e) { expect(isHttpError(e) && e.status === status, `expected HttpError ${status}, got ${String(e)}`).toBe(true); }
}

beforeEach(async () => {
  db = await makeTestDb();
  const now = new Date();
  await db.insert(users).values([
    { id: owner.id, username: 'gran', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: now },
    { id: admin.id, username: 'ada', passwordHash: 'x', role: 'admin', accentColor: '#FFD700', personId: null, comfortMode: false, theme: 'system', createdAt: now },
    { id: 'u_up0000000001', username: 'kid', passwordHash: 'x', role: 'uploader', accentColor: '#A8D8EA', personId: null, comfortMode: false, theme: 'system', createdAt: now }
  ]);
  await db.insert(people).values({ id: 'p_1', name: 'Mom', birthdate: null, deathDate: null, birthPlace: null, bio: null, avatarItemId: null, avatarCrop: null, accentColor: '#FFB11B', createdAt: now });
});

describe('listUsers', () => {
  it('lists with linked person names', async () => {
    await linkPerson(db, 'u_up0000000001', 'p_1');
    const rows = await listUsers(db);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === 'u_up0000000001')?.personName).toBe('Mom');
    expect(JSON.stringify(rows)).not.toContain('passwordHash');
  });
});

describe('changeRole', () => {
  it('admin may move a non-admin among user/uploader/editor', async () => {
    await changeRole(db, admin, 'u_up0000000001', 'editor');
    expect((await listUsers(db)).find((r) => r.id === 'u_up0000000001')?.role).toBe('editor');
  });
  it('only owner promotes to admin or demotes an admin', async () => {
    await expectStatus(() => changeRole(db, admin, 'u_up0000000001', 'admin'), 403);
    await expectStatus(() => changeRole(db, admin, admin.id, 'editor'), 403);
    await changeRole(db, owner, 'u_up0000000001', 'admin');
    await changeRole(db, owner, admin.id, 'editor');
  });
  it('owner role is immutable; nobody becomes owner', async () => {
    await expectStatus(() => changeRole(db, owner, owner.id, 'admin' as never), 403);
    await expectStatus(() => changeRole(db, owner, 'u_up0000000001', 'owner' as never), 400);
  });
});

describe('resetPassword', () => {
  it('returns a temp password that verifies, and kills sessions', async () => {
    await db.insert(sessions).values({ id: 'sess1', userId: 'u_up0000000001', expiresAt: new Date(Date.now() + 1e7) });
    const temp = await resetPassword(db, admin, 'u_up0000000001');
    expect(temp.length).toBeGreaterThanOrEqual(12);
    const row = (await db.select().from(users).where(eq(users.id, 'u_up0000000001')))[0];
    expect(await verifyPassword(temp, row.passwordHash)).toBe(true);
    expect(await db.select().from(sessions).where(eq(sessions.userId, 'u_up0000000001'))).toHaveLength(0);
  });
  it('admin cannot reset admin/owner passwords', async () => {
    await expectStatus(() => resetPassword(db, admin, admin.id), 403);
    await expectStatus(() => resetPassword(db, admin, owner.id), 403);
  });
});

describe('deleteUser', () => {
  it('reassigns content to the owner and removes the account', async () => {
    const now = new Date();
    await db.insert(items).values({ id: 'it_1', type: 'photo', title: null, description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: 'u_up0000000001', deletedAt: null, createdAt: now });
    await db.insert(albums).values({ id: 'al_1', title: 'A', description: null, coverItemId: null, createdBy: 'u_up0000000001', createdAt: now, deletedAt: null });
    await db.insert(comments).values({ id: 'c_1', itemId: 'it_1', userId: 'u_up0000000001', body: 'hi', createdAt: now, deletedAt: null });
    await deleteUser(db, admin, 'u_up0000000001');
    expect((await db.select().from(users)).map((u) => u.id)).not.toContain('u_up0000000001');
    expect((await db.select().from(items))[0].uploadedBy).toBe(owner.id);
    expect((await db.select().from(albums))[0].createdBy).toBe(owner.id);
    expect((await db.select().from(comments))[0].userId).toBe(owner.id);
  });
  it('guards: no owner, no self, admins only by owner', async () => {
    await expectStatus(() => deleteUser(db, admin, owner.id), 403);
    await expectStatus(() => deleteUser(db, admin, admin.id), 400);
    await expectStatus(() => deleteUser(db, { ...admin, id: 'u_admin0000002' }, admin.id), 403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/admin-users.test.ts`
Expected: FAIL — `Cannot find module './admin-users'`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/admin-users.ts` (complete file):

```ts
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { albums, comments, invites, items, people, sessions, shares, users } from './db/schema';
import { hashPassword } from './auth';
import type { Db } from './db';
import type { Role, SessionUser } from './roles';

export interface AdminUserRow {
  id: string;
  username: string;
  role: Role;
  accentColor: string;
  personId: string | null;
  personName: string | null;
  createdAt: Date;
}

export async function listUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: users.id, username: users.username, role: users.role, accentColor: users.accentColor,
      personId: users.personId, personName: people.name, createdAt: users.createdAt
    })
    .from(users)
    .leftJoin(people, eq(people.id, users.personId));
  return rows.map((r) => ({ ...r, personId: r.personId ?? null, personName: r.personName ?? null }));
}

async function getUserOr404(db: Db, id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!rows[0]) throw error(404, 'User not found');
  return rows[0];
}

export async function changeRole(db: Db, actor: SessionUser, userId: string, newRole: Exclude<Role, 'owner'>): Promise<void> {
  const target = await getUserOr404(db, userId);
  if ((newRole as Role) === 'owner') throw error(400, 'There is exactly one owner.');
  if (target.role === 'owner') throw error(403, "The owner's role cannot be changed.");
  if ((newRole === 'admin' || target.role === 'admin') && actor.role !== 'owner') {
    throw error(403, 'Only the owner can promote to or demote from admin.');
  }
  await db.update(users).set({ role: newRole }).where(eq(users.id, userId));
}

export async function resetPassword(db: Db, actor: SessionUser, userId: string): Promise<string> {
  const target = await getUserOr404(db, userId);
  if (target.role === 'owner' && actor.id !== target.id) {
    throw error(403, 'Only the owner can reset the owner password.');
  }
  if (target.role === 'admin' && actor.role !== 'owner' && actor.id !== target.id) {
    throw error(403, 'Only the owner can reset an admin password.');
  }
  const temp = nanoid(14);
  await db.update(users).set({ passwordHash: await hashPassword(temp) }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return temp;
}

export async function linkPerson(db: Db, userId: string, personId: string | null): Promise<void> {
  await getUserOr404(db, userId);
  if (personId !== null) {
    const found = await db.select({ id: people.id }).from(people).where(eq(people.id, personId)).limit(1);
    if (found.length === 0) throw error(404, 'Person not found');
  }
  await db.update(users).set({ personId }).where(eq(users.id, userId));
}

/** Delete the account; every authored row is reassigned to the owner first. */
export async function deleteUser(db: Db, actor: SessionUser, userId: string): Promise<void> {
  const target = await getUserOr404(db, userId);
  if (target.role === 'owner') throw error(403, 'The owner cannot be deleted.');
  if (target.id === actor.id) throw error(400, 'You cannot delete your own account from here.');
  if (target.role === 'admin' && actor.role !== 'owner') throw error(403, 'Only the owner can delete an admin.');
  const ownerRow = (await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1))[0];
  if (!ownerRow) throw error(500, 'No owner account found');
  await db.update(items).set({ uploadedBy: ownerRow.id }).where(eq(items.uploadedBy, userId));
  await db.update(albums).set({ createdBy: ownerRow.id }).where(eq(albums.createdBy, userId));
  await db.update(comments).set({ userId: ownerRow.id }).where(eq(comments.userId, userId));
  await db.update(invites).set({ createdBy: ownerRow.id }).where(eq(invites.createdBy, userId));
  await db.update(shares).set({ createdBy: ownerRow.id }).where(eq(shares.createdBy, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
```

(If phase 01's `roles.ts` does not export `Role`/`SessionUser` types, import them from where phase 01 declared them — `app.d.ts` ambient or `$lib/server/auth` — do not redeclare.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/admin-users.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Add the HTTP routes**

`src/routes/api/admin/users/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { listUsers } from '$lib/server/admin-users';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'admin');
  return json({ users: await listUsers(locals.db) });
};
```

`src/routes/api/admin/users/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { changeRole, deleteUser, linkPerson, resetPassword } from '$lib/server/admin-users';
import type { Role } from '$lib/server/roles';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const actor = requireRole(locals, 'admin');
  const body = (await request.json()) as { role?: Role; resetPassword?: boolean; personId?: string | null };
  if (body.role !== undefined) {
    await changeRole(locals.db, actor, params.id, body.role as Exclude<Role, 'owner'>);
    return json({ ok: true });
  }
  if (body.resetPassword) {
    const tempPassword = await resetPassword(locals.db, actor, params.id);
    return json({ tempPassword });
  }
  if (body.personId !== undefined) {
    await linkPerson(locals.db, params.id, body.personId);
    return json({ ok: true });
  }
  throw error(400, 'Nothing to update');
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const actor = requireRole(locals, 'admin');
  await deleteUser(locals.db, actor, params.id);
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 6: Build the page**

`src/routes/admin/users/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { listUsers } from '$lib/server/admin-users';
import { people } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  const allPeople = await locals.db.select({ id: people.id, name: people.name }).from(people);
  return { users: await listUsers(locals.db), people: allPeople };
};
```

`src/routes/admin/users/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let tempPasswords: Record<string, string> = $state({});
  let confirmingDelete: string | null = $state(null);

  const isOwner = $derived(data.user.role === 'owner');
  const assignable = ['user', 'uploader', 'editor', 'admin'] as const;

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      const out = await res.json();
      if (out.tempPassword) tempPasswords = { ...tempPasswords, [id]: out.tempPassword };
      await invalidateAll();
    } else {
      alert((await res.json()).message ?? 'That change was not allowed.');
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    confirmingDelete = null;
    if (res.ok) await invalidateAll();
    else alert((await res.json()).message ?? 'Delete failed.');
  }

  function roleOptions(row: (typeof data.users)[number]) {
    // to/from admin is owner-only; hide what the actor can't do
    return assignable.filter((r) => (r === 'admin' || row.role === 'admin' ? isOwner : true));
  }
</script>

<h2>Users</h2>
<table>
  <thead>
    <tr><th>Username</th><th>Role</th><th>Linked person</th><th>Actions</th></tr>
  </thead>
  <tbody>
    {#each data.users as u (u.id)}
      <tr>
        <td class="name" style={`--accent:${u.accentColor}`}>{u.username}</td>
        <td>
          {#if u.role === 'owner'}
            <span class="owner-badge">Owner</span>
          {:else}
            <select
              aria-label={`Role for ${u.username}`} value={u.role}
              disabled={u.role === 'admin' && !isOwner}
              onchange={(e) => patch(u.id, { role: e.currentTarget.value })}
            >
              {#each roleOptions(u) as r (r)}<option value={r}>{r}</option>{/each}
            </select>
          {/if}
        </td>
        <td>
          <select
            aria-label={`Linked person for ${u.username}`} value={u.personId ?? ''}
            onchange={(e) => patch(u.id, { personId: e.currentTarget.value || null })}
          >
            <option value="">— none —</option>
            {#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </td>
        <td class="actions">
          <button onclick={() => patch(u.id, { resetPassword: true })}>Reset password</button>
          {#if tempPasswords[u.id]}<code class="temp">{tempPasswords[u.id]}</code>{/if}
          {#if u.role !== 'owner' && u.id !== data.user.id}
            {#if confirmingDelete === u.id}
              <span class="confirm">
                Reassigns their uploads, albums and comments to the owner.
                <button class="danger" onclick={() => remove(u.id)}>Delete {u.username}</button>
                <button onclick={() => (confirmingDelete = null)}>Cancel</button>
              </span>
            {:else}
              <button onclick={() => (confirmingDelete = u.id)}>Delete…</button>
            {/if}
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-align: left; padding: 8px 12px 8px 0; opacity: var(--chrome-opacity, 0.5); }
  td { font-family: var(--serif); font-size: 16px; padding: 6px 12px 6px 0; }
  .name { color: var(--accent); font-weight: 600; }
  .owner-badge { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
  select, button { min-height: 48px; border: none; font-family: var(--sans); font-size: 13px; cursor: pointer; background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; padding: 0 12px; }
  .danger { font-weight: 700; }
  .temp { font-family: ui-monospace, monospace; font-size: 13px; padding: 4px 6px; background: color-mix(in srgb, currentColor 12%, transparent); }
  .confirm { font-family: var(--sans); font-size: 13px; }
  :is(select, button):focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
</style>
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run src/lib/server/admin-users.test.ts && pnpm check`
Expected: PASS.

Manual: as admin — role select hides `admin` for non-owners; reset shows a one-time temp password inline; delete asks for confirmation with the reassign explanation.

```bash
git add src/lib/server/admin-users.ts src/lib/server/admin-users.test.ts src/routes/api/admin/users src/routes/admin/users
git commit -m "feat: admin user management with owner-gated role changes and reassigning delete"
```

---

### Task 10: Admin invites (full UI, replaces phase-01 stub) + admin shares page

**Files:**
- Create (replacing the phase-01 stub files at the same paths, if present): `src/routes/admin/invites/+page.server.ts`, `src/routes/admin/invites/+page.svelte`
- Create: `src/routes/admin/shares/+page.server.ts`, `src/routes/admin/shares/+page.svelte`

**Interfaces:**
- Consumes: `/api/invites` GET/POST/DELETE (phase 01, Contract 6 — POST body `{ role, expiry?: 'never'|'7d'|'30d'|'YYYY-MM-DD', maxUses }`, GET → `{ invites: { id, token, role, expiresAt, maxUses, useCount }[] }`; if phase 01's exact body/response fields differ, keep phase 01's — this page is a consumer); `/api/shares` + `DELETE /api/shares/[id]` (Task 2); `shares`, `albums`, `items` tables for the shares listing join.
- Produces: `/admin/invites` and `/admin/shares` pages.

- [ ] **Step 1: Invites page server load**

`src/routes/admin/invites/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { invites } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  return { invites: await locals.db.select().from(invites) };
};
```

- [ ] **Step 2: Invites page UI**

`src/routes/admin/invites/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let role = $state<'admin' | 'editor' | 'uploader' | 'user'>('user');
  let expiry = $state<'never' | '7d' | '30d'>('7d');
  let maxUses = $state(1);
  let copied = $state('');

  const canMintAdmin = $derived(data.user.role === 'owner');

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const res = await fetch('/api/invites', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, expiry, maxUses })
    });
    if (res.ok) await invalidateAll();
    else alert((await res.json()).message ?? 'Could not create the invite.');
  }
  async function revoke(id: string) {
    await fetch(`/api/invites?id=${id}`, { method: 'DELETE' });
    await invalidateAll();
  }
  async function copy(token: string) {
    await navigator.clipboard.writeText(new URL(`/invite/${token}`, location.origin).href);
    copied = token;
    setTimeout(() => (copied = ''), 1500);
  }
</script>

<h2>Invites</h2>
<form onsubmit={create}>
  <label>Role
    <select bind:value={role}>
      <option value="user">user</option>
      <option value="uploader">uploader</option>
      <option value="editor">editor</option>
      {#if canMintAdmin}<option value="admin">admin</option>{/if}
    </select>
  </label>
  <label>Expires
    <select bind:value={expiry}>
      <option value="7d">In 7 days</option>
      <option value="30d">In 30 days</option>
      <option value="never">Never</option>
    </select>
  </label>
  <label>Max uses
    <input type="number" min="1" max="100" bind:value={maxUses} />
  </label>
  <button type="submit">Create invite</button>
</form>

<table>
  <thead><tr><th>Link</th><th>Role</th><th>Usage</th><th>Expires</th><th></th></tr></thead>
  <tbody>
    {#each data.invites as inv (inv.id)}
      <tr>
        <td><button onclick={() => copy(inv.token)}>{copied === inv.token ? 'Copied' : 'Copy link'}</button></td>
        <td>{inv.role}</td>
        <td>{inv.useCount} / {inv.maxUses}</td>
        <td>{inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'never'}</td>
        <td><button onclick={() => revoke(inv.id)}>Revoke</button></td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 16px; }
  form { display: flex; flex-wrap: wrap; gap: 14px; align-items: end; margin-bottom: 26px; }
  label { display: flex; flex-direction: column; gap: 6px; font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
  select, input, button { min-height: 48px; border: none; font-family: var(--sans); font-size: 14px; background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; padding: 0 12px; cursor: pointer; }
  input[type='number'] { width: 90px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-align: left; padding-right: 12px; opacity: var(--chrome-opacity, 0.5); }
  td { font-family: var(--serif); font-size: 16px; padding: 6px 12px 6px 0; }
  :is(select, input, button):focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

If phase 01's `/api/invites` DELETE takes the id in the path (`/api/invites/[id]`) or the POST expects `expiresAt` instead of `expiry`, adapt `revoke()`/`create()` to phase 01's shipped contract — the API is phase 01's; only this UI is phase 08's.

- [ ] **Step 3: Admin shares page**

`src/routes/admin/shares/+page.server.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { albums, items, shares } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  const rows = await locals.db.select().from(shares);
  const albumIds = rows.filter((r) => r.targetType === 'album').map((r) => r.targetId);
  const itemIds = rows.filter((r) => r.targetType === 'item').map((r) => r.targetId);
  const albumTitles = albumIds.length
    ? await locals.db.select({ id: albums.id, title: albums.title }).from(albums).where(inArray(albums.id, albumIds))
    : [];
  const itemTitles = itemIds.length
    ? await locals.db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, itemIds))
    : [];
  const titles = new Map<string, string>([
    ...albumTitles.map((a) => [a.id, a.title] as const),
    ...itemTitles.map((i) => [i.id, i.title ?? 'Untitled item'] as const)
  ]);
  return {
    shares: rows.map((r) => ({
      id: r.id, token: r.token, targetType: r.targetType, targetId: r.targetId,
      targetTitle: titles.get(r.targetId) ?? '(deleted)',
      hasPassword: r.passwordHash !== null, expiresAt: r.expiresAt, allowDownload: r.allowDownload
    }))
  };
};
```

`src/routes/admin/shares/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let copied = $state('');

  async function revoke(id: string) {
    await fetch(`/api/shares/${id}`, { method: 'DELETE' });
    await invalidateAll();
  }
  async function copy(token: string) {
    await navigator.clipboard.writeText(new URL(`/share/${token}`, location.origin).href);
    copied = token;
    setTimeout(() => (copied = ''), 1500);
  }
</script>

<h2>Shares</h2>
{#if data.shares.length === 0}
  <p class="empty">No share links yet.</p>
{:else}
  <table>
    <thead><tr><th>Target</th><th>Protection</th><th>Expires</th><th>Downloads</th><th></th></tr></thead>
    <tbody>
      {#each data.shares as s (s.id)}
        <tr>
          <td>{s.targetType === 'album' ? 'Album' : 'Item'} · {s.targetTitle}</td>
          <td>{s.hasPassword ? 'Password' : 'Open'}</td>
          <td>{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'never'}</td>
          <td>{s.allowDownload ? 'allowed' : 'view only'}</td>
          <td class="actions">
            <button onclick={() => copy(s.token)}>{copied === s.token ? 'Copied' : 'Copy link'}</button>
            <button onclick={() => revoke(s.id)}>Revoke</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 16px; }
  .empty { font-family: var(--serif); font-size: 17px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-align: left; padding-right: 12px; opacity: var(--chrome-opacity, 0.5); }
  td { font-family: var(--serif); font-size: 16px; padding: 6px 12px 6px 0; }
  button { min-height: 48px; border: none; font-family: var(--sans); font-size: 13px; background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; padding: 0 12px; cursor: pointer; }
  button:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
  .actions { display: flex; gap: 6px; }
</style>
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm check && pnpm vitest run`
Expected: clean typecheck; full unit suite green (no server logic was added, pages consume existing tested APIs).

Manual: `/admin/invites` mints links with role/expiry/max-uses, shows `useCount / maxUses`, copies `/invite/<token>` links, revokes; `/admin/shares` lists every share with target titles, copies and revokes.

```bash
git add src/routes/admin/invites src/routes/admin/shares
git commit -m "feat: admin invites UI and global shares list"
```

---

### Task 11: Trash — list/restore/empty + 30-day sweep

**Files:**
- Create: `src/lib/server/trash.ts`
- Test: `src/lib/server/trash.test.ts`
- Create: `src/routes/api/admin/trash/+server.ts`
- Create: `src/routes/admin/trash/+page.server.ts`, `src/routes/admin/trash/+page.svelte`

**Interfaces:**
- Consumes: `items, itemFiles, itemPeople, itemTags, albumItems, albums, comments, faces, shares` tables; `StorageAdapter` (Contract 2); `reindexItem` from `$lib/server/search` (Contract 1 FTS note).
- Produces:
  - `TRASH_RETENTION_DAYS = 30`
  - `listTrash(db: Db): Promise<TrashLists>` where `TrashLists = { items: { id; title: string | null; type: 'video' | 'photo'; deletedAt: Date }[]; albums: { id; title: string; deletedAt: Date }[]; comments: { id; body: string; itemId: string; deletedAt: Date }[] }`
  - `restoreTrash(db: Db, kind: 'item' | 'album' | 'comment', id: string): Promise<void>`
  - `purgeExpired(db: Db, storage: StorageAdapter, now?: Date): Promise<PurgeResult>` — hard-deletes anything with `deletedAt < now − 30 d`
  - `emptyTrash(db: Db, storage: StorageAdapter): Promise<PurgeResult>` — hard-deletes ALL soft-deleted rows
  - `PurgeResult = { items: number; albums: number; comments: number }`
  - HTTP: `GET /api/admin/trash` → `TrashLists`; `POST /api/admin/trash` body `{ action: 'restore'; kind; id }` → `{ ok: true }`; `DELETE /api/admin/trash` body `{ confirm: 'empty the trash' }` → `PurgeResult` (400 without the exact phrase).

> **Why there is no `trash_sweep` job:** master Contract 1 fixes `jobs.kind ∈ {derivatives, sprite, ingest_scan, face_scan}` and that enum is closed — phase plans may not add values. The sweep therefore runs inline: (a) inside admin "empty trash", and (b) automatically as `purgeExpired()` on every `/admin/trash` page load, which is sufficient for a family-scale archive (expired rows are invisible to users either way — queries filter `deleted_at`). A nightly cron wrapper arrives with the phase 10 deployment notes.

- [ ] **Step 1: Write the failing test**

`src/lib/server/trash.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb } from './db/test-db';
import { albumItems, albums, comments, itemFiles, items, users } from './db/schema';
import { emptyTrash, listTrash, purgeExpired, restoreTrash, TRASH_RETENTION_DAYS } from './trash';
import type { Db } from './db';

let db: Db;
const OWNER_ID = 'u_owner0000001';
const NOW = new Date('2026-07-04T12:00:00Z');
const DAYS_40_AGO = new Date(NOW.getTime() - 40 * 86_400_000);
const DAYS_5_AGO = new Date(NOW.getTime() - 5 * 86_400_000);

const deleted: string[] = [];
const storage = {
  put: vi.fn(), get: vi.fn(), head: vi.fn(),
  delete: vi.fn(async (key: string) => { deleted.push(key); }),
  mediaUrl: vi.fn(async (k: string) => `/media/${k}`)
};

beforeEach(async () => {
  db = await makeTestDb();
  deleted.length = 0;
  await db.insert(users).values({ id: OWNER_ID, username: 'gran', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: NOW });
  await db.insert(items).values([
    { id: 'it_old', type: 'photo', title: 'Old', description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: DAYS_40_AGO, createdAt: NOW },
    { id: 'it_new', type: 'photo', title: 'New', description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'b'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: DAYS_5_AGO, createdAt: NOW },
    { id: 'it_live', type: 'photo', title: 'Live', description: null, dateStart: null, dateEnd: null, datePrecision: 'unknown', sortDate: null, duration: null, width: 1, height: 1, sizeBytes: 1, sha256: 'c'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: null, createdAt: NOW }
  ]);
  await db.insert(itemFiles).values([
    { id: 'if_1', itemId: 'it_old', kind: 'original', storageKey: 'media/it_old/original.jpg', mime: 'image/jpeg', width: 1, height: 1 },
    { id: 'if_2', itemId: 'it_old', kind: 'thumb_800', storageKey: 'media/it_old/thumb_800.webp', mime: 'image/webp', width: 1, height: 1 }
  ]);
  await db.insert(albums).values([
    { id: 'al_old', title: 'Old album', description: null, coverItemId: null, createdBy: OWNER_ID, createdAt: NOW, deletedAt: DAYS_40_AGO },
    { id: 'al_live', title: 'Live album', description: null, coverItemId: null, createdBy: OWNER_ID, createdAt: NOW, deletedAt: null }
  ]);
  await db.insert(albumItems).values({ albumId: 'al_old', itemId: 'it_live', position: 0 });
  await db.insert(comments).values([
    { id: 'c_old', itemId: 'it_live', userId: OWNER_ID, body: 'old comment', createdAt: NOW, deletedAt: DAYS_40_AGO },
    { id: 'c_new', itemId: 'it_live', userId: OWNER_ID, body: 'new comment', createdAt: NOW, deletedAt: DAYS_5_AGO }
  ]);
});

describe('listTrash', () => {
  it('lists only soft-deleted rows', async () => {
    const t = await listTrash(db);
    expect(t.items.map((i) => i.id).sort()).toEqual(['it_new', 'it_old']);
    expect(t.albums.map((a) => a.id)).toEqual(['al_old']);
    expect(t.comments.map((c) => c.id).sort()).toEqual(['c_new', 'c_old']);
  });
});

describe('restoreTrash', () => {
  it('clears deletedAt', async () => {
    await restoreTrash(db, 'item', 'it_new');
    await restoreTrash(db, 'comment', 'c_new');
    const t = await listTrash(db);
    expect(t.items.map((i) => i.id)).toEqual(['it_old']);
    expect(t.comments.map((c) => c.id)).toEqual(['c_old']);
  });
});

describe('purgeExpired (30-day sweep)', () => {
  it('hard-deletes only rows older than 30 days, including storage objects', async () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    const res = await purgeExpired(db, storage, NOW);
    expect(res).toEqual({ items: 1, albums: 1, comments: 1 });
    expect(deleted.sort()).toEqual(['media/it_old/original.jpg', 'media/it_old/thumb_800.webp']);
    const t = await listTrash(db);
    expect(t.items.map((i) => i.id)).toEqual(['it_new']);
    expect(t.albums).toEqual([]);
    expect(t.comments.map((c) => c.id)).toEqual(['c_new']);
    // live rows untouched
    expect((await db.select().from(items)).map((i) => i.id).sort()).toEqual(['it_live', 'it_new']);
    expect((await db.select().from(itemFiles))).toHaveLength(0);
  });
});

describe('emptyTrash', () => {
  it('hard-deletes everything soft-deleted regardless of age', async () => {
    const res = await emptyTrash(db, storage);
    expect(res).toEqual({ items: 2, albums: 1, comments: 2 });
    const t = await listTrash(db);
    expect(t).toEqual({ items: [], albums: [], comments: [] });
    expect((await db.select().from(items)).map((i) => i.id)).toEqual(['it_live']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/trash.test.ts`
Expected: FAIL — `Cannot find module './trash'`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/trash.ts` (complete file):

```ts
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  albumItems, albums, comments, faces, itemFiles, itemPeople, items, itemTags, shares
} from './db/schema';
import { reindexItem } from './search';
import type { Db } from './db';
import type { StorageAdapter } from './platform/types';

export const TRASH_RETENTION_DAYS = 30;

export interface TrashLists {
  items: { id: string; title: string | null; type: 'video' | 'photo'; deletedAt: Date }[];
  albums: { id: string; title: string; deletedAt: Date }[];
  comments: { id: string; body: string; itemId: string; deletedAt: Date }[];
}

export interface PurgeResult { items: number; albums: number; comments: number }

export async function listTrash(db: Db): Promise<TrashLists> {
  const deadItems = await db
    .select({ id: items.id, title: items.title, type: items.type, deletedAt: items.deletedAt })
    .from(items).where(isNotNull(items.deletedAt));
  const deadAlbums = await db
    .select({ id: albums.id, title: albums.title, deletedAt: albums.deletedAt })
    .from(albums).where(isNotNull(albums.deletedAt));
  const deadComments = await db
    .select({ id: comments.id, body: comments.body, itemId: comments.itemId, deletedAt: comments.deletedAt })
    .from(comments).where(isNotNull(comments.deletedAt));
  return {
    items: deadItems.map((r) => ({ ...r, deletedAt: r.deletedAt as Date })),
    albums: deadAlbums.map((r) => ({ ...r, deletedAt: r.deletedAt as Date })),
    comments: deadComments.map((r) => ({ ...r, deletedAt: r.deletedAt as Date }))
  };
}

export async function restoreTrash(db: Db, kind: 'item' | 'album' | 'comment', id: string): Promise<void> {
  if (kind === 'item') {
    await db.update(items).set({ deletedAt: null }).where(eq(items.id, id));
    await reindexItem(db, id);
  } else if (kind === 'album') {
    await db.update(albums).set({ deletedAt: null }).where(eq(albums.id, id));
  } else {
    await db.update(comments).set({ deletedAt: null }).where(eq(comments.id, id));
  }
}

async function hardDeleteItems(db: Db, storage: StorageAdapter, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const files = await db.select().from(itemFiles).where(inArray(itemFiles.itemId, ids));
  for (const f of files) await storage.delete(f.storageKey);
  await db.delete(faces).where(inArray(faces.itemId, ids));
  await db.delete(comments).where(inArray(comments.itemId, ids));
  await db.delete(itemPeople).where(inArray(itemPeople.itemId, ids));
  await db.delete(itemTags).where(inArray(itemTags.itemId, ids));
  await db.delete(albumItems).where(inArray(albumItems.itemId, ids));
  await db.delete(itemFiles).where(inArray(itemFiles.itemId, ids));
  await db.delete(shares).where(and(eq(shares.targetType, 'item'), inArray(shares.targetId, ids)));
  await db.delete(items).where(inArray(items.id, ids));
  for (const id of ids) await reindexItem(db, id); // row is gone → FTS entry removed
  return ids.length;
}

async function hardDeleteAlbums(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  await db.delete(albumItems).where(inArray(albumItems.albumId, ids));
  await db.delete(shares).where(and(eq(shares.targetType, 'album'), inArray(shares.targetId, ids)));
  await db.delete(albums).where(inArray(albums.id, ids));
  return ids.length;
}

async function hardDeleteComments(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  await db.delete(comments).where(inArray(comments.id, ids));
  return ids.length;
}

async function purgeWhere(db: Db, storage: StorageAdapter, cutoff: Date | null): Promise<PurgeResult> {
  const itemCond = cutoff ? and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)) : isNotNull(items.deletedAt);
  const albumCond = cutoff ? and(isNotNull(albums.deletedAt), lt(albums.deletedAt, cutoff)) : isNotNull(albums.deletedAt);
  const commentCond = cutoff ? and(isNotNull(comments.deletedAt), lt(comments.deletedAt, cutoff)) : isNotNull(comments.deletedAt);
  const itemIds = (await db.select({ id: items.id }).from(items).where(itemCond)).map((r) => r.id);
  const albumIds = (await db.select({ id: albums.id }).from(albums).where(albumCond)).map((r) => r.id);
  const commentIds = (await db.select({ id: comments.id }).from(comments).where(commentCond)).map((r) => r.id);
  // comments first: hardDeleteItems also removes comments of purged items
  const purgedComments = await hardDeleteComments(db, commentIds);
  const purgedItems = await hardDeleteItems(db, storage, itemIds);
  const purgedAlbums = await hardDeleteAlbums(db, albumIds);
  return { items: purgedItems, albums: purgedAlbums, comments: purgedComments };
}

/**
 * The 30-day sweep. Runs inline (admin trash page load + empty-trash) —
 * NOT as a job: master's jobs.kind enum is closed and has no 'trash_sweep'.
 * Phase 10 adds a nightly cron note that calls this same function.
 * year_counts is untouched here: soft-delete already adjusted aggregates
 * in phase 02; purging an already-soft-deleted row changes no visible count.
 */
export async function purgeExpired(db: Db, storage: StorageAdapter, now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
  return purgeWhere(db, storage, cutoff);
}

export async function emptyTrash(db: Db, storage: StorageAdapter): Promise<PurgeResult> {
  return purgeWhere(db, storage, null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/trash.test.ts`
Expected: PASS — 4 tests. (If `reindexItem` throws on a missing item row, guard the call in phase 06's implementation is authoritative — wrap in `try { … } catch { /* row purged */ }` only if its contract requires an existing row.)

- [ ] **Step 5: HTTP route + page**

`src/routes/api/admin/trash/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { emptyTrash, listTrash, restoreTrash } from '$lib/server/trash';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'admin');
  return json(await listTrash(locals.db));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireRole(locals, 'admin');
  const body = (await request.json()) as { action?: string; kind?: 'item' | 'album' | 'comment'; id?: string };
  if (body.action !== 'restore' || !body.kind || !body.id) throw error(400, 'Expected { action: "restore", kind, id }');
  await restoreTrash(locals.db, body.kind, body.id);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  requireRole(locals, 'admin');
  const body = (await request.json()) as { confirm?: string };
  if (body.confirm !== 'empty the trash') {
    throw error(400, 'Type "empty the trash" to confirm.');
  }
  return json(await emptyTrash(locals.db, locals.platform.storage));
};
```

`src/routes/admin/trash/+page.server.ts` (auto-sweep on load):

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { listTrash, purgeExpired } from '$lib/server/trash';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  const swept = await purgeExpired(locals.db, locals.platform.storage); // inline 30-day sweep
  return { trash: await listTrash(locals.db), swept };
};
```

`src/routes/admin/trash/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let confirmText = $state('');
  let emptying = $state(false);

  const total = $derived(data.trash.items.length + data.trash.albums.length + data.trash.comments.length);

  async function restore(kind: 'item' | 'album' | 'comment', id: string) {
    await fetch('/api/admin/trash', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore', kind, id })
    });
    await invalidateAll();
  }

  async function empty(e: SubmitEvent) {
    e.preventDefault();
    emptying = true;
    try {
      const res = await fetch('/api/admin/trash', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText })
      });
      if (res.ok) { confirmText = ''; await invalidateAll(); }
      else alert((await res.json()).message ?? 'Not confirmed.');
    } finally { emptying = false; }
  }
</script>

<h2>Trash</h2>
<p class="note">Deleted things stay here for 30 days, then are removed for good{#if data.swept.items + data.swept.albums + data.swept.comments > 0}&nbsp;(just swept {data.swept.items + data.swept.albums + data.swept.comments}){/if}.</p>

{#if total === 0}
  <p class="empty">The trash is empty.</p>
{:else}
  {#if data.trash.items.length}
    <h3>Items</h3>
    <ul>
      {#each data.trash.items as t (t.id)}
        <li data-testid="trash-item">
          <span>{t.title ?? 'Untitled'} · {t.type} · deleted {new Date(t.deletedAt).toLocaleDateString()}</span>
          <button onclick={() => restore('item', t.id)}>Restore</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if data.trash.albums.length}
    <h3>Albums</h3>
    <ul>
      {#each data.trash.albums as t (t.id)}
        <li><span>{t.title} · deleted {new Date(t.deletedAt).toLocaleDateString()}</span>
          <button onclick={() => restore('album', t.id)}>Restore</button></li>
      {/each}
    </ul>
  {/if}
  {#if data.trash.comments.length}
    <h3>Comments</h3>
    <ul>
      {#each data.trash.comments as t (t.id)}
        <li><span>“{t.body.slice(0, 80)}” · deleted {new Date(t.deletedAt).toLocaleDateString()}</span>
          <button onclick={() => restore('comment', t.id)}>Restore</button></li>
      {/each}
    </ul>
  {/if}

  <form class="empty-form" onsubmit={empty}>
    <label for="confirm-empty">Type <strong>empty the trash</strong> to delete all {total} things forever</label>
    <input id="confirm-empty" bind:value={confirmText} autocomplete="off" />
    <button class="danger" type="submit" disabled={confirmText !== 'empty the trash' || emptying}>Empty trash</button>
  </form>
{/if}

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 8px; }
  h3 { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 22px 0 8px; opacity: var(--chrome-opacity, 0.5); }
  .note, .empty { font-family: var(--serif); font-size: 16px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 48px; font-family: var(--serif); font-size: 16px; }
  button { min-height: 48px; border: none; font-family: var(--sans); font-size: 13px; background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; padding: 0 14px; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  .empty-form { margin-top: 32px; display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
  label { font-family: var(--sans); font-size: 13px; }
  input { min-height: 48px; border: none; background: color-mix(in srgb, currentColor 8%, transparent); color: inherit; font-family: var(--serif); font-size: 16px; padding: 0 12px; }
  .danger { font-weight: 700; }
  :is(button, input):focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run src/lib/server/trash.test.ts && pnpm check`
Expected: PASS.

```bash
git add src/lib/server/trash.ts src/lib/server/trash.test.ts src/routes/api/admin/trash src/routes/admin/trash
git commit -m "feat: admin trash with restore, typed empty confirm, inline 30-day sweep"
```

---
### Task 12: Admin settings (site name, holiday set, feature-flag readout) + jobs (failed/pending, retry)

**Files:**
- Create: `src/lib/server/admin-settings.ts` + `src/lib/server/admin-settings.test.ts`
- Create: `src/lib/server/admin-jobs.ts` + `src/lib/server/admin-jobs.test.ts`
- Create: `src/routes/api/admin/settings/+server.ts`
- Create: `src/routes/api/admin/jobs/+server.ts`, `src/routes/api/admin/jobs/[id]/retry/+server.ts`
- Create: `src/routes/admin/settings/+page.server.ts`, `+page.svelte`
- Create: `src/routes/admin/jobs/+page.server.ts`, `+page.svelte`

**Interfaces:**
- Consumes: `settings`, `jobs` tables; `Platform.features` (Contract 2).
- Produces:
  - `HOLIDAY_OPTIONS: { id: string; label: string }[]` — ids `newyear, easter, july4, halloween, thanksgiving, christmas` (**must equal the holiday ids `holidaysFor()` emits — phase 06's write-time tagger filters against `settings.holidaySet`; grep `src/lib/domain/holidays.ts` and match its id strings exactly, renaming these if they differ**)
  - `getSiteSettings(db: Db): Promise<SiteSettings>` / `updateSiteSettings(db: Db, patch: Partial<SiteSettings>): Promise<SiteSettings>` where `SiteSettings = { siteName: string; holidaySet: string[] }` (defaults: `'Shoebox'`, all ids)
  - `listJobs(db: Db): Promise<JobRow[]>` (`status ∈ pending|running|failed`, newest first, ≤ 200) where `JobRow = { id; kind; payload: string; status; attempts: number; runAfter: Date; createdAt: Date }`
  - `retryJob(db: Db, id: string): Promise<boolean>` (failed → pending, runAfter = now; false when not found/not failed)
  - HTTP: `GET/PATCH /api/admin/settings` → `SiteSettings`; `GET /api/admin/jobs` → `{ jobs: JobRow[] }`; `POST /api/admin/jobs/[id]/retry` → `{ retried: boolean }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/server/admin-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './db/test-db';
import { getSiteSettings, HOLIDAY_OPTIONS, updateSiteSettings } from './admin-settings';
import type { Db } from './db';

let db: Db;
beforeEach(async () => { db = await makeTestDb(); });

describe('site settings', () => {
  it('returns defaults on a fresh db', async () => {
    const s = await getSiteSettings(db);
    expect(s.siteName).toBe('Shoebox');
    expect(s.holidaySet).toEqual(HOLIDAY_OPTIONS.map((h) => h.id));
  });
  it('persists partial updates', async () => {
    await updateSiteSettings(db, { siteName: 'The Torcivia Archive' });
    await updateSiteSettings(db, { holidaySet: ['christmas', 'halloween'] });
    const s = await getSiteSettings(db);
    expect(s.siteName).toBe('The Torcivia Archive');
    expect(s.holidaySet).toEqual(['christmas', 'halloween']);
  });
  it('rejects unknown holiday ids', async () => {
    await expect(updateSiteSettings(db, { holidaySet: ['festivus'] })).rejects.toThrow();
  });
});
```

`src/lib/server/admin-jobs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './db/test-db';
import { jobs } from './db/schema';
import { listJobs, retryJob } from './admin-jobs';
import type { Db } from './db';

let db: Db;
const NOW = new Date();

beforeEach(async () => {
  db = await makeTestDb();
  await db.insert(jobs).values([
    { id: 'j_failed', kind: 'derivatives', payload: JSON.stringify({ itemId: 'it_1', reason: 'ffmpeg exit 1' }), status: 'failed', attempts: 3, runAfter: NOW, createdAt: NOW },
    { id: 'j_pending', kind: 'sprite', payload: '{"itemId":"it_2"}', status: 'pending', attempts: 0, runAfter: NOW, createdAt: NOW },
    { id: 'j_done', kind: 'ingest_scan', payload: '{}', status: 'done', attempts: 1, runAfter: NOW, createdAt: NOW }
  ]);
});

describe('listJobs', () => {
  it('lists pending/running/failed, not done', async () => {
    const rows = await listJobs(db);
    expect(rows.map((r) => r.id).sort()).toEqual(['j_failed', 'j_pending']);
  });
});

describe('retryJob', () => {
  it('re-pends a failed job and resets runAfter', async () => {
    expect(await retryJob(db, 'j_failed')).toBe(true);
    const row = (await db.select().from(jobs).where(eq(jobs.id, 'j_failed')))[0];
    expect(row.status).toBe('pending');
    expect(row.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('refuses non-failed or missing jobs', async () => {
    expect(await retryJob(db, 'j_pending')).toBe(false);
    expect(await retryJob(db, 'j_missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/server/admin-settings.test.ts src/lib/server/admin-jobs.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write the implementations**

`src/lib/server/admin-settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import { settings } from './db/schema';
import type { Db } from './db';

// Ids must match the strings holidaysFor() (src/lib/domain/holidays.ts,
// phase 06) emits — the write-time tagger filters against this set.
export const HOLIDAY_OPTIONS = [
  { id: 'newyear', label: "New Year's" },
  { id: 'easter', label: 'Easter' },
  { id: 'july4', label: 'July 4th' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'thanksgiving', label: 'Thanksgiving' },
  { id: 'christmas', label: 'Christmas' }
] as const;

export interface SiteSettings {
  siteName: string;
  holidaySet: string[];
}

const DEFAULTS: SiteSettings = {
  siteName: 'Shoebox',
  holidaySet: HOLIDAY_OPTIONS.map((h) => h.id)
};

async function readKey<T>(db: Db, key: string): Promise<T | undefined> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined;
}

async function writeKey(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } });
}

export async function getSiteSettings(db: Db): Promise<SiteSettings> {
  return {
    siteName: (await readKey<string>(db, 'siteName')) ?? DEFAULTS.siteName,
    holidaySet: (await readKey<string[]>(db, 'holidaySet')) ?? DEFAULTS.holidaySet
  };
}

export async function updateSiteSettings(db: Db, patch: Partial<SiteSettings>): Promise<SiteSettings> {
  if (patch.siteName !== undefined) {
    const name = patch.siteName.trim();
    if (name.length === 0 || name.length > 80) throw new Error('siteName must be 1–80 characters');
    await writeKey(db, 'siteName', name);
  }
  if (patch.holidaySet !== undefined) {
    const known = new Set<string>(HOLIDAY_OPTIONS.map((h) => h.id));
    for (const id of patch.holidaySet) {
      if (!known.has(id)) throw new Error(`Unknown holiday id: ${id}`);
    }
    await writeKey(db, 'holidaySet', patch.holidaySet);
  }
  return getSiteSettings(db);
}
```

`src/lib/server/admin-jobs.ts`:

```ts
import { desc, eq, inArray, and } from 'drizzle-orm';
import { jobs } from './db/schema';
import type { Db } from './db';

export interface JobRow {
  id: string;
  kind: 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan';
  payload: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  runAfter: Date;
  createdAt: Date;
}

export async function listJobs(db: Db): Promise<JobRow[]> {
  return db.select().from(jobs)
    .where(inArray(jobs.status, ['pending', 'running', 'failed']))
    .orderBy(desc(jobs.createdAt))
    .limit(200);
}

/** failed → pending, runAfter = now. The worker (phase 07) picks it up. */
export async function retryJob(db: Db, id: string): Promise<boolean> {
  const found = await db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.status, 'failed'))).limit(1);
  if (found.length === 0) return false;
  await db.update(jobs).set({ status: 'pending', runAfter: new Date() }).where(eq(jobs.id, id));
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/server/admin-settings.test.ts src/lib/server/admin-jobs.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: HTTP routes**

`src/routes/api/admin/settings/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { getSiteSettings, updateSiteSettings } from '$lib/server/admin-settings';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'admin');
  return json(await getSiteSettings(locals.db));
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  requireRole(locals, 'admin');
  try {
    return json(await updateSiteSettings(locals.db, await request.json()));
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Invalid settings');
  }
};
```

`src/routes/api/admin/jobs/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { listJobs } from '$lib/server/admin-jobs';

export const GET: RequestHandler = async ({ locals }) => {
  requireRole(locals, 'admin');
  return json({ jobs: await listJobs(locals.db) });
};
```

`src/routes/api/admin/jobs/[id]/retry/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';
import { retryJob } from '$lib/server/admin-jobs';

export const POST: RequestHandler = async ({ locals, params }) => {
  requireRole(locals, 'admin');
  return json({ retried: await retryJob(locals.db, params.id) });
};
```

- [ ] **Step 6: Pages**

`src/routes/admin/settings/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { getSiteSettings, HOLIDAY_OPTIONS } from '$lib/server/admin-settings';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  return {
    settings: await getSiteSettings(locals.db),
    holidayOptions: [...HOLIDAY_OPTIONS],
    features: locals.platform.features // readout only
  };
};
```

`src/routes/admin/settings/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let siteName = $state(data.settings.siteName);
  let holidaySet = $state(new Set(data.settings.holidaySet));
  let saved = $state(false);

  function toggle(id: string) {
    const next = new Set(holidaySet);
    if (next.has(id)) next.delete(id); else next.add(id);
    holidaySet = next;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteName, holidaySet: [...holidaySet] })
    });
    if (res.ok) { saved = true; setTimeout(() => (saved = false), 1500); await invalidateAll(); }
    else alert((await res.json()).message ?? 'Could not save.');
  }
</script>

<h2>Settings</h2>
<form onsubmit={save}>
  <label class="stack">Site name
    <input bind:value={siteName} maxlength="80" required />
  </label>

  <fieldset>
    <legend>Holidays tagged automatically</legend>
    {#each data.holidayOptions as h (h.id)}
      <label class="row">
        <input type="checkbox" checked={holidaySet.has(h.id)} onchange={() => toggle(h.id)} />
        {h.label}
      </label>
    {/each}
  </fieldset>

  <button type="submit">{saved ? 'Saved' : 'Save settings'}</button>
</form>

<h3>Platform features</h3>
<ul class="features">
  <li>Ingestion folder: <strong>{data.features.ingestion ? 'on' : 'off'}</strong></li>
  <li>Face suggestions: <strong>{data.features.faces ? 'on' : 'off'}</strong></li>
  <li>Server derivatives &amp; export: <strong>{data.features.serverDerivatives ? 'on' : 'off'}</strong></li>
</ul>
<p class="note">Feature flags come from the deployment platform and are read-only here.</p>

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 16px; }
  h3 { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 34px 0 8px; opacity: var(--chrome-opacity, 0.5); }
  form { display: flex; flex-direction: column; gap: 18px; max-width: 460px; }
  .stack { display: flex; flex-direction: column; gap: 6px; font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
  input:not([type='checkbox']) { min-height: 48px; border: none; background: color-mix(in srgb, currentColor 8%, transparent); color: inherit; font-family: var(--serif); font-size: 17px; padding: 0 12px; }
  fieldset { border: none; margin: 0; padding: 0; }
  legend { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 10px; min-height: 48px; font-family: var(--serif); font-size: 17px; }
  input[type='checkbox'] { width: 22px; height: 22px; }
  button { min-height: 48px; border: none; align-self: start; padding: 0 20px; font-family: var(--sans); font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; background: color-mix(in srgb, currentColor 12%, transparent); color: inherit; cursor: pointer; }
  .features { list-style: none; margin: 0; padding: 0; font-family: var(--serif); font-size: 16px; }
  .features li { min-height: 32px; }
  .note { font-family: var(--sans); font-size: 13px; opacity: var(--chrome-opacity, 0.5); }
  :is(input, button):focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

`src/routes/admin/jobs/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';
import { listJobs } from '$lib/server/admin-jobs';

export const load: PageServerLoad = async ({ locals }) => {
  requireRole(locals, 'admin');
  return { jobs: await listJobs(locals.db) };
};
```

`src/routes/admin/jobs/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const failed = $derived(data.jobs.filter((j) => j.status === 'failed'));
  const active = $derived(data.jobs.filter((j) => j.status !== 'failed'));

  function pretty(payload: string): string {
    try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload; }
  }
  function reason(payload: string): string | null {
    try { return (JSON.parse(payload) as { reason?: string }).reason ?? null; } catch { return null; }
  }
  async function retry(id: string) {
    await fetch(`/api/admin/jobs/${id}/retry`, { method: 'POST' });
    await invalidateAll();
  }
</script>

<h2>Jobs</h2>

<h3>Failed</h3>
{#if failed.length === 0}
  <p class="empty">No failed jobs.</p>
{:else}
  <ul>
    {#each failed as j (j.id)}
      <li data-testid="failed-job">
        <div class="head">
          <span class="kind">{j.kind}</span>
          <span class="meta">{j.attempts} attempts · {new Date(j.createdAt).toLocaleString()}</span>
          {#if reason(j.payload)}<span class="reason">{reason(j.payload)}</span>{/if}
          <button onclick={() => retry(j.id)}>Retry</button>
        </div>
        <pre>{pretty(j.payload)}</pre>
      </li>
    {/each}
  </ul>
{/if}

<h3>Pending / running</h3>
{#if active.length === 0}
  <p class="empty">Queue is clear.</p>
{:else}
  <ul>
    {#each active as j (j.id)}
      <li>
        <div class="head">
          <span class="kind">{j.kind}</span>
          <span class="meta">{j.status} · runs {new Date(j.runAfter).toLocaleString()}</span>
        </div>
        <pre>{pretty(j.payload)}</pre>
      </li>
    {/each}
  </ul>
{/if}

<style>
  h2 { font-family: var(--serif); font-weight: 500; font-size: 26px; margin: 0 0 16px; }
  h3 { font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 24px 0 8px; opacity: var(--chrome-opacity, 0.5); }
  .empty { font-family: var(--serif); font-size: 16px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-height: 48px; }
  .kind { font-family: var(--sans); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; }
  .meta { font-family: var(--sans); font-size: 13px; opacity: var(--chrome-opacity, 0.5); }
  .reason { font-family: var(--serif); font-size: 15px; font-weight: 600; }
  pre { overflow-x: auto; font-size: 12px; background: color-mix(in srgb, currentColor 8%, transparent); padding: 10px; margin: 6px 0 0; }
  button { min-height: 48px; border: none; font-family: var(--sans); font-size: 13px; background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; padding: 0 14px; cursor: pointer; }
  button:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

(Failed ingest scans surface here automatically: phase 07 writes `{ path, reason }` into the `ingest_scan` job payload when a file lands in `/ingest/_failed`, and the `reason()` helper lifts it into the row header.)

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run src/lib/server/admin-settings.test.ts src/lib/server/admin-jobs.test.ts && pnpm check`
Expected: PASS.

```bash
git add src/lib/server/admin-settings.* src/lib/server/admin-jobs.* src/routes/api/admin/settings src/routes/api/admin/jobs src/routes/admin/settings src/routes/admin/jobs
git commit -m "feat: admin settings (site name, holiday set, feature readout) and jobs retry"
```

---

### Task 13: `/profile` — username/password (re-auth), accent picker, theme, comfort, linked person

**Files:**
- Create: `src/lib/server/profile.ts`
- Test: `src/lib/server/profile.test.ts`
- Create: `src/routes/profile/+page.server.ts`
- Create: `src/routes/profile/+page.svelte`

**Interfaces:**
- Consumes: `users`, `people` tables; `hashPassword`/`verifyPassword`; `ACCENTS` from `$lib/ui/tokens`; `theme`/`comfort` stores (phase 01 — the root layout already syncs them from `locals.user`, so after `invalidateAll()` the new accent/theme/comfort apply everywhere).
- Produces:
  - `changeUsername(db: Db, userId: string, currentPassword: string, newUsername: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `changePassword(db: Db, userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `updateAppearance(db: Db, userId: string, prefs: { accentColor?: string; theme?: 'system' | 'dark' | 'light'; comfortMode?: boolean }): Promise<void>` (rejects accents not in `ACCENTS`)
  - `/profile` page with form actions `?/username`, `?/password`, `?/appearance`. Accent swatches carry `data-accent="<hex>"` (e2e hook).

- [ ] **Step 1: Write the failing test**

`src/lib/server/profile.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './db/test-db';
import { users } from './db/schema';
import { hashPassword, verifyPassword } from './auth';
import { changePassword, changeUsername, updateAppearance } from './profile';
import type { Db } from './db';

let db: Db;
const UID = 'u_me0000000001';

beforeEach(async () => {
  db = await makeTestDb();
  const now = new Date();
  await db.insert(users).values([
    { id: UID, username: 'me', passwordHash: await hashPassword('current-pw'), role: 'user', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: now },
    { id: 'u_other0000001', username: 'taken', passwordHash: 'x', role: 'user', accentColor: '#FFD700', personId: null, comfortMode: false, theme: 'system', createdAt: now }
  ]);
});

describe('changeUsername', () => {
  it('requires the current password', async () => {
    expect(await changeUsername(db, UID, 'wrong', 'newname')).toEqual({ ok: false, error: 'Your current password is not right.' });
  });
  it('rejects taken and invalid usernames', async () => {
    expect((await changeUsername(db, UID, 'current-pw', 'taken')).ok).toBe(false);
    expect((await changeUsername(db, UID, 'current-pw', 'a')).ok).toBe(false);
  });
  it('changes the username', async () => {
    expect(await changeUsername(db, UID, 'current-pw', 'grandkid')).toEqual({ ok: true });
    expect((await db.select().from(users).where(eq(users.id, UID)))[0].username).toBe('grandkid');
  });
});

describe('changePassword', () => {
  it('requires the current password and a sane new one', async () => {
    expect((await changePassword(db, UID, 'wrong', 'longenough1')).ok).toBe(false);
    expect((await changePassword(db, UID, 'current-pw', 'short')).ok).toBe(false);
  });
  it('re-hashes', async () => {
    expect(await changePassword(db, UID, 'current-pw', 'my new password')).toEqual({ ok: true });
    const row = (await db.select().from(users).where(eq(users.id, UID)))[0];
    expect(await verifyPassword('my new password', row.passwordHash)).toBe(true);
  });
});

describe('updateAppearance', () => {
  it('sets accent/theme/comfort', async () => {
    await updateAppearance(db, UID, { accentColor: '#FFD700', theme: 'dark', comfortMode: true });
    const row = (await db.select().from(users).where(eq(users.id, UID)))[0];
    expect(row.accentColor).toBe('#FFD700');
    expect(row.theme).toBe('dark');
    expect(row.comfortMode).toBe(true);
  });
  it('rejects an accent outside ACCENTS', async () => {
    await expect(updateAppearance(db, UID, { accentColor: '#123456' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/profile.test.ts`
Expected: FAIL — `Cannot find module './profile'`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/profile.ts`:

```ts
import { eq } from 'drizzle-orm';
import { users } from './db/schema';
import { hashPassword, verifyPassword } from './auth';
import { ACCENTS } from '$lib/ui/tokens';
import type { Db } from './db';

type Result = { ok: true } | { ok: false; error: string };

async function reauth(db: Db, userId: string, currentPassword: string): Promise<Result> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) return { ok: false, error: 'Account not found.' };
  if (!(await verifyPassword(currentPassword, rows[0].passwordHash))) {
    return { ok: false, error: 'Your current password is not right.' };
  }
  return { ok: true };
}

export async function changeUsername(db: Db, userId: string, currentPassword: string, newUsername: string): Promise<Result> {
  const auth = await reauth(db, userId, currentPassword);
  if (!auth.ok) return auth;
  const name = newUsername.trim();
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(name)) {
    return { ok: false, error: 'Usernames are 2–32 letters, numbers, dots, dashes.' };
  }
  const clash = await db.select({ id: users.id }).from(users).where(eq(users.username, name)).limit(1);
  if (clash[0] && clash[0].id !== userId) return { ok: false, error: 'That username is taken.' };
  await db.update(users).set({ username: name }).where(eq(users.id, userId));
  return { ok: true };
}

export async function changePassword(db: Db, userId: string, currentPassword: string, newPassword: string): Promise<Result> {
  const auth = await reauth(db, userId, currentPassword);
  if (!auth.ok) return auth;
  if (newPassword.length < 8) return { ok: false, error: 'New password needs at least 8 characters.' };
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, userId));
  return { ok: true };
}

export async function updateAppearance(
  db: Db,
  userId: string,
  prefs: { accentColor?: string; theme?: 'system' | 'dark' | 'light'; comfortMode?: boolean }
): Promise<void> {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (prefs.accentColor !== undefined) {
    if (!ACCENTS.some((a) => a.hex === prefs.accentColor)) throw new Error('Accent must be one of the curated set.');
    patch.accentColor = prefs.accentColor;
  }
  if (prefs.theme !== undefined) patch.theme = prefs.theme;
  if (prefs.comfortMode !== undefined) patch.comfortMode = prefs.comfortMode;
  if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/profile.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Page server (load + actions)**

`src/routes/profile/+page.server.ts`:

```ts
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { people } from '$lib/server/db/schema';
import { changePassword, changeUsername, updateAppearance } from '$lib/server/profile';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Sign in to see your profile.');
  const person = locals.user.personId
    ? (await locals.db.select({ id: people.id, name: people.name }).from(people)
        .where(eq(people.id, locals.user.personId)).limit(1))[0] ?? null
    : null;
  return { user: locals.user, person };
};

export const actions: Actions = {
  username: async ({ locals, request }) => {
    if (!locals.user) throw error(401);
    const form = await request.formData();
    const res = await changeUsername(
      locals.db, locals.user.id,
      String(form.get('currentPassword') ?? ''), String(form.get('username') ?? '')
    );
    return res.ok ? { section: 'username', saved: true } : fail(400, { section: 'username', message: res.error });
  },
  password: async ({ locals, request }) => {
    if (!locals.user) throw error(401);
    const form = await request.formData();
    const res = await changePassword(
      locals.db, locals.user.id,
      String(form.get('currentPassword') ?? ''), String(form.get('newPassword') ?? '')
    );
    return res.ok ? { section: 'password', saved: true } : fail(400, { section: 'password', message: res.error });
  },
  appearance: async ({ locals, request }) => {
    if (!locals.user) throw error(401);
    const form = await request.formData();
    try {
      await updateAppearance(locals.db, locals.user.id, {
        accentColor: String(form.get('accentColor') ?? '') || undefined,
        theme: (String(form.get('theme') ?? '') || undefined) as 'system' | 'dark' | 'light' | undefined,
        comfortMode: form.get('comfortMode') != null ? form.get('comfortMode') === 'on' : undefined
      });
    } catch (e) {
      return fail(400, { section: 'appearance', message: e instanceof Error ? e.message : 'Invalid preference' });
    }
    return { section: 'appearance', saved: true };
  }
};
```

- [ ] **Step 6: Page UI**

`src/routes/profile/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { ACCENTS } from '$lib/ui/tokens';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let accent = $state(data.user.accentColor);

  const afterSave = () => async ({ update }: { update: () => Promise<void> }) => {
    await update();
    await invalidateAll(); // root layout re-syncs theme/comfort/accent stores
  };
</script>

<main class="profile">
  <h1>Your profile</h1>

  <section>
    <h2>Username</h2>
    <form method="POST" action="?/username" use:enhance={afterSave}>
      <label>New username <input name="username" value={data.user.username} required /></label>
      <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
      {#if form?.section === 'username' && form.message}<p class="error" role="alert">{form.message}</p>{/if}
      {#if form?.section === 'username' && form.saved}<p class="ok">Saved.</p>{/if}
      <button type="submit">Change username</button>
    </form>
  </section>

  <section>
    <h2>Password</h2>
    <form method="POST" action="?/password" use:enhance={afterSave}>
      <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
      <label>New password <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required /></label>
      {#if form?.section === 'password' && form.message}<p class="error" role="alert">{form.message}</p>{/if}
      {#if form?.section === 'password' && form.saved}<p class="ok">Saved.</p>{/if}
      <button type="submit">Change password</button>
    </form>
  </section>

  <section>
    <h2>Appearance &amp; comfort</h2>
    <form method="POST" action="?/appearance" use:enhance={afterSave}>
      <fieldset class="swatches">
        <legend>Your accent</legend>
        {#each ACCENTS as a (a.hex)}
          <label class="swatch" style={`background:${a.hex}`}>
            <input type="radio" name="accentColor" value={a.hex} bind:group={accent} data-accent={a.hex} />
            <span class="sr-only">{a.hex}</span>
          </label>
        {/each}
      </fieldset>
      <fieldset>
        <legend>Theme</legend>
        <label class="row"><input type="radio" name="theme" value="system" checked={data.user.theme === 'system'} /> System</label>
        <label class="row"><input type="radio" name="theme" value="dark" checked={data.user.theme === 'dark'} /> Dark</label>
        <label class="row"><input type="radio" name="theme" value="light" checked={data.user.theme === 'light'} /> Light</label>
      </fieldset>
      <label class="row">
        <input type="checkbox" name="comfortMode" checked={data.user.comfortMode} data-testid="comfort-toggle" />
        Comfort mode — bigger type, calmer screen
      </label>
      {#if form?.section === 'appearance' && form.message}<p class="error" role="alert">{form.message}</p>{/if}
      <button type="submit">Save appearance</button>
    </form>
  </section>

  <section>
    <h2>Your person</h2>
    {#if data.person}
      <p>Linked to <strong>{data.person.name}</strong>.</p>
      <a class="button" href={`/people/${data.person.id}`}>Edit my bio</a>
    {:else}
      <p>Not linked to a person yet — an admin can link you from the admin page.</p>
    {/if}
  </section>
</main>

<style>
  .profile { width: min(680px, 100%); margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-family: var(--serif, Georgia); font-weight: 500; font-size: 40px; margin: 0 0 18px; }
  h2 { font-family: var(--serif, Georgia); font-weight: 500; font-size: 24px; margin: 34px 0 12px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 6px; font-family: var(--sans, sans-serif); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; }
  input:not([type='radio']):not([type='checkbox']) { min-height: 48px; border: none; background: color-mix(in srgb, currentColor 8%, transparent); color: inherit; font-family: var(--serif, Georgia); font-size: 17px; padding: 0 12px; }
  .row { flex-direction: row; align-items: center; gap: 10px; min-height: 48px; font-family: var(--serif, Georgia); font-size: 17px; text-transform: none; letter-spacing: 0; }
  input[type='radio'], input[type='checkbox'] { width: 22px; height: 22px; }
  fieldset { border: none; margin: 0; padding: 0; }
  legend { font-family: var(--sans, sans-serif); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 8px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 10px; }
  .swatch { position: relative; width: 48px; height: 48px; cursor: pointer; }
  .swatch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0.001; cursor: pointer; }
  .swatch:has(input:checked) { outline: 3px solid currentColor; outline-offset: 3px; }
  .swatch:has(input:focus-visible) { outline: 3px solid currentColor; outline-offset: 3px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  button, .button { min-height: 48px; display: inline-flex; align-items: center; align-self: start; border: none; padding: 0 20px; font-family: var(--sans, sans-serif); font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; background: color-mix(in srgb, currentColor 12%, transparent); color: inherit; cursor: pointer; text-decoration: none; }
  .error { font-family: var(--sans, sans-serif); font-size: 14px; font-weight: 700; margin: 0; }
  .ok { font-family: var(--sans, sans-serif); font-size: 14px; margin: 0; }
  :is(input, button, .button):focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
</style>
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run src/lib/server/profile.test.ts && pnpm check`
Expected: PASS.

Manual: change accent → after save, nav monogram/comment usernames pick up the new color (layout re-sync); wrong current password → inline error; comfort checkbox toggles `html.comfort` after save.

```bash
git add src/lib/server/profile.ts src/lib/server/profile.test.ts src/routes/profile
git commit -m "feat: profile page with re-authed credential changes and appearance prefs"
```

---

### Task 14: Comfort-mode polish pass (audit + fixes + axe e2e)

**Files:**
- Modify: `src/app.css` (comfort rule block)
- Modify: `src/lib/ui/MediaCard.svelte` (hover-scrub → click-to-cycle under comfort)
- Audit-modify (small diffs, listed below): `src/lib/ui/Nav.svelte`, `src/lib/ui/Player.svelte`, `src/lib/ui/YearBand.svelte`, `src/lib/ui/Gradient.svelte`
- Create: `e2e/comfort-a11y.spec.ts`
- Modify: `package.json` (dev dep)

**Interfaces:**
- Consumes: `comfort` store (`$lib/ui/theme`); the `html.comfort` class (phase 01's theme.ts applies it from `user.comfortMode`); `--chrome-opacity` CSS custom property (introduced here, consumed by every component that renders half-opacity chrome).
- Produces: the comfort contract the e2e enforces — `html.comfort` ⇒ base type 125%, interactive targets ≥ 48px, zero animation, chrome opacity 0.75.

- [ ] **Step 1: Install the a11y scanner**

```bash
pnpm add -D @axe-core/playwright
```

- [ ] **Step 2: Add the comfort CSS block**

Append to `src/app.css`:

```css
/* ─── Comfort mode (phase 08) ──────────────────────────────────────────
   Master Contract 4: html.comfort → type 112.5% → 125%, motion off,
   chrome opacity raised. Base html font-size is 112.5% (18px, phase 01);
   comfort raises it to 125% (20px). */

:root {
  --chrome-opacity: 0.5; /* captions, eyebrows, wordmarks, secondary chrome */
}

html.comfort {
  font-size: 125%;
  --chrome-opacity: 0.75;
}

/* Kill ALL motion: crossfades, gradient drift, springs. */
html.comfort *,
html.comfort *::before,
html.comfort *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}

/* Hit areas ≥ 48px on real controls (inline prose links excluded). */
html.comfort :is(button, [role='button'], select, input:not([type='checkbox']):not([type='radio'])) {
  min-height: 48px;
}
html.comfort nav a {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
}
html.comfort input[type='checkbox'],
html.comfort input[type='radio'] {
  width: 28px;
  height: 28px;
}
```

- [ ] **Step 3: Audit checklist — apply each fix, with its acceptance check**

Work through this list; each line is a concrete change plus how to verify it (dev server, toggle comfort on `/profile`):

1. **Chrome opacity variable.** Grep: `rg -n 'opacity:\s*0?\.5' src/lib/ui src/routes` — every *text chrome* hit (MediaCard caption row, MonthBreak eyebrow, Nav secondary links, Player eyebrow/timecode, share wordmarks already done) becomes `opacity: var(--chrome-opacity, 0.5);`. Decorative grain overlays stay at literal 0.5. Acceptance: with comfort on, caption text visibly darkens/brightens (0.75), and a spot-check with the browser picker shows contrast ≥ 4.5:1 in both themes.
2. **Hover-scrub → click-to-cycle** in `src/lib/ui/MediaCard.svelte`. Import `comfort` from `$lib/ui/theme`. Gate the phase 03/07 pointermove scrub handler with `if ($comfort) return;`. Add a click-to-cycle affordance: when `$comfort && sprite` is available, render a 48×48 sharp button overlaid bottom-left of the frame labeled `Preview` (sans, 11px, uppercase) whose `onclick` (with `event.stopPropagation()`) advances the sprite frame by one tenth of the sheet per press, wrapping; the card's own click still opens the item. Acceptance: comfort on — moving the mouse over a video card does NOT scrub; pressing Preview steps frames; pressing the card opens the player.
3. **Crossfades/drift.** `src/lib/ui/Gradient.svelte` gates its decade crossfade and drift on the `reducedMotion` store (phase 03). Extend the gate to `reducedMotion || comfort`: `const still = $derived($reducedMotion || $comfort);` and use `still` wherever `$reducedMotion` alone gated animation. Acceptance: comfort on — sliding years swaps rooms instantly, no drift.
4. **Nav/Player/YearBand targets.** With comfort on, use the browser inspector to confirm every control in `Nav.svelte`, `Player.svelte` (play, Vol/1×/Full text buttons), and `YearBand.svelte` steppers measures ≥ 48px on its shorter axis; where a component's own CSS caps a height below 48px, add a `:global(html.comfort) & { min-height: 48px; }` override in that component rather than fighting specificity from app.css.
5. **Simplified chrome.** In comfort mode the timeline's neighbor-year ghosts and any decorative hairlines drop: add `html.comfort`-scoped rules in `YearBand.svelte`/`CenturyRail.svelte` hiding fade-out neighbor years (`display: none` on the flanking ghost numerals) — the stepper arrows and active year remain. Acceptance: comfort on — year band shows one big year + two 44px+ arrows.

- [ ] **Step 4: Write the axe e2e**

`e2e/comfort-a11y.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { OWNER, seedBasicArchive, signIn } from './helpers';

let seeded: { albumId: string; itemIds: string[]; personId: string };

test.beforeAll(async ({ request }) => {
  seeded = await seedBasicArchive(request);
});

test.describe('comfort mode', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, OWNER.username, OWNER.password);
    // turn comfort on via the profile page
    await page.goto('/profile');
    const toggle = page.getByTestId('comfort-toggle');
    if (!(await toggle.isChecked())) await toggle.check();
    await page.getByRole('button', { name: /save appearance/i }).click();
    await expect(page.locator('html.comfort')).toHaveCount(1);
  });

  test('type scale and hit areas', async ({ page }) => {
    await page.goto('/');
    const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(fontSize).toBe('20px'); // 125% of 16px browser default
    const chrome = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--chrome-opacity').trim()
    );
    expect(chrome).toBe('0.75');
    // every visible button ≥ 48px tall
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .filter((b) => b.getBoundingClientRect().height < 48)
        .map((b) => b.textContent?.trim())
    );
    expect(tooSmall).toEqual([]);
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`axe scan, ${scheme} theme: timeline, player, person, search`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const targets = ['/', `/item/${seeded.itemIds[0]}`, `/people/${seeded.personId}`, '/search'];
      for (const path of targets) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious, `${path} (${scheme}): ${serious.map((v) => v.id).join(', ')}`).toEqual([]);
      }
    });
  }

  test('no hover-scrub under comfort; preview click cycles', async ({ page }) => {
    await page.goto('/');
    const videoCard = page.locator('[data-type="video"]').first();
    if ((await videoCard.count()) > 0) {
      await videoCard.hover();
      // hover must not start a scrub: the scrub hairline stays hidden
      await expect(videoCard.locator('.scrub-hairline')).toHaveCount(0);
    }
  });
});
```

(If phase 03's MediaCard uses different hooks than `[data-type="video"]` / `.scrub-hairline`, use its actual selectors — add `data-type={item.type}` to the card root in Step 3.2 if it is missing.)

- [ ] **Step 5: Run the e2e**

Run: `pnpm exec playwright test e2e/comfort-a11y.spec.ts`
Expected: PASS — 4 tests (1 scale/hit-area + 2 axe themes + 1 scrub; plus the beforeAll seed). Fix any surfaced axe violation at its source component (contrast issues usually mean a missed `--chrome-opacity` conversion) and re-run until zero serious/critical.

- [ ] **Step 6: Commit**

```bash
pnpm check && pnpm vitest run
git add src/app.css src/lib/ui e2e/comfort-a11y.spec.ts package.json pnpm-lock.yaml
git commit -m "feat: comfort mode polish pass with axe-verified type, targets, motion, contrast"
```

---
### Task 15: Album export — streaming zip (node) / 501 (cloudflare)

**Files:**
- Create: `src/lib/server/platform/node-export.ts` (node-only carve-out per Global Constraints — this path is allowed to import `node:*`)
- Create: `src/routes/api/albums/[id]/export/+server.ts`
- Test: `src/routes/api/albums/[id]/export/server.test.ts`
- Modify: `src/routes/albums/[id]/+page.server.ts` (+ `canExport` flag), `src/routes/albums/[id]/+page.svelte` (button)
- Modify: `package.json` (deps)

**Interfaces:**
- Consumes: `listAlbumItemDTOs` (assumed, phase 05); `albums`, `albumItems`, `itemFiles` tables; `StorageAdapter.get` (Contract 2); `platform.features.serverDerivatives` (Contract 2 — the export gate; see Ambiguities: `Platform.features` is closed, so no new flag).
- Produces:
  - `GET /api/albums/[id]/export` (role **user**+): node → `200 application/zip` streaming `originals/<itemId>.<ext>` + `metadata.json` (`{ album: { id, title, description, exportedAt }, items: ItemDTO[] }`); cloudflare → `501 { reason: 'export requires the Docker deployment' }`
  - `exportAlbumZip(db: Db, storage: StorageAdapter, albumId: string): Promise<Response>` in `node-export.ts`

- [ ] **Step 1: Install archiver**

```bash
pnpm add archiver && pnpm add -D @types/archiver
```

- [ ] **Step 2: Write the failing test**

`src/routes/api/albums/[id]/export/server.test.ts` (runs under the node vitest environment; it exercises the real archiver stream):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { makeTestDb } from '$lib/server/db/test-db';
import { albumItems, albums, itemFiles, items, users } from '$lib/server/db/schema';
import type { Db } from '$lib/server/db';
import { GET } from './+server';

let db: Db;
const OWNER_ID = 'u_owner0000001';
const user = { id: OWNER_ID, username: 'gran', role: 'user', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system' } as const;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);
const storage = {
  put: vi.fn(), head: vi.fn(), delete: vi.fn(),
  get: vi.fn(async (key: string) =>
    key === 'media/it_1/original.jpg'
      ? { stream: new Blob([JPEG]).stream(), size: JPEG.length, contentType: 'image/jpeg' }
      : null
  ),
  mediaUrl: vi.fn(async (k: string) => `/media/${k}`)
};

function ev(features: { serverDerivatives: boolean }, params = { id: 'al_1' }) {
  return {
    locals: {
      db, user, shareTokens: [],
      platform: { name: features.serverDerivatives ? 'node' : 'cloudflare', storage, queue: { enqueue: vi.fn() }, features: { ingestion: false, faces: false, ...features } }
    },
    params
  } as never;
}

beforeEach(async () => {
  db = await makeTestDb();
  const now = new Date();
  await db.insert(users).values({ id: OWNER_ID, username: 'gran', passwordHash: 'x', role: 'owner', accentColor: '#FA7B62', personId: null, comfortMode: false, theme: 'system', createdAt: now });
  await db.insert(items).values({ id: 'it_1', type: 'photo', title: 'Porch', description: null, dateStart: '1994-06-14', dateEnd: '1994-06-14', datePrecision: 'day', sortDate: '1994-06-14', duration: null, width: 8, height: 8, sizeBytes: JPEG.length, sha256: 'a'.repeat(64), source: 'upload', tapeLabel: null, status: 'ready', uploadedBy: OWNER_ID, deletedAt: null, createdAt: now });
  await db.insert(itemFiles).values([
    { id: 'if_1', itemId: 'it_1', kind: 'original', storageKey: 'media/it_1/original.jpg', mime: 'image/jpeg', width: 8, height: 8 },
    { id: 'if_2', itemId: 'it_1', kind: 'thumb_800', storageKey: 'media/it_1/thumb_800.webp', mime: 'image/webp', width: 8, height: 8 }
  ]);
  await db.insert(albums).values({ id: 'al_1', title: 'Summer 94', description: null, coverItemId: null, createdBy: OWNER_ID, createdAt: now, deletedAt: null });
  await db.insert(albumItems).values({ albumId: 'al_1', itemId: 'it_1', position: 0 });
});

describe('GET /api/albums/[id]/export', () => {
  it('501s on platforms without server derivatives (cloudflare)', async () => {
    const res = await GET(ev({ serverDerivatives: false }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ reason: 'export requires the Docker deployment' });
  });

  it('streams a zip with the original and metadata.json on node', async () => {
    const res = await GET(ev({ serverDerivatives: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('.zip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('metadata.json');
    expect(text).toContain('originals/it_1.jpg');
  });

  it('404s a missing or deleted album', async () => {
    try { await GET(ev({ serverDerivatives: true }, { id: 'al_missing' })); expect.unreachable(); }
    catch (e) { expect(isHttpError(e) && e.status === 404).toBe(true); }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run "src/routes/api/albums/[id]/export/server.test.ts"`
Expected: FAIL — `Cannot find module './+server'`.

- [ ] **Step 4: Write the implementation**

`src/lib/server/platform/node-export.ts` (complete file — node-only; never imported statically from portable code):

```ts
import archiver from 'archiver';
import { PassThrough, Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { albumItems, albums, itemFiles } from '../db/schema';
import { listAlbumItemDTOs } from '../items';
import type { Db } from '../db';
import type { StorageAdapter } from './types';

function extOf(storageKey: string): string {
  const dot = storageKey.lastIndexOf('.');
  return dot === -1 ? '' : storageKey.slice(dot);
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'album';
}

export async function exportAlbumZip(db: Db, storage: StorageAdapter, albumId: string): Promise<Response> {
  const albumRows = await db.select().from(albums)
    .where(and(eq(albums.id, albumId), isNull(albums.deletedAt))).limit(1);
  const album = albumRows[0];
  if (!album) throw error(404, 'Album not found');

  const dtos = await listAlbumItemDTOs(db, storage, albumId);
  const memberIds = (await db.select({ itemId: albumItems.itemId }).from(albumItems)
    .where(eq(albumItems.albumId, albumId))).map((r) => r.itemId);
  const originals = memberIds.length
    ? await db.select().from(itemFiles)
        .where(and(inArray(itemFiles.itemId, memberIds), eq(itemFiles.kind, 'original')))
    : [];

  const archive = archiver('zip', { store: true }); // originals are already compressed media
  const out = new PassThrough();
  archive.pipe(out);

  archive.append(
    JSON.stringify(
      { album: { id: album.id, title: album.title, description: album.description, exportedAt: new Date().toISOString() }, items: dtos },
      null,
      2
    ),
    { name: 'metadata.json' }
  );

  // Append originals lazily, one storage stream at a time, then finalize.
  // Errors reject the output stream so the HTTP response aborts cleanly.
  void (async () => {
    try {
      for (const f of originals) {
        const obj = await storage.get(f.storageKey);
        if (!obj) continue; // missing object: skip, metadata still lists the item
        archive.append(Readable.fromWeb(obj.stream as never), { name: `originals/${f.itemId}${extOf(f.storageKey)}` });
      }
      await archive.finalize();
    } catch (err) {
      archive.abort();
      out.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return new Response(Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${slug(album.title)}.zip"`,
      'cache-control': 'no-store'
    }
  });
}
```

`src/routes/api/albums/[id]/export/+server.ts` (complete file — the dynamic import keeps archiver/`node:stream` out of the Cloudflare bundle):

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/roles';

export const GET: RequestHandler = async ({ locals, params }) => {
  requireRole(locals, 'user'); // spec §3/§14: originals are archival copies, any member may take out
  if (!locals.platform.features.serverDerivatives) {
    return json({ reason: 'export requires the Docker deployment' }, { status: 501 });
  }
  const { exportAlbumZip } = await import('$lib/server/platform/node-export');
  return exportAlbumZip(locals.db, locals.platform.storage, params.id);
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run "src/routes/api/albums/[id]/export/server.test.ts"`
Expected: PASS — 3 tests.

Also verify the CF bundle stays clean: `PLATFORM=cloudflare pnpm build:cf`
Expected: build succeeds (dynamic import is code-split; if the CF adapter still tries to resolve `node:stream`, add `external: ['archiver']` handling by marking the module with `/* @vite-ignore */` on the import expression — keep the 501 short-circuit either way).

- [ ] **Step 6: Album page button**

Modify `src/routes/albums/[id]/+page.server.ts` — add to the object its `load` already returns:

```ts
canExport: locals.platform.features.serverDerivatives,
```

Modify `src/routes/albums/[id]/+page.svelte` — next to the Share button mounted in Task 7:

```svelte
{#if data.canExport && data.user}
  <a class="export" data-testid="export-button" href={`/api/albums/${data.album.id}/export`} download>
    Export album
  </a>
{/if}
```

with the same action-row styling as the Share button (sans, uppercase, min-height 48px). On Cloudflare deployments `canExport` is `false` and the button never renders — the UI gate the prompt requires (`platform.features.serverDerivatives === false` hides it).

- [ ] **Step 7: Commit**

```bash
pnpm check
git add src/lib/server/platform/node-export.ts "src/routes/api/albums/[id]/export" "src/routes/albums/[id]" package.json pnpm-lock.yaml
git commit -m "feat: streaming album zip export on node, 501 + hidden button on cloudflare"
```

---

### Task 16: Phase e2e — share flows, rate limit, expiry, trash restore, accent reflection

**Files:**
- Create: `e2e/sharing-admin.spec.ts`

**Interfaces:**
- Consumes: `e2e/helpers` (`OWNER`, `signIn`, `seedBasicArchive` — see assumed-interfaces table); every surface built in Tasks 1–15; `data-testid` hooks: `share-button`, `share-link`, `share-download`, `share-wordmark`, `trash-item`, `comfort-toggle` (Task 14 spec covers comfort).
- Produces: phase 08's golden-path proof. (Comfort + axe already proven by `e2e/comfort-a11y.spec.ts` in Task 14.)

- [ ] **Step 1: Write the spec**

`e2e/sharing-admin.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { OWNER, seedBasicArchive, signIn } from './helpers';

let seeded: { albumId: string; itemIds: string[]; personId: string };

test.beforeAll(async ({ request }) => {
  seeded = await seedBasicArchive(request);
});

async function createShareViaApi(
  page: Page,
  body: { targetType: 'album' | 'item'; targetId: string; password?: string; expiry?: string; allowDownload?: boolean }
): Promise<{ token: string; id: string }> {
  const res = await page.request.post('/api/shares', { data: body });
  expect(res.status()).toBe(201);
  const out = await res.json();
  return { token: out.share.token, id: out.share.id };
}

test.describe('public shares', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, OWNER.username, OWNER.password);
  });

  test('password gate → read-only gallery, media loads, no nav, no comments', async ({ page, browser }) => {
    // create via the UI dialog (exercises Task 7)
    await page.goto(`/albums/${seeded.albumId}`);
    await page.getByTestId('share-button').click();
    await page.getByLabel(/require a password/i).check();
    await page.getByPlaceholder('Password').fill('cranberry');
    await page.getByRole('button', { name: /create share link/i }).click();
    const url = await page.getByTestId('share-link').inputValue();
    expect(url).toContain('/share/');

    // incognito: fresh context, no session cookie
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto(url);
    await expect(anon.getByRole('heading', { name: /protected/i })).toBeVisible();
    await expect(anon.locator('nav')).toHaveCount(0);

    await anon.getByLabel('Password').fill('cranberry');
    const mediaResponse = anon.waitForResponse((r) => r.url().includes('/media/') && r.status() === 200);
    await anon.getByRole('button', { name: /open/i }).click();

    // gallery renders read-only
    await expect(anon.getByTestId('share-wordmark')).toBeVisible();
    await expect(anon.locator('img').first()).toBeVisible();
    await mediaResponse; // signed-out media request authorized by the share cookie
    await expect(anon.locator('nav')).toHaveCount(0);
    await expect(anon.getByPlaceholder('Add a memory…')).toHaveCount(0);
    await anonCtx.close();
  });

  test('wrong password ×6 hits the rate limit', async ({ page, browser }) => {
    const { token } = await createShareViaApi(page, { targetType: 'album', targetId: seeded.albumId, password: 'right-pw' });
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto(`/share/${token}`);
    for (let i = 0; i < 5; i++) {
      await anon.getByLabel('Password').fill('wrong-pw');
      await anon.getByRole('button', { name: /open/i }).click();
      await expect(anon.getByRole('alert')).toContainText(/not right/i);
    }
    await anon.getByLabel('Password').fill('wrong-pw');
    await anon.getByRole('button', { name: /open/i }).click();
    await expect(anon.getByRole('alert')).toContainText(/too many tries/i);
    await anonCtx.close();
  });

  test('expired share shows the expired page', async ({ page, browser }) => {
    const { token } = await createShareViaApi(page, { targetType: 'album', targetId: seeded.albumId, expiry: '2000-01-01' });
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto(`/share/${token}`);
    await expect(anon.getByRole('heading', { name: /expired/i })).toBeVisible();
    await anonCtx.close();
  });

  test('item share respects allowDownload', async ({ page, browser }) => {
    const withDl = await createShareViaApi(page, { targetType: 'item', targetId: seeded.itemIds[0], allowDownload: true });
    const withoutDl = await createShareViaApi(page, { targetType: 'item', targetId: seeded.itemIds[0] });
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto(`/share/${withDl.token}`);
    await expect(anon.getByTestId('share-download')).toBeVisible();
    await anon.goto(`/share/${withoutDl.token}`);
    await expect(anon.getByTestId('share-download')).toHaveCount(0);
    await anonCtx.close();
  });
});

test.describe('admin trash', () => {
  test('soft-deleted item appears in trash and restores', async ({ page }) => {
    await signIn(page, OWNER.username, OWNER.password);
    const itemId = seeded.itemIds[1] ?? seeded.itemIds[0];
    const del = await page.request.delete(`/api/items/${itemId}`);
    expect(del.ok()).toBeTruthy();

    await page.goto('/admin/trash');
    const row = page.getByTestId('trash-item').first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /restore/i }).click();
    await expect(page.getByTestId('trash-item')).toHaveCount(0);

    const back = await page.request.get(`/api/items/${itemId}`);
    expect(back.status()).toBe(200);
  });
});

test.describe('profile accent', () => {
  test('accent change reflects in a comment username color', async ({ page }) => {
    await signIn(page, OWNER.username, OWNER.password);
    const itemId = seeded.itemIds[0];

    // leave a memory
    await page.goto(`/item/${itemId}`);
    await page.getByPlaceholder('Add a memory…').fill('Accent check');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Accent check')).toBeVisible();

    // switch accent to gold
    await page.goto('/profile');
    await page.locator('[data-accent="#FFD700"]').check();
    await page.getByRole('button', { name: /save appearance/i }).click();

    // username on the comment now renders in the new accent
    await page.goto(`/item/${itemId}`);
    const username = page
      .locator(`text=${OWNER.username}`)
      .locator('visible=true')
      .last();
    await expect(username).toHaveCSS('color', 'rgb(255, 215, 0)');
  });
});
```

(If the phase 05 comment form submits via a button instead of Enter, use `page.getByRole('button', { name: /add/i }).click()` — match the shipped comments UI. The username-color assertion targets the comment header element phase 05 renders with the author's accent; scope the locator to the comments rail if the username also appears in the nav account block.)

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/sharing-admin.spec.ts`
Expected: PASS — 6 tests. Debug failures with `--headed --debug`; the most likely drift points are the phase-01 login selectors inside `signIn` and the comment submit interaction, both of which live in earlier-phase code — adapt the spec's selectors, never the app, unless a real bug surfaces.

- [ ] **Step 3: Full phase gate and commit**

Run: `pnpm check && pnpm vitest run && pnpm exec playwright test`
Expected: everything green — including phases 01–07 suites (no regressions) and `e2e/comfort-a11y.spec.ts`.

```bash
git add e2e/sharing-admin.spec.ts
git commit -m "test: e2e for share flows, rate limit, expiry, trash restore, accent reflection"
```

---

## Ambiguities resolved (decisions binding for this phase)

1. **Export gate = `features.serverDerivatives`.** Master Contract 2's `Platform.features` is closed (`{ ingestion, faces, serverDerivatives }`), so no `export` flag may be added. Export requires the node runtime (archiver + `node:stream`), which is exactly the deployment where `serverDerivatives` is true; the server 501s and the UI hides the button when `features.serverDerivatives === false`. If a future master revision adds a dedicated flag, only Task 15's two gate expressions change.
2. **No `trash_sweep` job kind.** Master Contract 1 fixes `jobs.kind ∈ {derivatives, sprite, ingest_scan, face_scan}` and the enum is closed. The 30-day sweep runs inline instead: `purgeExpired()` executes on every `/admin/trash` load and `emptyTrash()` covers the manual path. A nightly cron wrapper (calling the same `purgeExpired`) is deferred to phase 10's deployment notes. Rows past 30 days are already invisible to users (all reads filter `deleted_at`), so sweep latency only affects disk space.
3. **`resolveShare` result union gains `'rate_limited'`.** The phase brief lists `not_found | expired | password_required | wrong_password`; returning `wrong_password` for a limited attempt would leak whether a guess was correct and break the "wrong password ×6 → rate-limited" UX, so a fifth reason was added. It is a widening (new variant), not a change to any specified variant.
4. **`App.Locals` gains `shareTokens: string[]`.** Contract 2 fixes `user/platform/db` and the prompt fixes `canAccessMedia(locals, key)` — but share cookies live on the request, not in those three fields. The additive locals field (populated centrally in `hooks.server.ts`) keeps the seam signature exactly `canAccessMedia(locals, key)`. Recorded here because it extends (without altering) the master's `App.Locals` shape.
5. **Share revocation is a hard delete.** The `shares` table has no `deleted_at` column (closed schema) and a share link is an access grant, not family content, so the 30-day-trash constraint is read as not applying. Revoke = row delete (Task 1 `revokeShare`).
6. **Dedicated share components instead of reusing `Player.svelte`/`MasonryGrid.svelte`.** The public surface must carry zero nav/comments/edit affordances (spec §3); stripping those out of the app components would thread share-mode conditionals through phase 03/04 code. `src/lib/ui/share/*` reuses the same tokens, `ItemDTO`s and `/media` URLs, so visual language and data stay unified.
7. **Cross-phase helper names are declared assumptions.** `makeTestDb`, `getItemDTO`, `listAlbumItemDTOs`, `signIn`, `seedBasicArchive`, the `comfort` store, and phase 01's `/api/invites` body shape are consumed under the names in the assumed-interfaces table; executors reconcile against the shipped names before Task 1 and keep the shipped names when they differ. Master-contract signatures (`resolveShare`, shares schema, Contract 6 routes, `ItemDTO`) are not subject to this.
8. **Holiday ids must mirror `holidaysFor()`.** Task 12's `HOLIDAY_OPTIONS` ids (`newyear, easter, july4, halloween, thanksgiving, christmas`) must equal the strings phase 06's `holidaysFor()` emits, since `settings.holidaySet` filters them at write time; Task 12 Step 3 requires grepping `src/lib/domain/holidays.ts` and renaming to match if needed.

## Self-review record

- **Scope coverage:** shares service + rate limit (T1), Contract 6 `/api/shares` (T2), share-cookie media auth / `canAccessMedia` (T3), password gate + expired page (T4), read-only album room with masonry + viewer, wordmark, no nav (T5), single-item room (T6), share management dialog + download-original for share (T5/T6) and authenticated users (T7), admin: shell (T8), users incl. owner-gated role changes/reset/link/delete-reassign (T9), invites full UI + shares list (T10), trash restore + typed "empty the trash" + inline 30-day sweep (T11), settings (site name, holiday checkboxes, feature readout) + jobs w/ payload + retry + ingest-failure reasons (T12), profile (T13), comfort polish + axe (T14), export zip + 501/hidden-button gate (T15), phase e2e (T16). Spec §3/§10/§11/§12/§14 items for this phase all map to a task; faces and deployment files untouched.
- **Placeholder scan:** no TBD/TODO/"similar to Task N"; the two intentionally-deferred code regions (Task 4's `{:else}` interim branch, Task 5's `<!-- single-item share: Task 6 -->`) are each replaced by a later task in the same plan with full code.
- **Signature consistency:** `resolveShare(db, token, password?)` matches master Contract 7; `shares` columns match Contract 1 exactly; `/api/shares` role (editor) and `/api/admin/*`/`/api/invites` roles match Contract 6; `ItemDTO` field usage (`urls.thumb800/thumb1600/poster/original`, `date.dateStart`, `displayDate`, `shortDate`) matches the Contract 6 DTO; `ShareRecord`/`TrashLists`/`SiteSettings`/`JobRow` names are used identically across their producing and consuming tasks; token cookie constants (`sb_share_`, 24 h) are single-sourced from Task 1.

