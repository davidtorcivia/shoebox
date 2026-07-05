# Shoebox Phase 07 — Worker, Ingestion & Arrivals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Docker sidecar worker (SQLite-polled job runner producing canonical ffmpeg/sharp derivatives and hover-scrub sprite sheets), the chokidar ingestion watcher with path-convention hints, and the keyboard-first Arrivals triage page that promotes `needs_review` items to `ready`.

**Architecture:** `src/worker/` is a standalone Node process (`pnpm worker` → `tsx src/worker/index.ts`) that imports the app's Drizzle schema and fs storage adapter directly and talks to the same SQLite file via `DATABASE_PATH`/`MEDIA_PATH`/`INGEST_PATH` env. It polls the `jobs` table (single-writer-safe claim via one atomic `UPDATE … RETURNING`), runs `derivatives`/`sprite` handlers (ffmpeg via fluent-ffmpeg + ffmpeg-static, sharp), and watches `INGEST_PATH` with chokidar. The Arrivals UI + `/api/arrivals` live in the SvelteKit app and are platform-portable (the queue works on Cloudflare too; only the ingest-folder hint copy is feature-gated).

**Tech Stack:** TypeScript strict ESM, better-sqlite3 + Drizzle, fluent-ffmpeg + ffmpeg-static + ffprobe-static, sharp, chokidar, exifr, file-type, nanoid, tsx, Vitest, Playwright, Svelte 5 runes.

**Master plan:** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts (jobs table Contract 1, `StorageAdapter`/`JobQueueAdapter` Contract 2, `/api/arrivals` Contract 6, storage keys & sprite spec Contract 7, env Contract 8) are LAW. Where this plan and the master conflict, the master wins.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` §7 (media pipeline, ingestion folder, Arrivals), §11 (Arrivals screen), §12 (ingestion error handling).

## Global Constraints

(Copied verbatim from the master plan — every task below implicitly includes these.)

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

### Phase-07-specific constraints

- `src/worker/**` is DOCKER/NODE-ONLY: it MAY import `node:*`, `sharp`, `fluent-ffmpeg`, `better-sqlite3`. It uses **relative** imports into `src/lib/` (no `$lib` alias — it runs under `tsx`, not Vite).
- `src/lib/server/arrivals.ts`, `src/routes/api/arrivals/**`, `src/routes/arrivals/**` are platform-portable: `await`-style Drizzle only (no `.run()/.get()/.all()` sync calls), no node imports.
- **FORBIDDEN in this phase:** anything faces/ML (`face_scan` handlers, faces container — phase 09); anything Cloudflare-deploy (wrangler, R2 provisioning, production Dockerfiles/compose — phase 10). `docker-compose.dev.yml` here is a dev convenience only.
- Storage keys are exactly Contract 7: `media/<itemId>/original.<ext>`, `poster.webp`, `thumb_400.webp`, `thumb_800.webp`, `thumb_1600.webp`, `sprite.webp` (sprite = 10×10 grid of 160×90 frames = 1600×900, one frame per duration/100 s). Regeneration overwrites the **same keys** in place.
- Retry policy is exactly: on failure `attempts += 1`; if `attempts >= 5` → `status='failed'` permanently; else `status='pending'`, `run_after = now + 2^attempts minutes`.
- File mtime is **never** used as a date source. Photo dates come from EXIF (exifr); video dates from container `creation_time` (ffprobe); else the path year hint; else precision `unknown`.

### Documented decisions (contract ambiguities resolved in this plan)

1. **Convention hints are stored as real data, not a side channel.** The spec says Arrivals shows "hint chips prefilled from conventions". Rather than adding a hints column (schema is frozen by Contract 1), ingest **pre-attaches directory hints as `topic` tags**, sets `items.title` from the filename (extension stripped, `-`/`_` → spaces), and sets the year hint as a year-precision date. The Arrivals form therefore prefills naturally from the item itself; hint chips ARE the item's tags.
2. **Ingest failures need no new table.** Unreadable/unsupported files are moved to `INGEST_PATH/_failed/` and recorded as a `jobs` row: `kind='ingest_scan'`, `status='failed'`, `attempts=1`, `payload={"path":"<rel path>","reason":"<why>"}`. The admin jobs list (phase 08) surfaces failed jobs, so these appear there with zero extra plumbing.

### Exports consumed from phases 01–06 (pinned)

This plan consumes these exact names. If a prior phase shipped a different name for the same behavior, add an **aliased re-export** in the prior phase's file — do not rename anything in this plan.

| Export | From | Signature |
|---|---|---|
| `schema` (all tables) | `src/lib/server/db/schema.ts` | Contract 1 verbatim |
| `Db` type | `src/lib/server/db/index.ts` | `ReturnType<typeof drizzle>` per Contract 2 |
| `createFsStorage` | `src/lib/server/platform/storage-fs.ts` | `(root: string) => StorageAdapter` |
| `createSqliteQueue` | `src/lib/server/platform/queue-sqlite.ts` | `(db: Db) => JobQueueAdapter` |
| `StorageAdapter`, `JobQueueAdapter` | `src/lib/server/platform/types.ts` | Contract 2 verbatim |
| `requireRole` | `src/lib/server/roles.ts` | `(locals, min: Role) => SessionUser` |
| `sortDate`, `ItemDate`, `DatePrecision` | `src/lib/domain/dates.ts` | Contract 5 verbatim |
| `applyHolidayTags` | `src/lib/server/items.ts` | `(db: Db, itemId: string) => Promise<void>` (phase 06 holiday auto-tagging) |
| `listItems` | `src/lib/server/items.ts` | `(db: Db, storage: StorageAdapter, opts: { status?: string; year?: number; limit?: number; cursor?: string }) => Promise<{ items: ItemDTO[]; nextCursor: string \| null }>` (phase 02 DTO lister behind `GET /api/items`) |
| `reindexItem` | `src/lib/server/search.ts` | `(db: Db, itemId: string) => Promise<void>` (phase 06) |
| `recomputeYearCounts` | `src/lib/server/aggregates.ts` | `(db: Db) => Promise<void>` (phase 02) |
| `reducedMotion` store | `src/lib/ui/theme.ts` | `Readable<boolean>` |
| `DatePicker` | `src/lib/ui/DatePicker.svelte` | props `value: ItemDate`, `onchange: (d: ItemDate) => void` |

---

## File Structure

```
Create:
  src/worker/jobs.ts                     # claim / run / retry-backoff / handler registry / failure logging
  src/worker/jobs.test.ts
  src/worker/test-helpers.ts             # in-memory migrated test db + seed helpers (test-only)
  src/worker/index.ts                    # process entry: env, polling loop, SIGTERM drain, watcher wiring
  src/worker/index.test.ts
  src/worker/derivatives.ts              # probeVideo, 'derivatives' + 'sprite' handlers
  src/worker/derivatives.test.ts
  src/worker/sprite.test.ts
  src/worker/conventions.ts              # pure path→hints parser + date resolution + title from filename
  src/worker/conventions.test.ts
  src/worker/ingest-watcher.ts           # sha256, processIngestFile, chokidar watcher
  src/worker/ingest-watcher.test.ts
  src/worker/fixtures.test.ts            # guards the fixture generator
  src/lib/server/arrivals.ts             # portable batch-apply/approve logic (used by /api/arrivals)
  src/lib/server/arrivals.test.ts
  src/routes/api/arrivals/+server.ts     # Contract 6 GET/POST
  src/routes/arrivals/+page.server.ts
  src/routes/arrivals/+page.svelte
  src/routes/arrivals/selection.ts       # pure keyboard/selection logic
  src/routes/arrivals/selection.test.ts
  e2e/fixtures/generate.ts               # committed generator; binaries gitignored
  e2e/env.ts                             # shared e2e paths/env (app + worker use identical values)
  e2e/global-setup.ts
  e2e/worker-ingestion.spec.ts
  docker-compose.dev.yml
Modify:
  package.json                           # deps + "worker" / "fixtures" scripts
  .gitignore                             # fixture binaries, e2e/.data, ./ingest
  playwright.config.ts                   # env + globalSetup
  src/lib/ui/MediaCard.svelte            # add data-testid="scrub-hairline" to the existing hairline element (one attribute; no behavior change)
```

---

### Task 1: Worker dependencies, scripts & test fixtures

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `e2e/fixtures/generate.ts`
- Test: `src/worker/fixtures.test.ts`

**Interfaces:**
- Consumes: nothing from earlier phases (pure tooling).
- Produces: `generateFixtures(): Promise<void>`, `FIXTURE_MP4: string` (2 s, 320×180, H.264+AAC, no container creation_time), `FIXTURE_JPG: string` (640×480 JPEG with EXIF `DateTimeOriginal = 1994:12:25 10:30:00`) from `e2e/fixtures/generate.ts`; `pnpm worker` and `pnpm fixtures` scripts. Every later task's media tests import these fixtures.

- [ ] **Step 1: Install dependencies**

Run:

```bash
pnpm add fluent-ffmpeg ffmpeg-static ffprobe-static sharp chokidar exifr file-type
pnpm add -D @types/fluent-ffmpeg tsx
```

Expected: pnpm resolves and writes to `package.json`/`pnpm-lock.yaml` with exit code 0. (`nanoid`, `better-sqlite3`, `drizzle-orm`, `vitest`, `@playwright/test` exist from phases 01–06.)

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block add (keep all existing scripts untouched):

```json
"worker": "tsx src/worker/index.ts",
"fixtures": "tsx e2e/fixtures/generate.ts"
```

- [ ] **Step 3: Write the failing fixture test**

Create `src/worker/fixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate.js';

describe('e2e fixtures', () => {
  it('generates a tiny mp4 and an EXIF-dated jpg', async () => {
    await generateFixtures();
    expect(statSync(FIXTURE_MP4).size).toBeGreaterThan(1000);
    expect(statSync(FIXTURE_JPG).size).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/worker/fixtures.test.ts`
Expected: FAIL — `Failed to resolve import "../../e2e/fixtures/generate.js"`.

- [ ] **Step 5: Write the fixture generator**

Create `e2e/fixtures/generate.ts`:

```ts
/**
 * Generates the tiny media fixtures used by worker unit tests and Playwright e2e.
 * Committed as a generator (binaries are gitignored); run via `pnpm fixtures`,
 * vitest, or e2e/global-setup.ts. Idempotent: skips files that already exist.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));

/** 2 s, 320×180, 12 fps H.264 + AAC. testsrc writes NO container creation_time,
 *  so ingest date resolution falls through to the path year hint. */
export const FIXTURE_MP4 = join(here, 'clip.mp4');

/** 640×480 JPEG carrying EXIF DateTimeOriginal 1994-12-25 (Christmas → holiday tag). */
export const FIXTURE_JPG = join(here, 'photo.jpg');

export async function generateFixtures(): Promise<void> {
  mkdirSync(here, { recursive: true });
  if (!existsSync(FIXTURE_MP4)) {
    execFileSync(ffmpegPath as unknown as string, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=12',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      FIXTURE_MP4,
    ]);
  }
  if (!existsSync(FIXTURE_JPG)) {
    await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 250, g: 123, b: 98 } },
    })
      .jpeg({ quality: 80 })
      .withExif({ IFD0: { Make: 'Shoebox' }, IFD2: { DateTimeOriginal: '1994:12:25 10:30:00' } })
      .toFile(FIXTURE_JPG);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateFixtures();
  console.log('fixtures ready:', FIXTURE_MP4, FIXTURE_JPG);
}
```

- [ ] **Step 6: Gitignore the generated binaries and e2e scratch dirs**

Append to `.gitignore`:

```
e2e/fixtures/clip.mp4
e2e/fixtures/photo.jpg
e2e/.data/
/ingest/
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/worker/fixtures.test.ts`
Expected: PASS (1 test). First run takes a few seconds while ffmpeg encodes.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore e2e/fixtures/generate.ts src/worker/fixtures.test.ts
git commit -m "chore: worker deps, pnpm worker script, committed e2e fixture generator"
```

---

### Task 2: Job claiming (`src/worker/jobs.ts` part 1) + test DB helpers

**Files:**
- Create: `src/worker/jobs.ts`
- Create: `src/worker/test-helpers.ts`
- Test: `src/worker/jobs.test.ts`

**Interfaces:**
- Consumes: `schema` (Contract 1 `jobs` table: `id, kind, payload, status, attempts, run_after, created_at`, index `jobs_claim`), `StorageAdapter` type.
- Produces (used by Tasks 3–10, 14):

```ts
export type WorkerDb = BetterSQLite3Database<typeof schema>;
export type JobKind = 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan';
export interface ClaimedJob { id: string; kind: JobKind; payload: Record<string, unknown>; attempts: number; }
export interface WorkerContext { db: WorkerDb; storage: StorageAdapter; mediaPath: string; }
export type JobHandler = (payload: Record<string, unknown>, ctx: WorkerContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;
export function claimJob(db: WorkerDb, kinds: JobKind[], now?: Date): ClaimedJob | null;
```

- Also produces test helpers (test-only): `createTestDb(): WorkerDb`, `seedOwner(db): string`, `seedItem(db, ownerId, overrides?): string`, `insertJob(db, partial): string`.

- [ ] **Step 1: Write the failing test**

Create `src/worker/jobs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/server/db/schema.js';
import { claimJob } from './jobs.js';
import { createTestDb, insertJob } from './test-helpers.js';

describe('claimJob', () => {
  it('returns null when no jobs are pending', () => {
    const db = createTestDb();
    expect(claimJob(db, ['derivatives', 'sprite'])).toBeNull();
  });

  it('claims the oldest eligible pending job of a handled kind and marks it running', () => {
    const db = createTestDb();
    const older = insertJob(db, { kind: 'sprite', payload: { itemId: 'a' }, createdAt: new Date('2026-01-01T00:00:00Z') });
    insertJob(db, { kind: 'derivatives', payload: { itemId: 'b' }, createdAt: new Date('2026-01-02T00:00:00Z') });
    const job = claimJob(db, ['derivatives', 'sprite']);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(older);
    expect(job!.kind).toBe('sprite');
    expect(job!.payload).toEqual({ itemId: 'a' });
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, older)).get();
    expect(row!.status).toBe('running');
  });

  it('skips jobs with run_after in the future', () => {
    const db = createTestDb();
    insertJob(db, { kind: 'derivatives', runAfter: new Date(Date.now() + 60_000) });
    expect(claimJob(db, ['derivatives'])).toBeNull();
  });

  it('skips kinds it does not handle (face_scan is left for the faces container)', () => {
    const db = createTestDb();
    insertJob(db, { kind: 'face_scan' });
    insertJob(db, { kind: 'ingest_scan', status: 'failed' });
    expect(claimJob(db, ['derivatives', 'sprite'])).toBeNull();
  });

  it('never claims the same job twice', () => {
    const db = createTestDb();
    insertJob(db, { kind: 'derivatives' });
    expect(claimJob(db, ['derivatives'])).not.toBeNull();
    expect(claimJob(db, ['derivatives'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/jobs.test.ts`
Expected: FAIL — `Failed to resolve import "./jobs.js"`.

- [ ] **Step 3: Write the test helpers**

Create `src/worker/test-helpers.ts`:

```ts
/**
 * Test-only helpers for worker unit tests: an in-memory SQLite db with the
 * real migrations applied, plus row seeders. Never imported by runtime code.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema.js';
import type { JobKind, WorkerDb } from './jobs.js';

export function createTestDb(): WorkerDb {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'src/lib/server/db/migrations' });
  return db;
}

export function seedOwner(db: WorkerDb): string {
  const id = nanoid(12);
  db.insert(schema.users)
    .values({
      id,
      username: `owner-${id}`,
      passwordHash: 'pbkdf2$310000$test$test',
      role: 'owner',
      accentColor: '#FA7B62',
      createdAt: new Date(),
    })
    .run();
  return id;
}

export function seedItem(
  db: WorkerDb,
  ownerId: string,
  overrides: Partial<typeof schema.items.$inferInsert> = {},
): string {
  const id = nanoid(12);
  db.insert(schema.items)
    .values({
      id,
      type: 'video',
      datePrecision: 'unknown',
      width: 320,
      height: 180,
      sizeBytes: 1,
      sha256: `sha-${id}`,
      source: 'upload',
      status: 'processing',
      uploadedBy: ownerId,
      createdAt: new Date(),
      ...overrides,
    })
    .run();
  return id;
}

export function insertJob(
  db: WorkerDb,
  partial: {
    kind: JobKind;
    payload?: Record<string, unknown>;
    status?: 'pending' | 'running' | 'done' | 'failed';
    attempts?: number;
    runAfter?: Date;
    createdAt?: Date;
  },
): string {
  const id = nanoid(12);
  db.insert(schema.jobs)
    .values({
      id,
      kind: partial.kind,
      payload: JSON.stringify(partial.payload ?? {}),
      status: partial.status ?? 'pending',
      attempts: partial.attempts ?? 0,
      runAfter: partial.runAfter ?? new Date(0),
      createdAt: partial.createdAt ?? new Date(),
    })
    .run();
  return id;
}
```

- [ ] **Step 4: Write the claim implementation**

Create `src/worker/jobs.ts`:

```ts
/**
 * Job queue consumer for the Docker worker. The app side only ever enqueues
 * (JobQueueAdapter.enqueue, phase 01 queue-sqlite); this module claims and runs.
 *
 * Claiming is a single atomic `UPDATE … WHERE id = (SELECT … LIMIT 1) RETURNING`.
 * better-sqlite3 executes it synchronously in one statement, so even with the
 * app process writing to the same file there is no double-claim window.
 */
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema.js';
import type { StorageAdapter } from '../lib/server/platform/types.js';

export type WorkerDb = BetterSQLite3Database<typeof schema>;
export type JobKind = 'derivatives' | 'sprite' | 'ingest_scan' | 'face_scan';

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface WorkerContext {
  db: WorkerDb;
  storage: StorageAdapter;
  mediaPath: string;
}

export type JobHandler = (payload: Record<string, unknown>, ctx: WorkerContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export const MAX_ATTEMPTS = 5;

const ALL_KINDS: readonly JobKind[] = ['derivatives', 'sprite', 'ingest_scan', 'face_scan'];

/**
 * Claim the oldest pending job (of the given kinds) whose run_after has passed.
 * Marks it 'running' and returns it, or returns null when nothing is eligible.
 */
export function claimJob(db: WorkerDb, kinds: JobKind[], now: Date = new Date()): ClaimedJob | null {
  const safeKinds = kinds.filter((k) => ALL_KINDS.includes(k));
  if (safeKinds.length === 0) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  // sql.raw is safe here: interpolated values are enum literals validated above
  // and an integer — no user input reaches this string.
  const kindList = safeKinds.map((k) => `'${k}'`).join(', ');
  const row = db.get<{ id: string; kind: JobKind; payload: string; attempts: number } | undefined>(
    sql.raw(`
      UPDATE jobs SET status = 'running'
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending' AND run_after <= ${nowSec} AND kind IN (${kindList})
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      )
      RETURNING id, kind, payload, attempts
    `),
  );
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    attempts: row.attempts,
  };
}
```

(`runJob` and `logIngestFailure` are added to this same file in Task 3; `eq` and `nanoid` imports are used there.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/worker/jobs.test.ts`
Expected: PASS (5 tests). TypeScript may flag the unused `eq`/`nanoid` imports depending on lint config — if `pnpm check` complains, leave them out until Task 3 adds them back with their usages.

- [ ] **Step 6: Commit**

```bash
git add src/worker/jobs.ts src/worker/jobs.test.ts src/worker/test-helpers.ts
git commit -m "feat: worker job claiming with atomic UPDATE...RETURNING"
```

---

### Task 3: Job execution, retry/backoff & ingest-failure logging (`src/worker/jobs.ts` part 2)

**Files:**
- Modify: `src/worker/jobs.ts` (append to Task 2's file)
- Test: `src/worker/jobs.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `ClaimedJob`, `JobHandlers`, `WorkerContext`, `MAX_ATTEMPTS`.
- Produces (used by Tasks 4, 10):

```ts
export function runJob(db: WorkerDb, job: ClaimedJob, handlers: JobHandlers, ctx: WorkerContext): Promise<'done' | 'retry' | 'failed'>;
export function logIngestFailure(db: WorkerDb, path: string, reason: string): void;  // documented decision 2
```

- [ ] **Step 1: Append the failing tests**

Append to `src/worker/jobs.test.ts`:

```ts
import { logIngestFailure, runJob, type WorkerContext } from './jobs.js';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function testCtx(db: ReturnType<typeof createTestDb>): WorkerContext {
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  return { db, storage: createFsStorage(mediaPath), mediaPath };
}

describe('runJob', () => {
  it('marks the job done when the handler succeeds', async () => {
    const db = createTestDb();
    const id = insertJob(db, { kind: 'derivatives', payload: { itemId: 'x' } });
    const job = claimJob(db, ['derivatives'])!;
    const seen: unknown[] = [];
    const outcome = await runJob(db, job, { derivatives: async (p) => { seen.push(p); } }, testCtx(db));
    expect(outcome).toBe('done');
    expect(seen).toEqual([{ itemId: 'x' }]);
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
    expect(row.status).toBe('done');
  });

  it('re-pends a failed job with attempts++ and run_after = now + 2^attempts minutes', async () => {
    const db = createTestDb();
    const id = insertJob(db, { kind: 'derivatives' });
    const job = claimJob(db, ['derivatives'])!;
    const before = Date.now();
    const outcome = await runJob(db, job, { derivatives: async () => { throw new Error('boom'); } }, testCtx(db));
    expect(outcome).toBe('retry');
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    const delayMs = row.runAfter.getTime() - before;
    expect(delayMs).toBeGreaterThanOrEqual(2 * 60_000 - 2000);   // 2^1 minutes
    expect(delayMs).toBeLessThanOrEqual(2 * 60_000 + 2000);
    expect(JSON.parse(row.payload).lastError).toBe('boom');
  });

  it('fails permanently on the 5th attempt', async () => {
    const db = createTestDb();
    const id = insertJob(db, { kind: 'sprite', attempts: 4 });
    const job = claimJob(db, ['sprite'])!;
    const outcome = await runJob(db, job, { sprite: async () => { throw new Error('still broken'); } }, testCtx(db));
    expect(outcome).toBe('failed');
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(5);
  });

  it('treats a missing handler as a failure (retry path)', async () => {
    const db = createTestDb();
    insertJob(db, { kind: 'derivatives' });
    const job = claimJob(db, ['derivatives'])!;
    const outcome = await runJob(db, job, {}, testCtx(db));
    expect(outcome).toBe('retry');
  });
});

describe('logIngestFailure', () => {
  it('records a failed ingest_scan jobs row with { path, reason } payload', () => {
    const db = createTestDb();
    logIngestFailure(db, '1994/christmas/corrupt.mp4', 'unrecognized file contents');
    const rows = db.select().from(schema.jobs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('ingest_scan');
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(1);
    expect(JSON.parse(rows[0].payload)).toEqual({ path: '1994/christmas/corrupt.mp4', reason: 'unrecognized file contents' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/jobs.test.ts`
Expected: FAIL — `runJob` / `logIngestFailure` have no exported member.

- [ ] **Step 3: Append the implementation**

Append to `src/worker/jobs.ts`:

```ts
/**
 * Run one claimed job. On success → status 'done'. On any throw →
 * attempts += 1; if attempts >= MAX_ATTEMPTS → 'failed' permanently, else
 * back to 'pending' with run_after = now + 2^attempts minutes. The error
 * message is merged into payload.lastError so Admin → Jobs (phase 08) can
 * show why a job is retrying/failed.
 */
export async function runJob(
  db: WorkerDb,
  job: ClaimedJob,
  handlers: JobHandlers,
  ctx: WorkerContext,
): Promise<'done' | 'retry' | 'failed'> {
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new Error(`no handler registered for kind '${job.kind}'`);
    await handler(job.payload, ctx);
    db.update(schema.jobs).set({ status: 'done' }).where(eq(schema.jobs.id, job.id)).run();
    return 'done';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    const payload = JSON.stringify({ ...job.payload, lastError: reason });
    if (attempts >= MAX_ATTEMPTS) {
      db.update(schema.jobs)
        .set({ status: 'failed', attempts, payload })
        .where(eq(schema.jobs.id, job.id))
        .run();
      return 'failed';
    }
    const runAfter = new Date(Date.now() + 2 ** attempts * 60_000);
    db.update(schema.jobs)
      .set({ status: 'pending', attempts, payload, runAfter })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return 'retry';
  }
}

/**
 * Documented decision 2: ingestion failures are recorded as pre-failed
 * 'ingest_scan' jobs rows (payload { path, reason }) instead of a new table.
 * They are never claimed (status='failed' from birth) and surface in the
 * admin jobs list alongside other failed jobs.
 */
export function logIngestFailure(db: WorkerDb, path: string, reason: string): void {
  db.insert(schema.jobs)
    .values({
      id: nanoid(12),
      kind: 'ingest_scan',
      payload: JSON.stringify({ path, reason }),
      status: 'failed',
      attempts: 1,
      runAfter: new Date(),
      createdAt: new Date(),
    })
    .run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/worker/jobs.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/jobs.ts src/worker/jobs.test.ts
git commit -m "feat: job execution with exponential backoff retries and ingest failure logging"
```

---

### Task 4: Worker process entry — polling loop & graceful SIGTERM drain

**Files:**
- Create: `src/worker/index.ts`
- Test: `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `claimJob`, `runJob`, `JobHandlers`, `WorkerContext`, `WorkerDb` (Tasks 2–3); `createFsStorage` (phase 01); `createSqliteQueue` (phase 01); `derivativesHandler`, `spriteHandler` (Task 6/7 — until those land, `main()` wires an empty handlers object; the final wiring shown here is completed in this task and compiles once Tasks 5–7 exist, so **execute Task 4's `main()` wiring exactly as written but expect `pnpm check` to fail on the two missing imports until Task 7 — comment those two imports in with Task 7 if you run tasks strictly in order**. Recommended order for subagent execution: implement Tasks 5–7 before uncommenting. To keep every commit green, this task ships `index.ts` with the handler imports **commented** and Task 7 uncomments them.)
- Produces (used by Task 14's spawned process and Task 7's wiring step):

```ts
export interface WorkerHandle { start(): Promise<void>; stop(): Promise<void>; }
export function createWorker(opts: {
  db: WorkerDb; ctx: WorkerContext; handlers: JobHandlers;
  kinds?: JobKind[]; idleMinMs?: number; idleMaxMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): WorkerHandle;
```

- [ ] **Step 1: Write the failing test**

Create `src/worker/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { createWorker } from './index.js';
import type { WorkerContext } from './jobs.js';
import { createTestDb, insertJob } from './test-helpers.js';

function testCtx(db: ReturnType<typeof createTestDb>): WorkerContext {
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  return { db, storage: createFsStorage(mediaPath), mediaPath };
}

describe('createWorker polling loop', () => {
  it('backs off 1s → 5s while idle, resets to 1s after work, and drains on stop', async () => {
    const db = createTestDb();
    const delays: number[] = [];
    const ran: string[] = [];
    let worker: ReturnType<typeof createWorker>;
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
      if (delays.length === 6) insertJob(db, { kind: 'derivatives', payload: { itemId: 'x' } });
      if (delays.length === 8) void worker.stop();
    };
    worker = createWorker({
      db,
      ctx: testCtx(db),
      handlers: { derivatives: async (p) => { ran.push(String(p.itemId)); } },
      sleep,
    });
    await worker.start();
    // 5 idle polls ramp 1s,2s,3s,4s,5s then cap at 5s; poll 7 claims the job
    expect(delays.slice(0, 6)).toEqual([1000, 2000, 3000, 4000, 5000, 5000]);
    expect(ran).toEqual(['x']);
    // after processing, idle delay resets to the 1s floor
    expect(delays[6]).toBe(1000);
  });

  it('stop() waits for the in-flight job to finish (graceful drain)', async () => {
    const db = createTestDb();
    insertJob(db, { kind: 'derivatives', payload: { itemId: 'slow' } });
    let finished = false;
    let worker: ReturnType<typeof createWorker>;
    const handlers = {
      derivatives: async (): Promise<void> => {
        void worker.stop(); // SIGTERM arrives mid-job
        await new Promise((r) => setTimeout(r, 50));
        finished = true;
      },
    };
    worker = createWorker({ db, ctx: testCtx(db), handlers, sleep: async () => {} });
    await worker.start();
    expect(finished).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/worker/index.ts`:

```ts
/**
 * Shoebox Docker worker — standalone Node process (never bundled into the app).
 * Run: `pnpm worker` (tsx src/worker/index.ts) with env:
 *   DATABASE_PATH  (default /data/shoebox.db)
 *   MEDIA_PATH     (default /data/media)
 *   INGEST_PATH    (optional — watcher starts only when set)
 *
 * Polls the shared SQLite jobs table: 1s between polls when busy/first idle,
 * backing off +1s per idle poll to a 5s ceiling. SIGTERM/SIGINT drain the
 * in-flight job, close the watcher, then exit 0.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import * as schema from '../lib/server/db/schema.js';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { createSqliteQueue } from '../lib/server/platform/queue-sqlite.js';
import {
  claimJob,
  runJob,
  type JobHandlers,
  type JobKind,
  type WorkerContext,
  type WorkerDb,
} from './jobs.js';
// Uncommented in Task 7 once the handlers exist:
// import { derivativesHandler, spriteHandler } from './derivatives.js';
// import { startIngestWatcher } from './ingest-watcher.js';

const HANDLED_KINDS: JobKind[] = ['derivatives', 'sprite'];

export interface WorkerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createWorker(opts: {
  db: WorkerDb;
  ctx: WorkerContext;
  handlers: JobHandlers;
  kinds?: JobKind[];
  idleMinMs?: number;
  idleMaxMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): WorkerHandle {
  const kinds = opts.kinds ?? HANDLED_KINDS;
  const idleMin = opts.idleMinMs ?? 1000;
  const idleMax = opts.idleMaxMs ?? 5000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let stopping = false;
  let loop: Promise<void> | null = null;

  async function run(): Promise<void> {
    let idle = idleMin;
    while (!stopping) {
      const job = claimJob(opts.db, kinds);
      if (!job) {
        await sleep(idle);
        idle = Math.min(idle + idleMin, idleMax);
        continue;
      }
      idle = idleMin;
      const outcome = await runJob(opts.db, job, opts.handlers, opts.ctx);
      console.log(`[worker] job ${job.id} (${job.kind}) -> ${outcome}`);
    }
  }

  return {
    start(): Promise<void> {
      loop = run();
      return loop;
    },
    async stop(): Promise<void> {
      stopping = true;
      if (loop) await loop; // drains the in-flight job (or the current idle sleep)
    },
  };
}

/** Ingestion needs an owner to attribute items to; first-run setup creates one. */
async function waitForOwner(db: WorkerDb): Promise<string> {
  for (;;) {
    const owner = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'owner')).get();
    if (owner) return owner.id;
    console.log('[worker] no owner yet — waiting for first-run setup…');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH ?? '/data/shoebox.db';
  const mediaPath = process.env.MEDIA_PATH ?? '/data/media';
  const ingestPath = process.env.INGEST_PATH;

  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as WorkerDb;
  const storage = createFsStorage(mediaPath);
  const ctx: WorkerContext = { db, storage, mediaPath };
  const queue = createSqliteQueue(db);

  const handlers: JobHandlers = {
    // Task 7 wires: derivatives: derivativesHandler, sprite: spriteHandler,
  };
  const worker = createWorker({ db, ctx, handlers });

  let watcher: { close(): Promise<void> } | null = null;
  if (ingestPath) {
    const ownerId = await waitForOwner(db);
    console.log(`[worker] ingestion watcher on ${ingestPath}`);
    // Task 10 wires:
    // watcher = startIngestWatcher({
    //   db, storage, ingestPath, mediaPath, ownerId,
    //   enqueue: (kind, payload) => queue.enqueue(kind, payload),
    // });
    void queue; void ownerId; // placeholder references removed in Task 10
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received — draining…`);
    if (watcher) await watcher.close();
    await worker.stop();
    sqlite.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.log(`[worker] started (db=${databasePath}, media=${mediaPath}, ingest=${ingestPath ?? 'disabled'})`);
  await worker.start();
}

// Only run main() when executed as a script (tsx), never when imported by tests.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[worker] fatal', err);
    process.exit(1);
  });
}
```

Note: the two `// Task 7 wires` / `// Task 10 wires` comment blocks are the ONLY permitted deferred wiring in this plan; Tasks 7 and 10 each contain an explicit step that removes them. `void queue; void ownerId;` keeps `pnpm check` green meanwhile.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/worker/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/worker/index.ts src/worker/index.test.ts
git commit -m "feat: worker process with 1s-5s idle backoff polling and graceful drain"
```

---

### Task 5: `derivatives` handler — probing + photo thumbnails

**Files:**
- Create: `src/worker/derivatives.ts`
- Test: `src/worker/derivatives.test.ts`

**Interfaces:**
- Consumes: `JobHandler`, `WorkerContext`, `WorkerDb` (Task 2); fixtures (Task 1); `createFsStorage` (phase 01); Contract 7 keys.
- Produces (used by Tasks 6, 7, 9, and `index.ts` wiring):

```ts
export interface VideoProbe { duration: number; width: number; height: number; creationTime: string | null; }
export function probeVideo(filePath: string): Promise<VideoProbe>;
export function normalizeCreationTime(raw: string | null): string | null; // → 'YYYY-MM-DD' | null
export const derivativesHandler: JobHandler;   // photos this task; video branch Task 6
export const spriteHandler: JobHandler;        // Task 7
```

Behavior (photos): sharp reads `media/<id>/original.<ext>` (auto-orient via `.rotate()`; decodes jpg/jpeg/png/webp/avif/**heic** — heic is decoded by sharp here so its web-visible derivatives are the webp thumbs; the original stays untouched as the archival copy. NOTE: production images must ship a libvips with libheif — recorded for phase 10's Dockerfile.worker), corrects `items.width/height` if the client metadata was missing/wrong, regenerates `thumb_400/800/1600` webp q82 (`withoutEnlargement`), `storage.put`s them under the same Contract 7 keys (overwrite in place), and atomically replaces the corresponding `item_files` rows in one transaction.

- [ ] **Step 1: Write the failing test**

Create `src/worker/derivatives.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { FIXTURE_JPG, generateFixtures } from '../../e2e/fixtures/generate.js';
import * as schema from '../lib/server/db/schema.js';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { derivativesHandler } from './derivatives.js';
import type { WorkerContext } from './jobs.js';
import { createTestDb, seedItem, seedOwner } from './test-helpers.js';

beforeAll(async () => {
  await generateFixtures();
});

async function setupPhoto(): Promise<{ ctx: WorkerContext; itemId: string }> {
  const db = createTestDb();
  const owner = seedOwner(db);
  // width/height deliberately wrong: worker must correct from the real pixels
  const itemId = seedItem(db, owner, { type: 'photo', width: 1, height: 1 });
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  const key = `media/${itemId}/original.jpg`;
  await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
  await copyFile(FIXTURE_JPG, join(mediaPath, key));
  db.insert(schema.itemFiles)
    .values({ id: 'orig1', itemId, kind: 'original', storageKey: key, mime: 'image/jpeg', width: 640, height: 480 })
    .run();
  return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('derivativesHandler (photo)', () => {
  it('writes thumb_400/800/1600 webp under Contract 7 keys and records item_files rows', async () => {
    const { ctx, itemId } = await setupPhoto();
    await derivativesHandler({ itemId }, ctx);
    for (const w of [400, 800, 1600]) {
      const abs = join(ctx.mediaPath, `media/${itemId}/thumb_${w}.webp`);
      expect((await stat(abs)).size).toBeGreaterThan(0);
      const meta = await sharp(abs).metadata();
      expect(meta.format).toBe('webp');
    }
    const rows = ctx.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(['original', 'thumb_1600', 'thumb_400', 'thumb_800']);
    // fixture is 640w: thumb_400 downsizes, larger sizes never enlarge
    const w = (kind: string): number | null => rows.find((r) => r.kind === kind)!.width;
    expect(w('thumb_400')).toBe(400);
    expect(w('thumb_800')).toBe(640);
    expect(w('thumb_1600')).toBe(640);
  });

  it('corrects items.width/height from the real pixels', async () => {
    const { ctx, itemId } = await setupPhoto();
    await derivativesHandler({ itemId }, ctx);
    const item = ctx.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
    expect(item.width).toBe(640);
    expect(item.height).toBe(480);
  });

  it('is idempotent: rerunning replaces rows instead of duplicating them', async () => {
    const { ctx, itemId } = await setupPhoto();
    await derivativesHandler({ itemId }, ctx);
    await derivativesHandler({ itemId }, ctx);
    const thumbs = ctx.db.select().from(schema.itemFiles)
      .where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'thumb_400'))).all();
    expect(thumbs).toHaveLength(1);
  });

  it('throws (so the job retries) when the item does not exist', async () => {
    const { ctx } = await setupPhoto();
    await expect(derivativesHandler({ itemId: 'nope' }, ctx)).rejects.toThrow(/item nope not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/derivatives.test.ts`
Expected: FAIL — `Failed to resolve import "./derivatives.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/worker/derivatives.ts`:

```ts
/**
 * Canonical server-side derivatives (Docker only). Regenerates higher-quality
 * versions of the client-generated derivatives from phase 02, overwriting the
 * SAME Contract 7 storage keys in place:
 *   media/<id>/poster.webp        (videos: frame at 10% duration, ≤1600w, q82)
 *   media/<id>/thumb_{400,800,1600}.webp
 *   media/<id>/sprite.webp        (videos: 10×10 grid of 160×90 frames = 1600×900)
 * item_files rows for the regenerated kinds are replaced atomically.
 */
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import sharp from 'sharp';
import { and, eq, inArray } from 'drizzle-orm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema.js';
import type { JobHandler, WorkerDb } from './jobs.js';

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const THUMB_WIDTHS = [400, 800, 1600] as const;
const WEBP_QUALITY = 82;

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  creationTime: string | null; // 'YYYY-MM-DD' or null
}

/** Container creation_time → ISO day, rejecting epoch sentinels and garbage. */
export function normalizeCreationTime(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year <= 1970 || year > 2100) return null; // 1970 = unset-clock sentinel
  return d.toISOString().slice(0, 10);
}

export function probeVideo(filePath: string): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err instanceof Error ? err : new Error(String(err)));
      const stream = data.streams.find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error(`no video stream in ${filePath}`));
      resolve({
        duration: Number(data.format.duration ?? 0),
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        creationTime: normalizeCreationTime((data.format.tags?.creation_time as string | undefined) ?? null),
      });
    });
  });
}

function runFfmpeg(configure: (cmd: ffmpeg.FfmpegCommand) => ffmpeg.FfmpegCommand, input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    configure(ffmpeg(input))
      .output(output)
      .on('end', () => resolve())
      .on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
      .run();
  });
}

type DerivedKind = 'poster' | 'thumb_400' | 'thumb_800' | 'thumb_1600' | 'sprite';
interface DerivedRow { kind: DerivedKind; storageKey: string; mime: string; width: number; height: number; }

/** Atomically swap the item_files rows for exactly the regenerated kinds. */
function replaceItemFiles(db: WorkerDb, itemId: string, rows: DerivedRow[]): void {
  db.transaction((tx) => {
    tx.delete(schema.itemFiles)
      .where(and(eq(schema.itemFiles.itemId, itemId), inArray(schema.itemFiles.kind, rows.map((r) => r.kind))))
      .run();
    for (const r of rows) {
      tx.insert(schema.itemFiles).values({ id: nanoid(12), itemId, ...r }).run();
    }
  });
}

function loadItem(db: WorkerDb, itemId: string): { item: typeof schema.items.$inferSelect; originalKey: string } {
  const item = db.select().from(schema.items).where(eq(schema.items.id, itemId)).get();
  if (!item) throw new Error(`item ${itemId} not found`);
  const original = db.select().from(schema.itemFiles)
    .where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'original')))
    .get();
  if (!original) throw new Error(`item ${itemId} has no original file row`);
  return { item, originalKey: original.storageKey };
}

async function putWebp(
  ctx: Parameters<JobHandler>[1],
  itemId: string,
  kind: DerivedKind,
  source: Buffer,
  resizeWidth: number | null,
): Promise<DerivedRow> {
  let pipeline = sharp(source).rotate();
  if (resizeWidth !== null) pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
  const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  const storageKey = `media/${itemId}/${kind}.webp`;
  await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
  return { kind, storageKey, mime: 'image/webp', width: out.info.width, height: out.info.height };
}

export const derivativesHandler: JobHandler = async (payload, ctx) => {
  const itemId = String(payload.itemId ?? '');
  const { item, originalKey } = loadItem(ctx.db, itemId);
  const originalAbs = join(ctx.mediaPath, originalKey);
  const tmp = await mkdtemp(join(tmpdir(), 'shoebox-deriv-'));
  try {
    const rows: DerivedRow[] = [];
    let thumbSource: Buffer;

    if (item.type === 'video') {
      const probe = await probeVideo(originalAbs);
      // Correct client-supplied metadata when missing/wrong (ffprobe is truth).
      const updates: Partial<typeof schema.items.$inferInsert> = {};
      if (probe.duration > 0 && (item.duration == null || Math.abs(item.duration - probe.duration) > 0.5)) {
        updates.duration = probe.duration;
      }
      if (probe.width > 0 && probe.height > 0 && (item.width !== probe.width || item.height !== probe.height)) {
        updates.width = probe.width;
        updates.height = probe.height;
      }
      if (Object.keys(updates).length > 0) {
        ctx.db.update(schema.items).set(updates).where(eq(schema.items.id, itemId)).run();
      }
      // Canonical poster: frame at 10% of duration, ≤1600w, even height.
      const framePng = join(tmp, 'poster.png');
      await runFfmpeg(
        (cmd) => cmd.seekInput(Math.max(0, probe.duration * 0.1)).outputOptions(['-frames:v 1', "-vf scale='min(1600,iw)':-2"]),
        originalAbs,
        framePng,
      );
      thumbSource = await readFile(framePng);
      rows.push(await putWebp(ctx, itemId, 'poster', thumbSource, null));
    } else {
      // Photo: thumbs come straight from the original (sharp decodes
      // jpg/png/webp/avif/heic; heic thereby becomes web-visible via webp thumbs).
      thumbSource = await readFile(originalAbs);
      const meta = await sharp(thumbSource).metadata();
      let w = meta.width ?? 0;
      let h = meta.height ?? 0;
      if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w]; // EXIF rotated 90°/270°
      if (w > 0 && h > 0 && (item.width !== w || item.height !== h)) {
        ctx.db.update(schema.items).set({ width: w, height: h }).where(eq(schema.items.id, itemId)).run();
      }
    }

    for (const w of THUMB_WIDTHS) {
      rows.push(await putWebp(ctx, itemId, `thumb_${w}` as DerivedKind, thumbSource, w));
    }
    replaceItemFiles(ctx.db, itemId, rows);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

export const spriteHandler: JobHandler = async (payload, ctx) => {
  // Implemented in Task 7.
  void payload;
  void ctx;
  throw new Error('spriteHandler not implemented yet (Task 7)');
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/worker/derivatives.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/derivatives.ts src/worker/derivatives.test.ts
git commit -m "feat: derivatives handler regenerates photo thumbs and corrects dimensions"
```

---

### Task 6: `derivatives` handler — video poster, thumbs & metadata correction

**Files:**
- Modify: `src/worker/derivatives.ts` (video branch already written in Task 5 — this task proves it against the real fixture and fixes anything the tests flush out)
- Test: `src/worker/derivatives.test.ts` (append)

**Interfaces:**
- Consumes: Task 5's `derivativesHandler`, `probeVideo`; Task 1's `FIXTURE_MP4`.
- Produces: verified video behavior relied on by Tasks 7, 9, 14: `poster.webp` at ≤1600w from the 10%-duration frame; thumbs derived from the poster; `items.duration/width/height` corrected from ffprobe.

- [ ] **Step 1: Append the failing tests**

Append to `src/worker/derivatives.test.ts`:

```ts
import { FIXTURE_MP4 } from '../../e2e/fixtures/generate.js';
import { probeVideo } from './derivatives.js';

async function setupVideo(): Promise<{ ctx: WorkerContext; itemId: string }> {
  const db = createTestDb();
  const owner = seedOwner(db);
  // duration missing, dimensions wrong: worker must fill from ffprobe
  const itemId = seedItem(db, owner, { type: 'video', width: 99, height: 99, duration: null });
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  const key = `media/${itemId}/original.mp4`;
  await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
  await copyFile(FIXTURE_MP4, join(mediaPath, key));
  db.insert(schema.itemFiles)
    .values({ id: 'orig1', itemId, kind: 'original', storageKey: key, mime: 'video/mp4', width: 320, height: 180 })
    .run();
  return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('probeVideo', () => {
  it('reads duration and dimensions from the fixture', async () => {
    await generateFixtures();
    const probe = await probeVideo(FIXTURE_MP4);
    expect(Math.abs(probe.duration - 2)).toBeLessThan(0.5);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(180);
    expect(probe.creationTime).toBeNull(); // testsrc writes no creation_time
  });
});

describe('derivativesHandler (video)', () => {
  it('writes poster.webp from the 10%-duration frame plus thumbs, and fixes metadata', async () => {
    const { ctx, itemId } = await setupVideo();
    await derivativesHandler({ itemId }, ctx);

    const posterAbs = join(ctx.mediaPath, `media/${itemId}/poster.webp`);
    const posterMeta = await sharp(posterAbs).metadata();
    expect(posterMeta.format).toBe('webp');
    expect(posterMeta.width).toBe(320); // min(1600, iw) never enlarges

    const rows = ctx.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
    expect(rows.map((r) => r.kind).sort()).toEqual(['original', 'poster', 'thumb_1600', 'thumb_400', 'thumb_800']);

    const item = ctx.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
    expect(Math.abs((item.duration ?? 0) - 2)).toBeLessThan(0.5);
    expect(item.width).toBe(320);
    expect(item.height).toBe(180);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/worker/derivatives.test.ts`
Expected: PASS (6 tests) if Task 5's video branch is correct; if any assertion fails, fix `src/worker/derivatives.ts` (not the test) until green. These tests exercise real ffmpeg — allow ~10 s.

- [ ] **Step 3: Typecheck**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/worker/derivatives.ts src/worker/derivatives.test.ts
git commit -m "test: prove video poster/thumb regeneration and ffprobe metadata correction"
```

---

### Task 7: `sprite` handler + worker handler wiring

**Files:**
- Modify: `src/worker/derivatives.ts` (replace the Task 5 `spriteHandler` stub)
- Modify: `src/worker/index.ts` (uncomment handler imports + wiring)
- Test: `src/worker/sprite.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: working `spriteHandler` (Contract 7 sprite: `media/<id>/sprite.webp`, 10×10 grid of 160×90 frames → 1600×900, one frame per duration/100 s, `item_files` row `kind='sprite'`). `index.ts` now claims and runs both handlers — the process is fully operational for jobs.

- [ ] **Step 1: Write the failing test**

Create `src/worker/sprite.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate.js';
import * as schema from '../lib/server/db/schema.js';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { spriteHandler } from './derivatives.js';
import type { WorkerContext } from './jobs.js';
import { createTestDb, seedItem, seedOwner } from './test-helpers.js';

beforeAll(async () => {
  await generateFixtures();
});

async function setup(type: 'video' | 'photo'): Promise<{ ctx: WorkerContext; itemId: string }> {
  const db = createTestDb();
  const owner = seedOwner(db);
  const itemId = seedItem(db, owner, { type });
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  const ext = type === 'video' ? 'mp4' : 'jpg';
  const key = `media/${itemId}/original.${ext}`;
  await mkdir(join(mediaPath, 'media', itemId), { recursive: true });
  await copyFile(type === 'video' ? FIXTURE_MP4 : FIXTURE_JPG, join(mediaPath, key));
  db.insert(schema.itemFiles)
    .values({ id: 'orig1', itemId, kind: 'original', storageKey: key, mime: type === 'video' ? 'video/mp4' : 'image/jpeg' })
    .run();
  return { ctx: { db, storage: createFsStorage(mediaPath), mediaPath }, itemId };
}

describe('spriteHandler', () => {
  it('renders a 1600×900 webp (10×10 grid of 160×90 frames) and records the item_files row', async () => {
    const { ctx, itemId } = await setup('video');
    await spriteHandler({ itemId }, ctx);
    const abs = join(ctx.mediaPath, `media/${itemId}/sprite.webp`);
    const meta = await sharp(abs).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(900);
    const row = ctx.db.select().from(schema.itemFiles)
      .where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite'))).get();
    expect(row).toBeDefined();
    expect(row!.storageKey).toBe(`media/${itemId}/sprite.webp`);
    expect(row!.width).toBe(1600);
    expect(row!.height).toBe(900);
  });

  it('is a no-op for photos', async () => {
    const { ctx, itemId } = await setup('photo');
    await spriteHandler({ itemId }, ctx); // must not throw
    const row = ctx.db.select().from(schema.itemFiles)
      .where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite'))).get();
    expect(row).toBeUndefined();
  });

  it('replaces the sprite row on rerun instead of duplicating', async () => {
    const { ctx, itemId } = await setup('video');
    await spriteHandler({ itemId }, ctx);
    await spriteHandler({ itemId }, ctx);
    const rows = ctx.db.select().from(schema.itemFiles)
      .where(and(eq(schema.itemFiles.itemId, itemId), eq(schema.itemFiles.kind, 'sprite'))).all();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/sprite.test.ts`
Expected: FAIL — `spriteHandler not implemented yet (Task 7)`.

- [ ] **Step 3: Replace the stub in `src/worker/derivatives.ts`**

Replace the entire `export const spriteHandler…` stub with:

```ts
/**
 * Contract 7 scrub sprite: 10×10 grid of 160×90 frames (1600×900 total),
 * sampled uniformly — one frame per duration/100 seconds via the fps filter
 * (which duplicates frames on short clips, so the grid is always full).
 */
export const spriteHandler: JobHandler = async (payload, ctx) => {
  const itemId = String(payload.itemId ?? '');
  const { item, originalKey } = loadItem(ctx.db, itemId);
  if (item.type !== 'video') return; // photos never get sprites
  const originalAbs = join(ctx.mediaPath, originalKey);
  const probe = await probeVideo(originalAbs);
  if (probe.duration <= 0) throw new Error(`item ${itemId} has zero duration; cannot build sprite`);
  const tmp = await mkdtemp(join(tmpdir(), 'shoebox-sprite-'));
  try {
    const tilePng = join(tmp, 'sprite.png');
    const fps = 100 / probe.duration;
    await runFfmpeg(
      (cmd) => cmd.outputOptions(['-frames:v 1', `-vf fps=${fps},scale=160:90,tile=10x10`]),
      originalAbs,
      tilePng,
    );
    const out = await sharp(tilePng).webp({ quality: 70 }).toBuffer({ resolveWithObject: true });
    const storageKey = `media/${itemId}/sprite.webp`;
    await ctx.storage.put(storageKey, new Uint8Array(out.data), { contentType: 'image/webp' });
    replaceItemFiles(ctx.db, itemId, [
      { kind: 'sprite', storageKey, mime: 'image/webp', width: out.info.width, height: out.info.height },
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};
```

- [ ] **Step 4: Wire the handlers into `src/worker/index.ts`**

In `src/worker/index.ts`:
1. Uncomment `import { derivativesHandler, spriteHandler } from './derivatives.js';` (leave the `ingest-watcher` import commented — Task 10).
2. Replace the empty handlers object:

```ts
  const handlers: JobHandlers = {
    derivatives: derivativesHandler,
    sprite: spriteHandler,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/worker/sprite.test.ts src/worker/index.test.ts && pnpm check`
Expected: PASS (5 tests), 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/worker/derivatives.ts src/worker/sprite.test.ts src/worker/index.ts
git commit -m "feat: 10x10 scrub sprite sheet handler wired into the worker"
```

---

### Task 8: Path conventions parser (`src/worker/conventions.ts`)

**Files:**
- Create: `src/worker/conventions.ts`
- Test: `src/worker/conventions.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no I/O).
- Produces (used by Tasks 9–10):

```ts
export interface ConventionHints { year?: number; tags: string[]; filename: string; }
export function parseConventions(relPath: string): ConventionHints;      // relPath is RELATIVE to INGEST_PATH
export function titleFromFilename(filename: string): string;
export interface ResolvedDate { dateStart: string | null; dateEnd: string | null; precision: 'day' | 'year' | 'unknown'; }
export function resolveItemDate(mediaDate: string | null, yearHint?: number): ResolvedDate;
```

Rules (spec §7): the watcher passes the path **relative to the ingest root**, so the spec's example `/ingest/1994/christmas/clip.mp4` arrives here as `1994/christmas/clip.mp4`. First path segment matching `/^(18|19|20)\d\d$/` → year hint. All remaining directory segments → tag hints (lowercased, whitespace runs → single dash, deduped). File **mtime is NEVER a date source**. Date resolution priority: media-embedded date (EXIF/`creation_time`) → day precision; else year hint → year precision (`YYYY-01-01`…`YYYY-12-31`); else `unknown`.

- [ ] **Step 1: Write the failing test matrix**

Create `src/worker/conventions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseConventions, resolveItemDate, titleFromFilename } from './conventions.js';

describe('parseConventions', () => {
  const cases: [string, { year?: number; tags: string[]; filename: string }][] = [
    ['1994/christmas/clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }],
    ['clip.mp4', { tags: [], filename: 'clip.mp4' }],
    ['1994/clip.mp4', { year: 1994, tags: [], filename: 'clip.mp4' }],
    ['christmas/Family Dinner/clip.mp4', { tags: ['christmas', 'family-dinner'], filename: 'clip.mp4' }],
    ['1994/Christmas Morning/Tape 04/clip.mp4', { year: 1994, tags: ['christmas-morning', 'tape-04'], filename: 'clip.mp4' }],
    // year must be the FIRST segment
    ['summer/1994/clip.mp4', { tags: ['summer', '1994'], filename: 'clip.mp4' }],
    // a second year-looking segment is just a tag
    ['1994/1995/clip.mp4', { year: 1994, tags: ['1995'], filename: 'clip.mp4' }],
    // 18xx/19xx/20xx only
    ['1850/photos/scan.jpg', { year: 1850, tags: ['photos'], filename: 'scan.jpg' }],
    ['1799/scan.jpg', { tags: ['1799'], filename: 'scan.jpg' }],
    ['2150/scan.jpg', { tags: ['2150'], filename: 'scan.jpg' }],
    // windows separators + duplicate tags collapse
    ['1994\\christmas\\clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }],
    ['1994/christmas/christmas/clip.mp4', { year: 1994, tags: ['christmas'], filename: 'clip.mp4' }],
  ];
  for (const [input, expected] of cases) {
    it(`parses '${input}'`, () => {
      expect(parseConventions(input)).toEqual(expected);
    });
  }
});

describe('titleFromFilename', () => {
  it('strips the extension and turns dashes/underscores into spaces', () => {
    expect(titleFromFilename('christmas-morning_01.mp4')).toBe('christmas morning 01');
    expect(titleFromFilename('clip.mp4')).toBe('clip');
    expect(titleFromFilename('IMG 4021.JPG')).toBe('IMG 4021');
  });
});

describe('resolveItemDate', () => {
  it('prefers the media-embedded date at day precision', () => {
    expect(resolveItemDate('1994-12-25', 1990)).toEqual({ dateStart: '1994-12-25', dateEnd: '1994-12-25', precision: 'day' });
  });
  it('falls back to the year hint at year precision', () => {
    expect(resolveItemDate(null, 1994)).toEqual({ dateStart: '1994-01-01', dateEnd: '1994-12-31', precision: 'year' });
  });
  it('is unknown when neither exists (mtime is never used)', () => {
    expect(resolveItemDate(null)).toEqual({ dateStart: null, dateEnd: null, precision: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/conventions.test.ts`
Expected: FAIL — `Failed to resolve import "./conventions.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/worker/conventions.ts`:

```ts
/**
 * Ingest path conventions (spec §7): /ingest/<year>/<tag>/…/file.ext
 * The watcher passes paths RELATIVE to the ingest root. Pure functions only.
 * File mtime is NEVER used as a date source anywhere in ingestion.
 */

export interface ConventionHints {
  year?: number;
  tags: string[];
  filename: string;
}

const YEAR_RE = /^(18|19|20)\d\d$/;

export function parseConventions(relPath: string): ConventionHints {
  const segments = relPath.replace(/\\/g, '/').split('/').filter((s) => s.length > 0);
  const filename = segments.pop() ?? '';
  const dirs = [...segments];
  let year: number | undefined;
  if (dirs.length > 0 && YEAR_RE.test(dirs[0])) {
    year = Number(dirs.shift());
  }
  const tags = [...new Set(
    dirs
      .map((d) => d.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter((t) => t.length > 0),
  )];
  return year === undefined ? { tags, filename } : { year, tags, filename };
}

/** Documented decision 1: ingest pre-fills items.title from the filename. */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

export interface ResolvedDate {
  dateStart: string | null;
  dateEnd: string | null;
  precision: 'day' | 'year' | 'unknown';
}

/** EXIF/container date (day) beats year hint (year) beats nothing (unknown). */
export function resolveItemDate(mediaDate: string | null, yearHint?: number): ResolvedDate {
  if (mediaDate) return { dateStart: mediaDate, dateEnd: mediaDate, precision: 'day' };
  if (yearHint !== undefined) {
    return { dateStart: `${yearHint}-01-01`, dateEnd: `${yearHint}-12-31`, precision: 'year' };
  }
  return { dateStart: null, dateEnd: null, precision: 'unknown' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/worker/conventions.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/conventions.ts src/worker/conventions.test.ts
git commit -m "feat: ingest path conventions parser with year/tag hints and date resolution"
```

---

### Task 9: Ingest processing — hashing, item creation, hints-as-tags, holiday tags

**Files:**
- Create: `src/worker/ingest-watcher.ts` (processing core; chokidar wiring in Task 10)
- Test: `src/worker/ingest-watcher.test.ts`

**Interfaces:**
- Consumes: `parseConventions`, `resolveItemDate`, `titleFromFilename` (Task 8); `probeVideo` (Task 5); `logIngestFailure`, `WorkerDb` (Tasks 2–3); `sortDate` (Contract 5); `applyHolidayTags` (phase 06, pinned); `StorageAdapter` (Contract 2); fixtures (Task 1).
- Produces (used by Tasks 10, 14):

```ts
export const SUPPORTED_EXTENSIONS: Record<string, 'video' | 'photo'>; // mp4 m4v webm mov | jpg jpeg png webp avif heic
export interface IngestDeps {
  db: WorkerDb; storage: StorageAdapter; ingestPath: string; mediaPath: string; ownerId: string;
  enqueue(kind: 'derivatives' | 'sprite', payload: Record<string, unknown>): Promise<void>;
}
export type IngestResult =
  | { status: 'ingested'; itemId: string }
  | { status: 'duplicate'; existingItemId: string }
  | { status: 'failed'; reason: string };
export function sha256File(filePath: string): Promise<string>;
export function processIngestFile(deps: IngestDeps, absPath: string): Promise<IngestResult>;
```

Behavior: sha256 the stable file → if `items.sha256` already exists, move to `INGEST_PATH/_duplicates/` and log. Else create the item (`status='needs_review'`, `source='ingest'`, `uploadedBy=ownerId`, title from filename, hints pre-attached as topic tags — documented decision 1), **rename** (not copy; EXDEV fallback copies+unlinks for cross-device bind mounts) into `MEDIA_PATH/media/<id>/original.<ext>`, insert the `original` item_files row, `applyHolidayTags` when a day-precision date was found, enqueue `derivatives` (+ `sprite` for videos). Unreadable/unsupported → `_failed/` + `logIngestFailure` (Task 10 tests that path).

- [ ] **Step 1: Write the failing tests**

Create `src/worker/ingest-watcher.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { FIXTURE_JPG, FIXTURE_MP4, generateFixtures } from '../../e2e/fixtures/generate.js';
import * as schema from '../lib/server/db/schema.js';
import { createFsStorage } from '../lib/server/platform/storage-fs.js';
import { processIngestFile, sha256File, type IngestDeps } from './ingest-watcher.js';
import { createTestDb, seedOwner } from './test-helpers.js';

beforeAll(async () => {
  await generateFixtures();
});

interface Env { deps: IngestDeps; enqueued: { kind: string; payload: Record<string, unknown> }[]; ingestPath: string; }

function makeEnv(): Env {
  const db = createTestDb();
  const ownerId = seedOwner(db);
  const ingestPath = mkdtempSync(join(tmpdir(), 'shoebox-ingest-'));
  const mediaPath = mkdtempSync(join(tmpdir(), 'shoebox-media-'));
  const enqueued: Env['enqueued'] = [];
  return {
    enqueued,
    ingestPath,
    deps: {
      db, storage: createFsStorage(mediaPath), ingestPath, mediaPath, ownerId,
      enqueue: async (kind, payload) => { enqueued.push({ kind, payload }); },
    },
  };
}

async function drop(env: Env, relPath: string, fixture: string): Promise<string> {
  const abs = join(env.ingestPath, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await copyFile(fixture, abs);
  return abs;
}

describe('sha256File', () => {
  it('hashes a file to 64 hex chars, stable across calls', async () => {
    const env = makeEnv();
    const abs = await drop(env, 'clip.mp4', FIXTURE_MP4);
    const a = await sha256File(abs);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256File(abs)).toBe(a);
  });
});

describe('processIngestFile (video, year+tag hints)', () => {
  it('creates a needs_review ingest item with year-precision date, hint tags, moved original, and enqueued jobs', async () => {
    const env = makeEnv();
    const abs = await drop(env, '1994/christmas/clip.mp4', FIXTURE_MP4);
    const result = await processIngestFile(env.deps, abs);
    expect(result.status).toBe('ingested');
    const itemId = (result as { itemId: string }).itemId;

    const item = env.deps.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
    expect(item.type).toBe('video');
    expect(item.status).toBe('needs_review');
    expect(item.source).toBe('ingest');
    expect(item.uploadedBy).toBe(env.deps.ownerId);
    expect(item.title).toBe('clip');
    expect(item.dateStart).toBe('1994-01-01');   // no creation_time in fixture → year hint
    expect(item.dateEnd).toBe('1994-12-31');
    expect(item.datePrecision).toBe('year');
    expect(item.width).toBe(320);
    expect(item.height).toBe(180);
    expect(Math.abs((item.duration ?? 0) - 2)).toBeLessThan(0.5);

    // original was MOVED into managed storage under the Contract 7 key
    expect(existsSync(abs)).toBe(false);
    expect(existsSync(join(env.deps.mediaPath, `media/${itemId}/original.mp4`))).toBe(true);
    const orig = env.deps.db.select().from(schema.itemFiles).where(eq(schema.itemFiles.itemId, itemId)).all();
    expect(orig).toHaveLength(1);
    expect(orig[0].kind).toBe('original');
    expect(orig[0].mime).toBe('video/mp4');

    // documented decision 1: hint tags pre-attached as topic tags
    const tagNames = env.deps.db
      .select({ name: schema.tags.name, kind: schema.tags.kind })
      .from(schema.itemTags)
      .innerJoin(schema.tags, eq(schema.itemTags.tagId, schema.tags.id))
      .where(eq(schema.itemTags.itemId, itemId))
      .all();
    expect(tagNames.map((t) => t.name)).toContain('christmas');

    expect(env.enqueued.map((e) => e.kind).sort()).toEqual(['derivatives', 'sprite']);
    expect(env.enqueued[0].payload).toEqual({ itemId });
  });
});

describe('processIngestFile (photo with EXIF date)', () => {
  it('uses the EXIF day-precision date over the year hint and applies holiday tags', async () => {
    const env = makeEnv();
    // year hint 1990 must LOSE to EXIF 1994-12-25
    const abs = await drop(env, '1990/photo.jpg', FIXTURE_JPG);
    const result = await processIngestFile(env.deps, abs);
    expect(result.status).toBe('ingested');
    const itemId = (result as { itemId: string }).itemId;

    const item = env.deps.db.select().from(schema.items).where(eq(schema.items.id, itemId)).get()!;
    expect(item.type).toBe('photo');
    expect(item.dateStart).toBe('1994-12-25');
    expect(item.datePrecision).toBe('day');
    expect(item.sortDate).toBe('1994-12-25');
    expect(item.width).toBe(640);
    expect(item.height).toBe(480);

    // applyHolidayTags (phase 06) fires on day precision: christmas
    const tagNames = env.deps.db
      .select({ name: schema.tags.name })
      .from(schema.itemTags)
      .innerJoin(schema.tags, eq(schema.itemTags.tagId, schema.tags.id))
      .where(eq(schema.itemTags.itemId, itemId))
      .all()
      .map((t) => t.name);
    expect(tagNames).toContain('christmas');

    // photos enqueue derivatives only — no sprite
    expect(env.enqueued.map((e) => e.kind)).toEqual(['derivatives']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/ingest-watcher.test.ts`
Expected: FAIL — `Failed to resolve import "./ingest-watcher.js"`.

- [ ] **Step 3: Write the implementation (processing core)**

Create `src/worker/ingest-watcher.ts`:

```ts
/**
 * Ingestion folder pipeline (Docker only, spec §7):
 *   stable file under INGEST_PATH
 *     → sha256 → duplicate?            → INGEST_PATH/_duplicates/ + log
 *     → unsupported/unreadable?        → INGEST_PATH/_failed/ + failed ingest_scan jobs row
 *     → else: create needs_review item, MOVE original into MEDIA_PATH (rename;
 *       EXDEV copy+unlink fallback for cross-device bind mounts), pre-attach
 *       hint tags + title (documented decision 1), holiday tags on day dates,
 *       enqueue derivatives (+ sprite for video).
 * Date sources: EXIF (photos) / container creation_time (videos) / path year
 * hint. File mtime is NEVER consulted.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import exifr from 'exifr';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as schema from '../lib/server/db/schema.js';
import { sortDate } from '../lib/domain/dates.js';
import { applyHolidayTags } from '../lib/server/items.js';
import type { StorageAdapter } from '../lib/server/platform/types.js';
import { parseConventions, resolveItemDate, titleFromFilename } from './conventions.js';
import { probeVideo } from './derivatives.js';
import { logIngestFailure, type WorkerDb } from './jobs.js';

export const SUPPORTED_EXTENSIONS: Record<string, 'video' | 'photo'> = {
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video',
  jpg: 'photo', jpeg: 'photo', png: 'photo', webp: 'photo', avif: 'photo', heic: 'photo',
};

export interface IngestDeps {
  db: WorkerDb;
  storage: StorageAdapter;
  ingestPath: string;
  mediaPath: string;
  ownerId: string;
  enqueue(kind: 'derivatives' | 'sprite', payload: Record<string, unknown>): Promise<void>;
}

export type IngestResult =
  | { status: 'ingested'; itemId: string }
  | { status: 'duplicate'; existingItemId: string }
  | { status: 'failed'; reason: string };

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** rename() with copy+unlink fallback: /ingest and /data are often different devices. */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function moveAside(deps: IngestDeps, absPath: string, bucket: '_duplicates' | '_failed'): Promise<void> {
  const name = basename(absPath);
  let target = join(deps.ingestPath, bucket, name);
  for (let n = 1; existsSync(target); n += 1) {
    target = join(deps.ingestPath, bucket, `${n}-${name}`);
  }
  await moveFile(absPath, target);
}

/** EXIF DateTimeOriginal/CreateDate → 'YYYY-MM-DD' (photos). */
async function photoExifDate(absPath: string): Promise<string | null> {
  try {
    const exif = (await exifr.parse(absPath, ['DateTimeOriginal', 'CreateDate'])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    if (year <= 1970 || year > 2100) return null;
    const pad = (x: number): string => String(x).padStart(2, '0');
    return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // EXIF is local time
  } catch {
    return null;
  }
}

export async function processIngestFile(deps: IngestDeps, absPath: string): Promise<IngestResult> {
  const relPath = relative(deps.ingestPath, absPath).split(sep).join('/');
  if (relPath.startsWith('_duplicates/') || relPath.startsWith('_failed/') || relPath.startsWith('..')) {
    return { status: 'failed', reason: 'outside ingest scope' };
  }

  const fail = async (reason: string): Promise<IngestResult> => {
    logIngestFailure(deps.db, relPath, reason);
    await moveAside(deps, absPath, '_failed');
    console.error(`[ingest] FAILED ${relPath}: ${reason}`);
    return { status: 'failed', reason };
  };

  const ext = extname(absPath).slice(1).toLowerCase();
  const type = SUPPORTED_EXTENSIONS[ext];
  if (!type) return fail(`unsupported extension .${ext}`);

  let sniffed: Awaited<ReturnType<typeof fileTypeFromFile>>;
  try {
    sniffed = await fileTypeFromFile(absPath);
  } catch (err) {
    return fail(`unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!sniffed) return fail('unrecognized file contents');
  const contentsMatch = type === 'video' ? sniffed.mime.startsWith('video/') : sniffed.mime.startsWith('image/');
  if (!contentsMatch) return fail(`contents (${sniffed.mime}) do not match extension .${ext}`);

  const sha256 = await sha256File(absPath);
  const existing = deps.db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.sha256, sha256))
    .get();
  if (existing) {
    await moveAside(deps, absPath, '_duplicates');
    console.log(`[ingest] duplicate of item ${existing.id}: ${relPath}`);
    return { status: 'duplicate', existingItemId: existing.id };
  }

  const hints = parseConventions(relPath);
  let width = 0;
  let height = 0;
  let duration: number | null = null;
  let mediaDate: string | null = null;
  try {
    if (type === 'video') {
      const probe = await probeVideo(absPath);
      width = probe.width;
      height = probe.height;
      duration = probe.duration;
      mediaDate = probe.creationTime;
    } else {
      const meta = await sharp(absPath).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width];
      mediaDate = await photoExifDate(absPath);
    }
  } catch (err) {
    return fail(`could not read media: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (width <= 0 || height <= 0) return fail('could not determine dimensions');

  const date = resolveItemDate(mediaDate, hints.year);
  const id = nanoid(12);
  const sizeBytes = (await stat(absPath)).size;
  const storageKey = `media/${id}/original.${ext}`;
  await moveFile(absPath, join(deps.mediaPath, storageKey));

  deps.db.transaction((tx) => {
    tx.insert(schema.items)
      .values({
        id,
        type,
        title: titleFromFilename(hints.filename) || null,
        dateStart: date.dateStart,
        dateEnd: date.dateEnd,
        datePrecision: date.precision,
        sortDate: sortDate({ dateStart: date.dateStart, dateEnd: date.dateEnd, precision: date.precision }),
        duration,
        width,
        height,
        sizeBytes,
        sha256,
        source: 'ingest',
        status: 'needs_review',
        uploadedBy: deps.ownerId,
        createdAt: new Date(),
      })
      .run();
    tx.insert(schema.itemFiles)
      .values({ id: nanoid(12), itemId: id, kind: 'original', storageKey, mime: sniffed!.mime, width, height })
      .run();
    // Documented decision 1: hint chips ARE tags — pre-attach as topic tags.
    for (const tagName of hints.tags) {
      tx.insert(schema.tags).values({ id: nanoid(12), name: tagName, kind: 'topic' }).onConflictDoNothing().run();
      const tag = tx.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.name, tagName)).get()!;
      tx.insert(schema.itemTags).values({ itemId: id, tagId: tag.id }).onConflictDoNothing().run();
    }
  });

  if (date.precision === 'day') await applyHolidayTags(deps.db, id);
  await deps.enqueue('derivatives', { itemId: id });
  if (type === 'video') await deps.enqueue('sprite', { itemId: id });
  console.log(`[ingest] created item ${id} from ${relPath}`);
  return { status: 'ingested', itemId: id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/worker/ingest-watcher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/ingest-watcher.ts src/worker/ingest-watcher.test.ts
git commit -m "feat: ingest file processing with dedupe-by-sha256 and hints-as-tags"
```

---

### Task 10: Duplicates, `_failed` routing & the chokidar watcher

**Files:**
- Modify: `src/worker/ingest-watcher.ts` (append `startIngestWatcher`)
- Modify: `src/worker/index.ts` (uncomment watcher wiring)
- Test: `src/worker/ingest-watcher.test.ts` (append)

**Interfaces:**
- Consumes: Task 9's `processIngestFile`, `IngestDeps`; `chokidar`.
- Produces (used by `main()` and Task 14):

```ts
export function startIngestWatcher(
  deps: IngestDeps,
  opts?: { stabilityMs?: number },   // default 2000 (spec: awaitWriteFinish 2s); tests use 100
): { idle(): Promise<void>; close(): Promise<void> };
```

- [ ] **Step 1: Append the failing tests**

Append to `src/worker/ingest-watcher.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { startIngestWatcher } from './ingest-watcher.js';

describe('processIngestFile (duplicates and failures)', () => {
  it('moves a re-dropped identical file to _duplicates', async () => {
    const env = makeEnv();
    const first = await drop(env, '1994/christmas/clip.mp4', FIXTURE_MP4);
    await processIngestFile(env.deps, first);
    const second = await drop(env, '1994/christmas/clip-copy.mp4', FIXTURE_MP4);
    const result = await processIngestFile(env.deps, second);
    expect(result.status).toBe('duplicate');
    expect(existsSync(second)).toBe(false);
    expect(readdirSync(join(env.ingestPath, '_duplicates'))).toEqual(['clip-copy.mp4']);
    // no second item created
    expect(env.deps.db.select().from(schema.items).all()).toHaveLength(1);
  });

  it('routes unsupported extensions to _failed with a failed ingest_scan jobs row', async () => {
    const env = makeEnv();
    const abs = await drop(env, 'notes/readme.txt', FIXTURE_JPG); // any bytes; .txt is unsupported
    const result = await processIngestFile(env.deps, abs);
    expect(result.status).toBe('failed');
    expect(readdirSync(join(env.ingestPath, '_failed'))).toEqual(['readme.txt']);
    const jobs = env.deps.db.select().from(schema.jobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('ingest_scan');
    expect(jobs[0].status).toBe('failed');
    expect(JSON.parse(jobs[0].payload)).toEqual({ path: 'notes/readme.txt', reason: 'unsupported extension .txt' });
  });

  it('routes extension/content mismatches to _failed', async () => {
    const env = makeEnv();
    const abs = await drop(env, '1994/fake.mp4', FIXTURE_JPG); // jpeg bytes named .mp4
    const result = await processIngestFile(env.deps, abs);
    expect(result.status).toBe('failed');
    expect((result as { reason: string }).reason).toContain('do not match');
    expect(readdirSync(join(env.ingestPath, '_failed'))).toEqual(['fake.mp4']);
  });
});

describe('startIngestWatcher', () => {
  it('picks up files dropped after start, once size is stable', async () => {
    const env = makeEnv();
    const watcher = startIngestWatcher(env.deps, { stabilityMs: 100 });
    try {
      await drop(env, '1994/christmas/clip.mp4', FIXTURE_MP4);
      // poll until the item lands (stability window + processing)
      const deadline = Date.now() + 15_000;
      for (;;) {
        await watcher.idle();
        if (env.deps.db.select().from(schema.items).all().length === 1) break;
        if (Date.now() > deadline) throw new Error('watcher never ingested the file');
        await new Promise((r) => setTimeout(r, 100));
      }
      const item = env.deps.db.select().from(schema.items).all()[0];
      expect(item.status).toBe('needs_review');
      expect(item.source).toBe('ingest');
    } finally {
      await watcher.close();
    }
  });

  it('ignores files inside _duplicates and _failed', async () => {
    const env = makeEnv();
    await mkdir(join(env.ingestPath, '_duplicates'), { recursive: true });
    await drop(env, '_duplicates/old.mp4', FIXTURE_MP4);
    const watcher = startIngestWatcher(env.deps, { stabilityMs: 100 });
    try {
      await new Promise((r) => setTimeout(r, 1500));
      await watcher.idle();
      expect(env.deps.db.select().from(schema.items).all()).toHaveLength(0);
    } finally {
      await watcher.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/worker/ingest-watcher.test.ts`
Expected: FAIL — `startIngestWatcher` is not exported.

- [ ] **Step 3: Append the watcher implementation**

Append to `src/worker/ingest-watcher.ts`:

```ts
import chokidar from 'chokidar';

/**
 * chokidar watcher over INGEST_PATH. A file is claimed only after its size is
 * stable for `stabilityMs` (spec: 2 s) via awaitWriteFinish. Files are
 * processed strictly sequentially (promise chain) so two drops can never race
 * on dedupe. `_duplicates/` and `_failed/` are never watched.
 */
export function startIngestWatcher(
  deps: IngestDeps,
  opts: { stabilityMs?: number } = {},
): { idle(): Promise<void>; close(): Promise<void> } {
  const stabilityMs = opts.stabilityMs ?? 2000;
  let queue: Promise<void> = Promise.resolve();
  const watcher = chokidar.watch(deps.ingestPath, {
    ignoreInitial: false, // process any backlog present at startup
    ignored: (p: string) =>
      p.includes(`${sep}_duplicates${sep}`) || p.endsWith(`${sep}_duplicates`) ||
      p.includes(`${sep}_failed${sep}`) || p.endsWith(`${sep}_failed`),
    awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: Math.min(200, stabilityMs) },
  });
  watcher.on('add', (absPath: string) => {
    queue = queue
      .then(() => processIngestFile(deps, absPath))
      .then(
        () => undefined,
        (err) => console.error(`[ingest] unexpected error for ${absPath}`, err),
      );
  });
  return {
    idle: () => queue.then(() => undefined),
    close: async () => {
      await watcher.close();
      await queue;
    },
  };
}
```

- [ ] **Step 4: Wire the watcher into `src/worker/index.ts`**

In `src/worker/index.ts`: uncomment `import { startIngestWatcher } from './ingest-watcher.js';` and replace the ingest block inside `main()` with:

```ts
  let watcher: { close(): Promise<void> } | null = null;
  if (ingestPath) {
    const ownerId = await waitForOwner(db);
    console.log(`[worker] ingestion watcher on ${ingestPath}`);
    watcher = startIngestWatcher({
      db,
      storage,
      ingestPath,
      mediaPath,
      ownerId,
      enqueue: (kind, payload) => queue.enqueue(kind, payload),
    });
  }
```

(Delete the `void queue; void ownerId;` line — both are now used.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/worker/ingest-watcher.test.ts && pnpm check`
Expected: PASS (8 tests), 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/worker/ingest-watcher.ts src/worker/ingest-watcher.test.ts src/worker/index.ts
git commit -m "feat: chokidar ingestion watcher with duplicate and _failed routing"
```

<!-- CONTINUE -->



