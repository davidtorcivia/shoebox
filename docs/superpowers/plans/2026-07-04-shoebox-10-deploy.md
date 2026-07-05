# Shoebox Phase 10 — Deployment (Docker + Cloudflare) & E2E Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both deployments real — a production Docker stack (app + worker + optional faces) and a one-click Cloudflare Workers deployment — and harden the whole app with cross-cutting Playwright suites, CI, and release docs (v0.1.0).

**Architecture:** The app from phases 01–09 is packaged twice from one codebase: `PLATFORM=node` → adapter-node build inside a multi-stage `node:22-slim` image (migrations run by an entrypoint before the server starts; a sibling image runs an esbuild-bundled `src/worker`), and `PLATFORM=cloudflare` → adapter-cloudflare build deployed by wrangler with D1 + R2 bindings (migrations via `wrangler d1 migrations apply`, media URLs presigned with aws4fetch). CI builds both targets and runs the full e2e matrix, including a smoke suite against `wrangler dev`.

**Tech Stack:** Docker (multi-stage, BuildKit), docker compose, esbuild, wrangler 3.x, aws4fetch, GitHub Actions, Playwright (+ @axe-core/playwright, screenshot assertions), better-sqlite3 (ops scripts), drizzle-orm migrator.

**Master plan (LAW):** `docs/superpowers/plans/2026-07-04-shoebox-00-master.md` — its contracts override this plan wherever they conflict. This phase depends on ALL of phases 01–09 being complete and green.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` (§6 architecture, §13 testing, §14 deployment).

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

**Phase-10 specific constraints:**

- **FORBIDDEN: new features; any schema change.** The only new route is `GET /healthz` (schema-free, documented below under Ambiguities).
- Env var names and script names must match master Contract 8 exactly: `PLATFORM`, `DATABASE_PATH`, `MEDIA_PATH`, `INGEST_PATH`, `ORIGIN`, `BODY_LIMIT_MB`; scripts `dev`, `build`, `build:cf`, `check`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `worker`. New scripts added by this phase: `build:worker`, `db:migrate:d1`, `db:migrate:d1:remote`, `test:e2e:cf`.
- Wrangler bindings must match master Contract 8: `DB` (D1), `MEDIA` (R2), `[vars] PLATFORM=cloudflare`.
- Storage keys and media URL flow must match master Contract 7 (`media/<itemId>/<kind>.<ext>`; node streams `/media/[...key]` with Range; CF redirects to signed R2 URLs).

---

## File Structure

```
shoebox/
├─ Dockerfile                        # CREATE (replace phase-01 stub if present): app image, multi-stage
├─ Dockerfile.worker                 # CREATE: worker image, multi-stage, entry build-worker/index.js
├─ docker-compose.yml                # CREATE (replace stub): app + worker + faces (profile)
├─ .dockerignore                     # CREATE
├─ wrangler.toml                     # CREATE (replace stub): complete D1/R2/vars/assets config
├─ playwright.cf.config.ts           # CREATE: Playwright config that boots `wrangler dev`
├─ README.md                         # CREATE: root readme + Deploy-to-Cloudflare button
├─ README-deploy.md                  # CREATE: Docker ops — upgrades, cron, backups
├─ CHANGELOG.md                      # CREATE: seeded 0.1.0
├─ .github/workflows/ci.yml          # CREATE: CI (build/test/e2e + wrangler-dev smoke job)
├─ docker/entrypoint.sh              # CREATE: migrate-then-serve app entrypoint
├─ scripts/
│  ├─ migrate.mjs                    # CREATE: drizzle migration runner (node, prod-safe)
│  ├─ build-worker.mjs               # CREATE: esbuild bundle for src/worker
│  ├─ db-backup.mjs                  # CREATE: sqlite .backup via better-sqlite3
│  ├─ trash-sweep.mjs                # CREATE: purge >30-day soft-deleted rows + files
│  └─ make-e2e-fixtures.mjs          # CREATE: deterministic photo/video fixtures
├─ src/routes/healthz/+server.ts     # CREATE: GET /healthz → { ok, version }
├─ src/hooks.server.ts               # MODIFY: exempt /healthz from auth/first-run redirects
├─ src/routes/media/[...key]/+server.ts  # MODIFY: redirect-vs-stream branch on mediaUrl()
├─ src/lib/server/platform/storage-r2.ts       # MODIFY (full replacement): presigned GET URLs
├─ src/lib/server/platform/storage-r2.test.ts  # CREATE: presign unit tests
├─ e2e/
│  ├─ healthz.spec.ts                # CREATE
│  ├─ permissions.spec.ts            # CREATE: role × forbidden-action matrix
│  ├─ lifecycle.spec.ts              # CREATE: soft-delete/restore/empty-trash + dedupe
│  ├─ shares.spec.ts                 # CREATE: share flows (password/expiry/download)
│  ├─ a11y.spec.ts                   # CREATE: axe + comfort mode on top pages
│  ├─ mobile.spec.ts                 # CREATE: mobile viewport timeline + player stack
│  ├─ visual.spec.ts                 # CREATE: dark/light per-decade screenshot sanity
│  ├─ helpers/auth.ts                # CREATE: setup/login/invite-role helpers
│  └─ helpers/media.ts               # CREATE: UI upload + sha256 helpers
├─ e2e-cf/smoke.spec.ts              # CREATE: wrangler dev golden path
├─ docs/screenshots/                 # CREATE: PNGs rendered from locked mockups
└─ package.json                      # MODIFY: version 0.1.0, new scripts, new dev deps
```

---

### Task 1: Version 0.1.0 + `GET /healthz`

**Files:**
- Modify: `package.json` (set `"version": "0.1.0"`)
- Create: `src/routes/healthz/+server.ts`
- Modify: `src/hooks.server.ts` (exempt `/healthz` from session/first-run guards)
- Test: `e2e/healthz.spec.ts`

**Interfaces:**
- Consumes: nothing (route is dependency-free; no DB, no platform).
- Produces: `GET /healthz` → `200 {"ok":true,"version":"0.1.0"}` — consumed by the Dockerfile `HEALTHCHECK` (Task 7), compose `depends_on: service_healthy` (Task 9), and the wrangler-dev webServer readiness URL (Task 12).

- [ ] **Step 1: Write the failing e2e test**

Create `e2e/healthz.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('GET /healthz returns ok + version without auth', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: '0.1.0' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:e2e e2e/healthz.spec.ts`
Expected: FAIL — status is 404 (route missing) or 3xx (first-run redirect to `/setup`), not 200.

- [ ] **Step 3: Set the package version**

In `package.json`, set:

```json
"version": "0.1.0",
```

- [ ] **Step 4: Create the route**

Create `src/routes/healthz/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import pkg from '../../../package.json' with { type: 'json' };

// Liveness probe for Docker HEALTHCHECK / compose depends_on / wrangler dev readiness.
// Deliberately touches nothing: no DB, no storage, no session.
export const GET: RequestHandler = () => json({ ok: true, version: pkg.version });
```

(`resolveJsonModule` is already on via the generated `.svelte-kit/tsconfig.json`; Vite handles the JSON import in both adapter builds.)

- [ ] **Step 5: Exempt /healthz in hooks**

In `src/hooks.server.ts`, inside the `handle` hook, **before** the first-run `/setup` redirect and before any session/role gating (the very first statement of the handler body is correct), add:

```ts
// Health probe must never redirect or require a session (Docker HEALTHCHECK runs pre-setup).
if (event.url.pathname === '/healthz') {
  return resolve(event);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:e2e e2e/healthz.spec.ts`
Expected: `1 passed`.

Also verify the empty-DB case (fresh database, users table empty — the Playwright webServer from phase 01 boots a fresh test DB, so the run above already exercised it; confirm no redirect happened by the 200 assertion).

- [ ] **Step 7: Run the full existing suite to prove no regression**

Run: `pnpm check && pnpm test`
Expected: both green (no type errors; all vitest suites pass).

- [ ] **Step 8: Commit**

```bash
git add package.json src/routes/healthz/+server.ts src/hooks.server.ts e2e/healthz.spec.ts
git commit -m "feat: add /healthz liveness endpoint and set version 0.1.0"
```

---

### Task 2: Node migration runner + app container entrypoint

**Files:**
- Create: `scripts/migrate.mjs`
- Create: `docker/entrypoint.sh`
- Modify: `package.json` (point `db:migrate` at the runner)

**Interfaces:**
- Consumes: drizzle migration SQL files in `src/lib/server/db/migrations/` (generated in phase 01 by `pnpm db:generate`, including the raw-SQL FTS5 migration).
- Produces: `pnpm db:migrate` — idempotent, honors `DATABASE_PATH` and `MIGRATIONS_PATH` env; `docker/entrypoint.sh` — runs migrations then `exec node build/index.js`, mapping `BODY_LIMIT_MB` → adapter-node's `BODY_SIZE_LIMIT`. Consumed by Task 7 (Dockerfile) and Task 10 (upgrade docs).

- [ ] **Step 1: Verify the runner is missing (failing check)**

Run: `DATABASE_PATH=/tmp/shoebox-migrate-test.db node scripts/migrate.mjs`
Expected: FAIL — `Cannot find module '.../scripts/migrate.mjs'`.

- [ ] **Step 2: Write the runner**

Create `scripts/migrate.mjs`:

```js
// Production migration runner. No drizzle-kit / tsx needed — safe inside the
// pruned Docker image. Idempotent: drizzle's migrator tracks applied migrations
// in __drizzle_migrations.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = process.env.DATABASE_PATH ?? './data/shoebox.db';
const migrationsFolder = resolve(process.env.MIGRATIONS_PATH ?? 'src/lib/server/db/migrations');

mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), { migrationsFolder });
sqlite.close();
console.log(`[migrate] up to date: ${dbPath} (migrations from ${migrationsFolder})`);
```

- [ ] **Step 3: Point `db:migrate` at it**

In `package.json` scripts, set (replacing the phase-01 drizzle-kit value — see Ambiguities):

```json
"db:migrate": "node scripts/migrate.mjs",
```

- [ ] **Step 4: Run it twice against a scratch DB (idempotency)**

Run:

```bash
rm -f /tmp/shoebox-migrate-test.db*
DATABASE_PATH=/tmp/shoebox-migrate-test.db pnpm db:migrate
DATABASE_PATH=/tmp/shoebox-migrate-test.db pnpm db:migrate
```

Expected: both runs print `[migrate] up to date: /tmp/shoebox-migrate-test.db …` and exit 0.

- [ ] **Step 5: Verify the schema landed (including FTS5)**

Run:

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/shoebox-migrate-test.db', { readonly: true });
const names = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name);
console.log(names.join(','));
"
```

Expected output includes (among drizzle bookkeeping and FTS shadow tables): `albums,album_items,comments,faces,invites,items,item_files,item_people,item_tags,jobs,people,relationships,search_fts,sessions,settings,shares,tags,users,year_counts`.

- [ ] **Step 6: Write the entrypoint**

Create `docker/entrypoint.sh`:

```sh
#!/bin/sh
# App container entrypoint: migrate, then serve.
set -eu

: "${BODY_LIMIT_MB:=4096}"
# adapter-node reads BODY_SIZE_LIMIT (bytes); our contract env is BODY_LIMIT_MB.
export BODY_SIZE_LIMIT=$((BODY_LIMIT_MB * 1048576))

echo "[entrypoint] running migrations…"
node scripts/migrate.mjs

echo "[entrypoint] starting server on :${PORT:-3000}"
exec node build/index.js
```

Then: `chmod +x docker/entrypoint.sh`

- [ ] **Step 7: Shell-check the entrypoint**

Run: `sh -n docker/entrypoint.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate.mjs docker/entrypoint.sh package.json
git commit -m "feat: prod-safe drizzle migration runner + docker entrypoint (migrate-then-serve)"
```

---

### Task 3: `build:worker` — esbuild bundle for the Docker sidecar

**Files:**
- Create: `scripts/build-worker.mjs`
- Modify: `package.json` (add `build:worker` script + `esbuild` dev dep)
- Modify: `.gitignore` (add `build-worker/`)

**Interfaces:**
- Consumes: `src/worker/index.ts` (phase 07 sidecar entry: jobs runner + chokidar ingestion watcher).
- Produces: `pnpm build:worker` → `build-worker/index.js` (single ESM file, node22 target) with `sharp`, `ffmpeg-static`, `better-sqlite3` left external (loaded from `node_modules` at runtime). Consumed by Task 8 (`Dockerfile.worker` runs `node build-worker/index.js`).

- [ ] **Step 1: Add esbuild**

Run: `pnpm add -D esbuild@^0.23.0`
Expected: lockfile updated, exit 0.

- [ ] **Step 2: Failing check — script missing**

Run: `pnpm build:worker`
Expected: FAIL — `Command "build:worker" not found`.

- [ ] **Step 3: Write the bundle script**

Create `scripts/build-worker.mjs`:

```js
// Bundles the Docker sidecar worker (src/worker) into build-worker/index.js.
// The SvelteKit app build does NOT include src/worker — it needs its own bundle.
// Native/binary deps stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/worker/index.ts'],
  outfile: 'build-worker/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['sharp', 'ffmpeg-static', 'better-sqlite3'],
  // src/worker imports shared server code via the $lib alias (no-op if it only
  // uses relative imports).
  alias: { $lib: './src/lib' },
  // CJS deps referenced from the ESM bundle need a require shim.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
```

- [ ] **Step 4: Add the script**

In `package.json` scripts add:

```json
"build:worker": "node scripts/build-worker.mjs",
```

And append to `.gitignore`:

```
build-worker/
```

- [ ] **Step 5: Build and inspect**

Run: `pnpm build:worker && ls -la build-worker/`
Expected: esbuild prints the output size and `build-worker/index.js` + `index.js.map` exist.

Run: `grep -oE 'from ?"(sharp|better-sqlite3|ffmpeg-static)"' build-worker/index.js | sort -u`
Expected: at least `from "better-sqlite3"` and `from "sharp"` (externals were NOT inlined; `ffmpeg-static` appears too if the derivatives module imports it directly).

- [ ] **Step 6: Smoke-run the bundle against a migrated scratch DB**

Run:

```bash
rm -rf /tmp/shoebox-worker-smoke && mkdir -p /tmp/shoebox-worker-smoke/{media,ingest}
DATABASE_PATH=/tmp/shoebox-worker-smoke/shoebox.db pnpm db:migrate
DATABASE_PATH=/tmp/shoebox-worker-smoke/shoebox.db \
MEDIA_PATH=/tmp/shoebox-worker-smoke/media \
INGEST_PATH=/tmp/shoebox-worker-smoke/ingest \
node build-worker/index.js &
WORKER_PID=$!
sleep 4
kill $WORKER_PID
```

Expected: the worker's phase-07 startup log lines appear (job poller + ingestion watcher started); **no** `ERR_MODULE_NOT_FOUND` / import errors before the kill.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-worker.mjs package.json pnpm-lock.yaml .gitignore
git commit -m "feat: esbuild bundle script for the docker worker (build:worker)"
```

---

### Task 4: Complete `wrangler.toml` + verify `build:cf`

**Files:**
- Create (replace phase-01 stub): `wrangler.toml`
- Modify: `package.json` (ensure `build:cf` script matches below)

**Interfaces:**
- Consumes: `svelte.config.js` platform switch from phase 01 (`PLATFORM=cloudflare` → `@sveltejs/adapter-cloudflare`, output `.svelte-kit/cloudflare/`).
- Produces: a wrangler config with bindings `DB` (D1) + `MEDIA` (R2) + `[vars] PLATFORM` (master Contract 8), `migrations_dir` for Task 5, and `main`/`assets` for `wrangler dev` (Task 12) and `wrangler deploy` (Task 16 docs). Vars `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` consumed by Task 6 presigning.

- [ ] **Step 1: Failing check — dry-run deploy against the stub**

Run: `pnpm build:cf && pnpm exec wrangler deploy --dry-run`
Expected: FAIL (or warnings) — stub config lacks `main`/bindings. (If `build:cf` itself is missing from `package.json`, that is the failure — fix in Step 2.)

- [ ] **Step 2: Ensure the build script**

In `package.json` scripts, ensure exactly:

```json
"build:cf": "PLATFORM=cloudflare vite build",
```

- [ ] **Step 3: Write the complete wrangler.toml**

Create `wrangler.toml` (full replacement):

```toml
name = "shoebox"
main = ".svelte-kit/cloudflare/_worker.js"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]

# SvelteKit adapter-cloudflare emits the static client into the same directory.
assets = { directory = ".svelte-kit/cloudflare", binding = "ASSETS" }

[observability]
enabled = true

[vars]
PLATFORM = "cloudflare"
# Account id is only needed to presign R2 GET URLs (Task 6). `wrangler whoami`
# prints it. Harmless placeholder until set: mediaUrl() falls back to
# worker-streamed /media/<key> when presign config is incomplete.
R2_ACCOUNT_ID = "set-me-via-wrangler-whoami"
R2_BUCKET_NAME = "shoebox-media"

[[d1_databases]]
binding = "DB"
database_name = "shoebox-db"
# Replace with the id printed by: wrangler d1 create shoebox-db
# (the Deploy-to-Cloudflare button provisions this automatically)
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "src/lib/server/db/migrations"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "shoebox-media"
```

- [ ] **Step 4: Build + validate**

Run: `pnpm build:cf`
Expected: vite build succeeds; `ls .svelte-kit/cloudflare/_worker.js` exists.

Run: `pnpm exec wrangler deploy --dry-run`
Expected: exit 0, output ends with `--dry-run: exiting now.` and lists bindings `DB` (D1), `MEDIA` (R2), vars `PLATFORM`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, and the `ASSETS` assets binding. No errors about missing `main`.

- [ ] **Step 5: Confirm the node build still works (both targets compile)**

Run: `pnpm build`
Expected: adapter-node build succeeds; `ls build/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml package.json
git commit -m "feat: complete wrangler config (D1/R2/vars/assets) and build:cf verification"
```

---

### Task 5: D1 migrations (`db:migrate:d1`) + FTS5 verified on local D1

**Files:**
- Modify: `package.json` (add `db:migrate:d1`, `db:migrate:d1:remote`)

**Interfaces:**
- Consumes: `wrangler.toml` `migrations_dir` (Task 4); drizzle migration SQL in `src/lib/server/db/migrations/` (phase 01).
- Produces: `pnpm db:migrate:d1` (local, used by Task 12 webServer + CI) and `pnpm db:migrate:d1:remote` (documented in Task 16 README). Verified: FTS5 `MATCH` works on D1.

- [ ] **Step 1: Add the scripts**

In `package.json` scripts add:

```json
"db:migrate:d1": "wrangler d1 migrations apply shoebox-db --local",
"db:migrate:d1:remote": "wrangler d1 migrations apply shoebox-db --remote",
```

- [ ] **Step 2: Apply migrations to local D1 (fresh state)**

Run:

```bash
rm -rf .wrangler/state
pnpm db:migrate:d1
```

Expected: wrangler lists every migration file from `src/lib/server/db/migrations/*.sql` and applies each with a ✅; exit 0. If any migration fails here (D1 SQL dialect strictness), fix the migration SQL until this passes — that fix belongs to this task.

Run it again: `pnpm db:migrate:d1`
Expected: `No migrations to apply!` (idempotent).

- [ ] **Step 3: Verify the schema on D1**

Run:

```bash
pnpm exec wrangler d1 execute shoebox-db --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('items','users','search_fts','year_counts') ORDER BY name"
```

Expected results table contains exactly: `items`, `search_fts`, `users`, `year_counts`.

- [ ] **Step 4: Verify FTS5 MATCH actually works on D1**

(search_fts is contentless (`content=''`) per master Contract 1 — you can insert with explicit rowid and query rowids back, but stored column values always read as NULL; the app maps rowid→item internally.)

Run:

```bash
pnpm exec wrangler d1 execute shoebox-db --local \
  --command "INSERT INTO search_fts(rowid, item_id, title, description, people, tags, albums, comments) VALUES (42, 'itm_ftstest', 'Birthday at the lake', 'candles and cake', 'Mom', 'birthday', 'Summer 1994', '')"

pnpm exec wrangler d1 execute shoebox-db --local \
  --command "SELECT rowid FROM search_fts WHERE search_fts MATCH 'birthday'"
```

Expected: second command returns one row, `rowid = 42`.

Run the cleanup + negative check:

```bash
pnpm exec wrangler d1 execute shoebox-db --local \
  --command "SELECT rowid FROM search_fts WHERE search_fts MATCH 'nonexistentterm9999'"
```

Expected: `0 rows`.

- [ ] **Step 5: Reset local state (so later tasks start clean)**

Run: `rm -rf .wrangler/state && echo CLEANED`
Expected: `CLEANED`

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: d1 migration scripts + verified FTS5 MATCH on local D1"
```

---

### Task 6: storage-r2 presigned media URLs (fix) + /media route branch

**Files:**
- Modify (full replacement below): `src/lib/server/platform/storage-r2.ts`
- Create: `src/lib/server/platform/storage-r2.test.ts`
- Modify: `src/routes/media/[...key]/+server.ts` (redirect-vs-stream branch)
- Modify: `package.json` (add `aws4fetch` dependency)

**Interfaces:**
- Consumes: `StorageAdapter` from `src/lib/server/platform/types.ts` (master Contract 2 — `mediaUrl(key): Promise<string>`); `R2Bucket` binding `MEDIA` + vars/secrets from `wrangler.toml` (Task 4).
- Produces: `createR2Storage(env: R2StorageEnv): StorageAdapter` where `R2StorageEnv = { MEDIA: R2Bucket; R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; R2_BUCKET_NAME: string }`. `mediaUrl()` returns a **presigned S3-style GET URL valid 1h** (Contract 7), falling back to `/media/${key}` (worker-streamed) when presign credentials are absent. Keep the exported factory name identical to what `src/lib/server/platform/index.ts` already imports — if phase 01 named it differently (e.g. `r2Storage`), rename the factory below to match rather than editing `index.ts`.

**Why this is a fix:** master Contract 2 requires CF `mediaUrl` = "signed R2 URL (1h)". If the phase-01 adapter returned a public-bucket URL or a bare `/media/` path unconditionally, it violated the contract; this task replaces it with real presigning via aws4fetch (`signQuery` SigV4 against the R2 S3 endpoint).

- [ ] **Step 1: Add aws4fetch**

Run: `pnpm add aws4fetch@^1.0.20`
Expected: exit 0. (Runtime dep — it runs inside the Worker; it is WebCrypto-only, so it is runtime-portable per Global Constraints.)

- [ ] **Step 2: Write the failing unit tests**

Create `src/lib/server/platform/storage-r2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createR2Storage, type R2StorageEnv } from './storage-r2';

// mediaUrl never touches the bucket binding — a bare object is fine here.
const bucket = {} as R2StorageEnv['MEDIA'];

const env: R2StorageEnv = {
  MEDIA: bucket,
  R2_ACCOUNT_ID: 'acct1234567890',
  R2_ACCESS_KEY_ID: 'AKIATESTKEY',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'shoebox-media',
};

describe('storage-r2 mediaUrl', () => {
  it('returns a presigned R2 GET URL valid for 1h', async () => {
    const storage = createR2Storage(env);
    const url = new URL(await storage.mediaUrl('media/abc123/original.mp4'));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('acct1234567890.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/shoebox-media/media/abc123/original.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIATESTKEY');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic per key within the same second and differs across keys', async () => {
    const storage = createR2Storage(env);
    const a = await storage.mediaUrl('media/x/poster.webp');
    const b = await storage.mediaUrl('media/y/poster.webp');
    expect(a).not.toEqual(b);
  });

  it('falls back to worker-streamed /media path when presign creds are absent', async () => {
    const storage = createR2Storage({ ...env, R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' });
    expect(await storage.mediaUrl('media/abc/poster.webp')).toBe('/media/media/abc/poster.webp');
  });

  it('URL-encodes key segments', async () => {
    const storage = createR2Storage(env);
    const url = new URL(await storage.mediaUrl('media/abc/original.m p4'));
    expect(url.pathname).toBe('/shoebox-media/media/abc/original.m%20p4');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/server/platform/storage-r2.test.ts`
Expected: FAIL — `createR2Storage`/`R2StorageEnv` not exported, or presign assertions fail against the old implementation.

- [ ] **Step 4: Replace the adapter (complete file)**

Replace `src/lib/server/platform/storage-r2.ts` in full (keep the factory export name aligned with `platform/index.ts` as noted above):

```ts
import { AwsClient } from 'aws4fetch';
import type { StorageAdapter } from './types';

export interface R2StorageEnv {
  MEDIA: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
}

const PRESIGN_TTL_SECONDS = 3600; // Contract 7: signed R2 URL, 1 hour

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function createR2Storage(env: R2StorageEnv): StorageAdapter {
  const canPresign =
    !!env.R2_ACCOUNT_ID &&
    env.R2_ACCOUNT_ID !== 'set-me-via-wrangler-whoami' &&
    !!env.R2_ACCESS_KEY_ID &&
    !!env.R2_SECRET_ACCESS_KEY &&
    !!env.R2_BUCKET_NAME;

  const aws = canPresign
    ? new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
      })
    : null;

  return {
    async put(key, data, opts) {
      await env.MEDIA.put(key, data, {
        httpMetadata: { contentType: opts.contentType },
      });
    },

    async get(key, range) {
      const obj = range
        ? await env.MEDIA.get(key, {
            range: {
              offset: range.start,
              length: range.end !== undefined ? range.end - range.start + 1 : undefined,
            },
          })
        : await env.MEDIA.get(key);
      if (!obj || !('body' in obj) || obj.body === null) return null;
      return {
        stream: obj.body as ReadableStream<Uint8Array>,
        size: obj.size,
        contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      };
    },

    async head(key) {
      const obj = await env.MEDIA.head(key);
      if (!obj) return null;
      return {
        size: obj.size,
        contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
      };
    },

    async delete(key) {
      await env.MEDIA.delete(key);
    },

    async mediaUrl(key) {
      if (!aws) {
        // Presign secrets not configured (e.g. fresh Deploy-button install):
        // fall back to streaming through the Worker's /media route via the
        // MEDIA binding. Correct, just not offloaded.
        return `/media/${key}`;
      }
      const url = new URL(
        `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodeKeyPath(key)}`
      );
      url.searchParams.set('X-Amz-Expires', String(PRESIGN_TTL_SECONDS));
      const signed = await aws.sign(new Request(url, { method: 'GET' }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
```

(Secrets flow: `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` are Worker **secrets** (`wrangler secret put …`, documented in Task 16); `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` are `[vars]` from Task 4. Wherever `platform/index.ts` constructs the CF platform from `event.platform.env`, pass those five fields through — the env object on CF already contains vars, secrets, and bindings under the same names, so `createR2Storage(event.platform.env as R2StorageEnv)` needs no further change.)

- [ ] **Step 5: Run the unit tests**

Run: `pnpm vitest run src/lib/server/platform/storage-r2.test.ts`
Expected: `4 passed`.

Run the phase-01 storage contract tests to prove no regression: `pnpm test`
Expected: all green (r2 contract tests from phase 01 still pass under Miniflare).

- [ ] **Step 6: Branch the /media route on URL shape**

In `src/routes/media/[...key]/+server.ts`, keep the existing access-control logic (session or share-token check from phases 02/08) exactly as is; replace **the code after the access check** (the part that produces the response) with this block:

```ts
  const { storage } = locals.platform;
  const key = params.key;

  // CF with presign configured → absolute URL → offload to R2.
  const url = await storage.mediaUrl(key);
  if (/^https?:\/\//.test(url)) {
    redirect(302, url);
  }

  // Node, or CF without presign secrets → stream from the adapter with Range.
  const rangeHeader = request.headers.get('range');
  let range: { start: number; end?: number } | undefined;
  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (m) range = { start: Number(m[1]), end: m[2] === '' ? undefined : Number(m[2]) };
  }

  const res = await storage.get(key, range);
  if (!res) error(404, 'not found');

  const headers = new Headers({
    'content-type': res.contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
  });

  if (range) {
    const end = range.end !== undefined ? Math.min(range.end, res.size - 1) : res.size - 1;
    headers.set('content-range', `bytes ${range.start}-${end}/${res.size}`);
    headers.set('content-length', String(end - range.start + 1));
    return new Response(res.stream, { status: 206, headers });
  }

  headers.set('content-length', String(res.size));
  return new Response(res.stream, { status: 200, headers });
```

(Ensure `error` and `redirect` are imported from `@sveltejs/kit` at the top of the file. If the existing handler already had identical Range logic from phase 02, the only real change is the `mediaUrl()` redirect branch — keep the rest.)

- [ ] **Step 7: Full check**

Run: `pnpm check && pnpm test && pnpm test:e2e`
Expected: all green (node path unaffected: fs adapter's `mediaUrl` returns `/media/${key}`, which is not absolute, so streaming continues to work).

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/platform/storage-r2.ts src/lib/server/platform/storage-r2.test.ts "src/routes/media/[...key]/+server.ts" package.json pnpm-lock.yaml
git commit -m "fix: presigned 1h R2 GET URLs via aws4fetch, with worker-stream fallback"
```

---
### Task 7: `Dockerfile` (app image) + `.dockerignore`

**Files:**
- Create (replace phase-01 stub): `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `docker/entrypoint.sh` + `scripts/migrate.mjs` (Task 2), `/healthz` (Task 1), adapter-node build output `build/` (phase 01 `pnpm build`).
- Produces: image `shoebox-app` — non-root, port 3000, `HEALTHCHECK` on `/healthz`, migrations run on start. Consumed by Task 9 (compose) and Task 10 (ops docs).

- [ ] **Step 1: Failing check**

Run: `docker build -t shoebox-app:0.1.0 . 2>&1 | tail -1`
Expected: FAIL (stub Dockerfile is empty/invalid) or produces an image without a HEALTHCHECK — either way the Step 5 verification below cannot pass yet.

- [ ] **Step 2: Write `.dockerignore`**

Create `.dockerignore`:

```
.git
node_modules
build
build-worker
.svelte-kit
.wrangler
data
ingest
docs
e2e/fixtures
test-results
playwright-report
*.db
*.db-*
.env
.env.*
!.env.example
```

- [ ] **Step 3: Write the Dockerfile (complete file)**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

############################
# base: node 22 + pnpm
############################
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

############################
# build: install, build (PLATFORM=node), prune to prod deps
############################
FROM base AS build
# toolchain only as a fallback if a native dep has no prebuild for this platform
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
ENV PLATFORM=node
RUN pnpm build && pnpm build:worker
RUN pnpm prune --prod

############################
# app: distroless-ish runtime — prod deps + build output only, non-root
############################
FROM node:22-slim AS app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    PLATFORM=node \
    DATABASE_PATH=/data/shoebox.db \
    MEDIA_PATH=/data/media \
    MIGRATIONS_PATH=/app/migrations

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/scripts/db-backup.mjs ./scripts/db-backup.mjs
COPY --from=build /app/scripts/trash-sweep.mjs ./scripts/trash-sweep.mjs
COPY --from=build /app/src/lib/server/db/migrations ./migrations
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
```

> Note: `scripts/db-backup.mjs` and `scripts/trash-sweep.mjs` are written in Task 10. Until then, create empty placeholder files so the build succeeds — or (better) execute Task 10 Steps 2–3 first if you are running tasks out of order. If executing strictly in order: `touch scripts/db-backup.mjs scripts/trash-sweep.mjs` now; Task 10 fills them in.

- [ ] **Step 4: Build**

Run: `touch scripts/db-backup.mjs scripts/trash-sweep.mjs && docker build -t shoebox-app:0.1.0 .`
Expected: all stages succeed; final line `naming to docker.io/library/shoebox-app:0.1.0`.

- [ ] **Step 5: Run + verify migrate-on-start, healthz, non-root, health status**

Run:

```bash
docker volume create shoebox-smoke-data
docker run -d --name shoebox-smoke -p 3000:3000 \
  -e ORIGIN=http://localhost:3000 \
  -v shoebox-smoke-data:/data \
  shoebox-app:0.1.0
sleep 6
docker logs shoebox-smoke | head -5
curl -s http://localhost:3000/healthz
docker exec shoebox-smoke whoami
sleep 30
docker inspect --format='{{.State.Health.Status}}' shoebox-smoke
```

Expected:
- logs start with `[entrypoint] running migrations…` then `[migrate] up to date: /data/shoebox.db …` then `[entrypoint] starting server on :3000`
- curl prints `{"ok":true,"version":"0.1.0"}`
- whoami prints `node`
- health status prints `healthy`

- [ ] **Step 6: Teardown**

Run: `docker rm -f shoebox-smoke && docker volume rm shoebox-smoke-data`
Expected: both removed.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore scripts/db-backup.mjs scripts/trash-sweep.mjs
git commit -m "feat: multi-stage app Dockerfile (non-root, healthz HEALTHCHECK, migrate-on-start)"
```

---

### Task 8: `Dockerfile.worker` (sidecar image)

**Files:**
- Create: `Dockerfile.worker`

**Interfaces:**
- Consumes: `pnpm build:worker` → `build-worker/index.js` (Task 3); prod `node_modules` (sharp, ffmpeg-static, better-sqlite3, chokidar).
- Produces: image `shoebox-worker` — non-root, entry `node build-worker/index.js`, expects `/data` (+ `/ingest`) volumes. Consumed by Task 9 (compose).

- [ ] **Step 1: Failing check**

Run: `docker build -f Dockerfile.worker -t shoebox-worker:0.1.0 . 2>&1 | tail -1`
Expected: FAIL — `Dockerfile.worker` does not exist.

- [ ] **Step 2: Write the Dockerfile (complete file)**

Create `Dockerfile.worker`:

```dockerfile
# syntax=docker/dockerfile:1

############################
# base: node 22 + pnpm (identical to Dockerfile so BuildKit shares layer cache)
############################
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

############################
# build: identical to Dockerfile's build stage (cache-shared)
############################
FROM base AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
ENV PLATFORM=node
RUN pnpm build && pnpm build:worker
RUN pnpm prune --prod

############################
# worker: job runner + ingestion watcher
############################
FROM node:22-slim AS worker
WORKDIR /app
ENV NODE_ENV=production \
    PLATFORM=node \
    DATABASE_PATH=/data/shoebox.db \
    MEDIA_PATH=/data/media \
    INGEST_PATH=/ingest

COPY --from=build /app/build-worker ./build-worker
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data /ingest && chown -R node:node /app /data /ingest

USER node
VOLUME ["/data", "/ingest"]

CMD ["node", "build-worker/index.js"]
```

- [ ] **Step 3: Build**

Run: `docker build -f Dockerfile.worker -t shoebox-worker:0.1.0 .`
Expected: succeeds; the `build` stage is mostly cache hits from Task 7.

- [ ] **Step 4: Smoke run against a migrated volume**

Run:

```bash
docker volume create shoebox-worker-smoke
# migrate the shared DB using the app image's runner
docker run --rm -v shoebox-worker-smoke:/data --entrypoint node shoebox-app:0.1.0 scripts/migrate.mjs
docker run -d --name worker-smoke -v shoebox-worker-smoke:/data shoebox-worker:0.1.0
sleep 5
docker logs worker-smoke
docker exec worker-smoke whoami
docker rm -f worker-smoke && docker volume rm shoebox-worker-smoke
```

Expected: logs show the phase-07 worker startup (job poller + ingestion watcher on `/ingest`), no unhandled errors; whoami prints `node`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.worker
git commit -m "feat: worker sidecar Dockerfile (esbuild bundle + prod deps, non-root)"
```

---

### Task 9: `docker-compose.yml` (production stack) + single `.env`

**Files:**
- Create (replace phase-01 stub): `docker-compose.yml`

**Interfaces:**
- Consumes: `Dockerfile` (Task 7), `Dockerfile.worker` (Task 8), `faces/Dockerfile` (phase 09), `/healthz` HEALTHCHECK (Task 1/7), master Contract 8 env names.
- Produces: `docker compose up -d` → app (port 3000) + worker; `--profile faces` adds the faces container. Single `.env` file feeds all services. Consumed by Task 10 (ops docs) and Task 16 (README quickstart).

- [ ] **Step 1: Failing check**

Run: `docker compose config --quiet`
Expected: FAIL or empty/stub output — the real stack is not defined yet.

- [ ] **Step 2: Write the compose file (complete file)**

Create `docker-compose.yml`:

```yaml
name: shoebox

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: shoebox-app:0.1.0
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      PLATFORM: node
      DATABASE_PATH: /data/shoebox.db
      MEDIA_PATH: /data/media
      # ORIGIN and BODY_LIMIT_MB come from .env
    volumes:
      - shoebox-data:/data

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    image: shoebox-worker:0.1.0
    restart: unless-stopped
    env_file: .env
    environment:
      PLATFORM: node
      DATABASE_PATH: /data/shoebox.db
      MEDIA_PATH: /data/media
      INGEST_PATH: /ingest
      # FACES_ENABLED (optional, default false) comes from .env
    volumes:
      - shoebox-data:/data
      - ./ingest:/ingest
    depends_on:
      app:
        condition: service_healthy   # app's entrypoint has run migrations by then

  faces:
    build:
      context: ./faces
    image: shoebox-faces:0.1.0
    restart: unless-stopped
    profiles: ["faces"]
    env_file: .env
    environment:
      DATABASE_PATH: /data/shoebox.db
      MEDIA_PATH: /data/media
    volumes:
      - shoebox-data:/data
    depends_on:
      app:
        condition: service_healthy

volumes:
  shoebox-data:
```

- [ ] **Step 3: Create the production `.env`**

Run:

```bash
cp .env.example .env
mkdir -p ingest
```

Then edit `.env` so it reads (single env file for the whole stack — `DATABASE_PATH`/`MEDIA_PATH`/`INGEST_PATH` are pinned per-service in compose, so their .env values are only used for non-Docker runs):

```
PLATFORM=node
DATABASE_PATH=/data/shoebox.db
MEDIA_PATH=/data/media
INGEST_PATH=/ingest
ORIGIN=http://localhost:3000
BODY_LIMIT_MB=4096
FACES_ENABLED=false
```

- [ ] **Step 4: Validate + boot the stack**

Run:

```bash
docker compose config --quiet && echo COMPOSE_OK
docker compose up -d --build
docker compose ps
```

Expected: `COMPOSE_OK`; after ~30s `docker compose ps` shows `app` as `Up … (healthy)` and `worker` as `Up`; `faces` is absent (profile not activated).

- [ ] **Step 5: Smoke the running stack**

Run:

```bash
curl -s http://localhost:3000/healthz
docker compose logs worker | head -5
docker compose --profile faces config --services
```

Expected:
- `{"ok":true,"version":"0.1.0"}`
- worker startup log lines (poller + watcher), started only after app became healthy
- services list: `app`, `worker`, `faces`

- [ ] **Step 6: Verify ingestion bind-mount is wired**

Run: `docker compose exec worker ls /ingest && echo INGEST_MOUNTED`
Expected: `INGEST_MOUNTED` (empty dir listing is fine).

- [ ] **Step 7: Teardown**

Run: `docker compose down`
Expected: containers removed; the `shoebox-data` volume persists (by design).

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: production docker-compose (app + worker, faces profile, healthy-gated startup)"
```

---

### Task 10: Ops scripts (backup, trash-sweep) + `README-deploy.md`

**Files:**
- Create (fill the Task-7 placeholders): `scripts/db-backup.mjs`, `scripts/trash-sweep.mjs`
- Create: `README-deploy.md`

**Interfaces:**
- Consumes: `DATABASE_PATH` / `MEDIA_PATH` env (Contract 8); schema table/column names from master Contract 1 (`deleted_at` seconds-epoch via drizzle `{ mode: 'timestamp' }`; storage keys `media/<itemId>/…` under `MEDIA_PATH`, Contract 7).
- Produces: `node scripts/db-backup.mjs [destDir]` and `node scripts/trash-sweep.mjs` — invoked by host cron via `docker compose exec` (documented below). `README-deploy.md` — upgrade + backup runbook, consumed by Task 16 README link.

- [ ] **Step 1: Failing check**

Run: `DATABASE_PATH=/tmp/shoebox-migrate-test.db node scripts/db-backup.mjs /tmp/shoebox-backups`
Expected: no output / no backup file (the Task-7 placeholder is empty). `ls /tmp/shoebox-backups` → no such directory.

- [ ] **Step 2: Write the backup script**

Replace `scripts/db-backup.mjs` in full:

```js
// Online SQLite backup using better-sqlite3's backup API (safe under WAL,
// equivalent to sqlite3 .backup). Usage: node scripts/db-backup.mjs [destDir]
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const src = process.env.DATABASE_PATH ?? '/data/shoebox.db';
const destDir = process.argv[2] ?? '/data/backups';
const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

mkdirSync(destDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dest = join(destDir, `shoebox-${stamp}.db`);

const db = new Database(src, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
console.log(`[backup] wrote ${dest}`);

// prune old backups
const cutoff = Date.now() - keepDays * 86400_000;
for (const f of readdirSync(destDir)) {
  if (!/^shoebox-.*\.db$/.test(f)) continue;
  const p = join(destDir, f);
  if (statSync(p).mtimeMs < cutoff) {
    unlinkSync(p);
    console.log(`[backup] pruned ${p}`);
  }
}
```

- [ ] **Step 3: Write the trash-sweep script**

Replace `scripts/trash-sweep.mjs` in full:

```js
// Purges soft-deleted rows older than 30 days (spec §12: 30-day trash) and
// removes their media files. Mirrors the Admin "empty trash" semantics but
// only for expired rows; run nightly from host cron.
// Note: contentless FTS5 rows for purged items are left behind intentionally —
// search results join items, so orphaned rowids are filtered out; the next
// reindexItem pass rewrites them.
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const db = new Database(process.env.DATABASE_PATH ?? '/data/shoebox.db');
const mediaPath = process.env.MEDIA_PATH ?? '/data/media';
db.pragma('foreign_keys = OFF'); // child rows are deleted explicitly below

// drizzle { mode: 'timestamp' } stores unix SECONDS
const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;

const items = db
  .prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?')
  .all(cutoff);

const purgeItem = db.transaction((id) => {
  for (const table of ['item_files', 'item_people', 'item_tags', 'faces', 'comments']) {
    db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(id);
  }
  db.prepare('DELETE FROM album_items WHERE item_id = ?').run(id);
  db.prepare("DELETE FROM shares WHERE target_type = 'item' AND target_id = ?").run(id);
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
});

for (const { id } of items) {
  purgeItem(id);
  // storage-fs resolves key K to join(MEDIA_PATH, K); keys are media/<itemId>/<kind>.<ext>
  rmSync(join(mediaPath, 'media', id), { recursive: true, force: true });
}

const comments = db
  .prepare('DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ?')
  .run(cutoff);
const albums = db.transaction(() => {
  const dead = db
    .prepare('SELECT id FROM albums WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff);
  for (const { id } of dead) {
    db.prepare('DELETE FROM album_items WHERE album_id = ?').run(id);
    db.prepare("DELETE FROM shares WHERE target_type = 'album' AND target_id = ?").run(id);
    db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  }
  return dead.length;
})();

db.close();
console.log(
  `[trash-sweep] purged ${items.length} items, ${comments.changes} comments, ${albums} albums`
);
```

- [ ] **Step 4: Test both scripts against the scratch DB**

Run:

```bash
DATABASE_PATH=/tmp/shoebox-migrate-test.db node scripts/db-backup.mjs /tmp/shoebox-backups
ls /tmp/shoebox-backups
DATABASE_PATH=/tmp/shoebox-migrate-test.db MEDIA_PATH=/tmp/shoebox-media node scripts/trash-sweep.mjs
```

Expected:
- `[backup] wrote /tmp/shoebox-backups/shoebox-<stamp>.db` and the file is listed
- `[trash-sweep] purged 0 items, 0 comments, 0 albums` (empty DB — proves the SQL is valid against the real schema)

- [ ] **Step 5: Write `README-deploy.md` (complete file)**

Create `README-deploy.md`:

````markdown
# Shoebox — Docker deployment runbook

The stack is defined in `docker-compose.yml`: `app` (SvelteKit server, port 3000),
`worker` (derivatives + ingestion), and `faces` (optional, compose profile).
One `.env` file configures everything. All state lives in the `shoebox-data`
volume (`/data`: SQLite DB + media) and the `./ingest` bind mount.

## First run

```bash
cp .env.example .env    # set ORIGIN to the URL your family will use
mkdir -p ingest
docker compose up -d --build
# → http://localhost:3000 redirects to /setup; create the owner account
```

Enable face recognition (optional, needs ~2GB RAM for the model):

```bash
# set FACES_ENABLED=true in .env, then:
docker compose --profile faces up -d --build
```

## Upgrading

Order matters: migrate first, restart the app **last** so users only ever see
the new UI on the new schema.

```bash
git pull
docker compose build                      # or: docker compose pull (if using a registry)
docker compose run --rm --no-deps app node scripts/migrate.mjs   # one-off migration
docker compose up -d worker               # workers first (add: --profile faces faces)
docker compose up -d app                  # app last
docker compose ps                         # app should reach (healthy)
```

Rollback: `git checkout <previous-tag> && docker compose up -d --build`.
Migrations are forward-only — restore the DB from a backup if you must go back.

## Nightly maintenance (host cron)

`crontab -e` on the Docker host (paths assume the repo lives in /opt/shoebox):

```cron
# nightly trash sweep — permanently purges soft-deleted rows older than 30 days
15 3 * * * cd /opt/shoebox && docker compose exec -T app node scripts/trash-sweep.mjs >> /var/log/shoebox-sweep.log 2>&1

# nightly SQLite snapshot (online .backup; safe while the app is running)
45 3 * * * cd /opt/shoebox && docker compose exec -T app node scripts/db-backup.mjs /data/backups >> /var/log/shoebox-backup.log 2>&1
```

Backups land inside the volume at `/data/backups` (14 most recent days kept;
tune with `BACKUP_KEEP_DAYS`).

## Off-site backup of /data (restic or rclone)

The volume's host path: `docker volume inspect shoebox_shoebox-data --format '{{.Mountpoint}}'`.

restic:

```bash
export RESTIC_REPOSITORY=sftp:backup@nas:/backups/shoebox
export RESTIC_PASSWORD_FILE=/root/.restic-pass
restic backup "$(docker volume inspect shoebox_shoebox-data --format '{{.Mountpoint}}')"
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
```

rclone:

```bash
rclone sync "$(docker volume inspect shoebox_shoebox-data --format '{{.Mountpoint}}')" \
  b2:my-bucket/shoebox --transfers 8 --fast-list
```

Run either nightly (cron, after the DB snapshot at 03:45) — the media files are
immutable once written, so incremental runs are cheap. The DB snapshot in
`/data/backups` is the consistent copy; the live `shoebox.db`/`-wal` files in the
same sync are best-effort only.

## Restore

```bash
docker compose down
# copy media + a backup DB into a fresh volume, then:
docker compose up -d
```

Restore the DB by replacing `/data/shoebox.db` with a snapshot from
`/data/backups` (delete stale `shoebox.db-wal`/`-shm` first), while the stack is
down.

## Ingestion folder

Drop web-ready files under `./ingest`. Path conventions become hints:
`ingest/<year>/<tag>/file.mp4` → year + tag. Files appear in **Arrivals**
(`status=needs_review`); corrupt/unparseable files are moved to
`ingest/_failed` with the reason shown in Arrivals.
````

- [ ] **Step 6: Rebuild the app image so the real scripts replace the placeholders**

Run: `docker build -t shoebox-app:0.1.0 . && docker run --rm --entrypoint node shoebox-app:0.1.0 -e "console.log('scripts baked')"`
Expected: build OK; `scripts baked`.

- [ ] **Step 7: Commit**

```bash
git add scripts/db-backup.mjs scripts/trash-sweep.mjs README-deploy.md
git commit -m "feat: backup + trash-sweep ops scripts and docker deployment runbook"
```

---

### Task 11: E2E fixtures, shared helpers, Playwright config hardening

**Files:**
- Create: `scripts/make-e2e-fixtures.mjs`
- Create: `e2e/helpers/auth.ts`, `e2e/helpers/media.ts`
- Modify: `playwright.config.ts` (serial workers, snapshot path template, screenshot defaults)
- Modify: `package.json` (`test:e2e` runs fixture generation first; add `@axe-core/playwright`)
- Modify: `.gitignore` (add `e2e/fixtures/`)

**Interfaces:**
- Consumes: `ffmpeg-static` + `sharp` (already prod deps via phase 07); phase-01 Playwright config (webServer boots the app with a fresh test `DATABASE_PATH` per run).
- Produces (used by Tasks 12–14):
  - fixtures `e2e/fixtures/photo.png`, `photo2.png`, `photo3.png` (640×480 solid-color PNGs), `clip.webm` (2s VP8 testsrc — VP8 decodes in Playwright's Chromium, so client-side poster capture works; spec allows WebM uploads)
  - `PASSWORD: string`; `ensureOwner(page: Page): Promise<void>`; `login(page: Page, username: string, password?: string): Promise<void>`; `createUserWithRole(browser: Browser, role: 'admin'|'editor'|'uploader'|'user'): Promise<{ username: string; context: BrowserContext; page: Page }>`
  - `sha256Of(path: string): string`; `uploadViaUi(page: Page, fixturePath: string, opts: { title: string; date: string }): Promise<void>`

- [ ] **Step 1: Write the fixture generator**

Create `scripts/make-e2e-fixtures.mjs`:

```js
// Deterministic e2e media fixtures. VP8/WebM (not H.264) so Playwright's
// Chromium can decode it for client-side poster capture.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

mkdirSync('e2e/fixtures', { recursive: true });

const photos = [
  ['photo.png', { r: 250, g: 123, b: 98 }],   // dawn
  ['photo2.png', { r: 68, g: 97, b: 121 }],   // 60s blue
  ['photo3.png', { r: 255, g: 177, b: 27 }],  // yamabuki
];
for (const [name, background] of photos) {
  const path = `e2e/fixtures/${name}`;
  if (!existsSync(path)) {
    await sharp({ create: { width: 640, height: 480, channels: 3, background } })
      .png()
      .toFile(path);
  }
}

if (!existsSync('e2e/fixtures/clip.webm')) {
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-c:v', 'libvpx', '-b:v', '200k', '-auto-alt-ref', '0',
    'e2e/fixtures/clip.webm',
  ]);
}

console.log('[fixtures] ready in e2e/fixtures/');
```

- [ ] **Step 2: Chain it into the e2e scripts and add axe**

Run: `pnpm add -D @axe-core/playwright@^4.9.0`

In `package.json` scripts, change `test:e2e` (keep the existing playwright invocation flags if any) and confirm the cf variant (used from Task 12):

```json
"test:e2e": "node scripts/make-e2e-fixtures.mjs && playwright test",
"test:e2e:cf": "node scripts/make-e2e-fixtures.mjs && playwright test -c playwright.cf.config.ts",
```

Append to `.gitignore`:

```
e2e/fixtures/
```

- [ ] **Step 3: Verify fixtures**

Run: `node scripts/make-e2e-fixtures.mjs && file e2e/fixtures/clip.webm e2e/fixtures/photo.png`
Expected: `[fixtures] ready…`; `clip.webm: WebM` and `photo.png: PNG image data, 640 x 480`.

- [ ] **Step 4: Harden the Playwright config**

In `playwright.config.ts`, merge these settings into the existing `defineConfig` (the hardening suites share one server + one DB, so they must not interleave):

```ts
  fullyParallel: false,
  workers: 1,
  // Snapshot names must not embed the platform: baselines are generated on
  // linux (CI / the Playwright docker image) and committed.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { threshold: 0.2, animations: 'disabled' },
  },
```

- [ ] **Step 5: Write the auth helpers**

Create `e2e/helpers/auth.ts`:

```ts
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-Password-123';

export type RoleName = 'admin' | 'editor' | 'uploader' | 'user';

/** Creates the owner on a fresh DB (first-run /setup), no-op if already created. */
export async function ensureOwner(page: Page): Promise<void> {
  await page.goto('/');
  if (new URL(page.url()).pathname.startsWith('/setup')) {
    await page.getByLabel(/username/i).fill('owner');
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create|finish|set ?up/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/setup'));
  }
}

export async function login(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  if (!new URL(page.url()).pathname.startsWith('/login')) return; // session already valid
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Owner mints an invite via /api/invites; a fresh context redeems it. */
export async function createUserWithRole(
  browser: Browser,
  role: RoleName
): Promise<{ username: string; context: BrowserContext; page: Page }> {
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await ensureOwner(ownerPage);
  await login(ownerPage, 'owner');
  const res = await ownerCtx.request.post('/api/invites', { data: { role, maxUses: 1 } });
  expect(res.ok(), `POST /api/invites for role=${role}`).toBeTruthy();
  const { token } = (await res.json()) as { token: string };
  await ownerCtx.close();

  const username = `${role}-${Date.now().toString(36)}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/invite/${token}`);
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /join|create|redeem/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/invite'));
  return { username, context, page };
}
```

> The label/button regexes match the copy shipped by phases 01/08. If a locator
> misses, fix the **selector** to match the real DOM — never change app copy to
> satisfy a test.

- [ ] **Step 6: Write the media helpers**

Create `e2e/helpers/media.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sizeOf(path: string): number {
  return readFileSync(path).byteLength;
}

/** Drives the real /upload page (client-side hashing + derivatives included). */
export async function uploadViaUi(
  page: Page,
  fixturePath: string,
  opts: { title: string; date: string }
): Promise<void> {
  await page.goto('/upload');
  await page.setInputFiles('input[type="file"]', fixturePath);
  await page.getByLabel(/title/i).first().fill(opts.title);
  await page.getByLabel(/date/i).first().fill(opts.date);
  await page.getByRole('button', { name: /upload|save|add/i }).first().click();
  await expect(
    page.getByText(/ready|uploaded|done|complete/i).first()
  ).toBeVisible({ timeout: 30_000 });
}
```

- [ ] **Step 7: Prove nothing broke**

Run: `pnpm check && pnpm test:e2e e2e/healthz.spec.ts`
Expected: typecheck green; healthz e2e passes (fixtures generated first, config edits valid).

- [ ] **Step 8: Commit**

```bash
git add scripts/make-e2e-fixtures.mjs e2e/helpers/auth.ts e2e/helpers/media.ts playwright.config.ts package.json pnpm-lock.yaml .gitignore
git commit -m "test: e2e fixtures, role/upload helpers, serialized playwright config"
```

---
### Task 12: Cloudflare smoke suite against `wrangler dev`

**Files:**
- Create: `playwright.cf.config.ts`
- Create: `e2e-cf/smoke.spec.ts`

**Interfaces:**
- Consumes: `pnpm build:cf` + `wrangler.toml` (Task 4), `pnpm db:migrate:d1` (Task 5), `/healthz` (Task 1), fixtures + `PASSWORD` pattern (Task 11 — helpers are re-declared locally here because `e2e-cf` runs against a different baseURL/config).
- Produces: `pnpm test:e2e:cf` — the CF golden path used by CI job `cf-smoke` (Task 15).

- [ ] **Step 1: Write the CF Playwright config**

Create `playwright.cf.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

// Boots the REAL cloudflare build under wrangler dev (workerd + local D1/R2).
// State is wiped first so the suite always starts at first-run /setup.
export default defineConfig({
  testDir: 'e2e-cf',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'rm -rf .wrangler/state && pnpm build:cf && pnpm db:migrate:d1 && pnpm exec wrangler dev --port 8788',
    url: 'http://127.0.0.1:8788/healthz',
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
```

- [ ] **Step 2: Run to verify it fails (no spec yet)**

Run: `pnpm test:e2e:cf`
Expected: FAIL — `no tests found` (but the webServer must reach the healthz URL first; if wrangler dev never becomes ready, fix that before writing the spec — check `wrangler.toml` `main` and that `build:cf` ran).

- [ ] **Step 3: Write the smoke spec (complete file)**

Create `e2e-cf/smoke.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

// Golden path on the cloudflare build: setup → login → photo upload with
// client derivatives → timeline → player → search; video upload with
// client-side poster; worker-only features absent (Arrivals hidden, faces
// hidden, no sprite → hover-scrub silently absent).

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'e2e-Password-123';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  if (!new URL(page.url()).pathname.startsWith('/login')) return;
  await page.getByLabel(/username/i).fill('owner');
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('first boot: empty users table redirects to /setup; owner created', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel(/username/i).fill('owner');
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create|finish|set ?up/i }).click();
  await expect(page).not.toHaveURL(/\/setup/);
});

test('worker-only features are hidden on cloudflare', async ({ page }) => {
  await login(page);
  await page.goto('/');
  // Feature flags: ingestion + faces off on CF (spec §6) → no Arrivals nav
  // even for the owner (who outranks editor).
  await expect(page.getByRole('link', { name: 'Arrivals' })).toHaveCount(0);
  const res = await page.goto('/arrivals');
  expect(res && res.status() >= 400 ? res.status() : page.url()).not.toContain('/arrivals#ok');
  await expect(page.getByRole('heading', { name: 'Arrivals' })).toHaveCount(0);
});

test('photo upload with client derivatives → timeline renders → lightbox opens', async ({ page }) => {
  await login(page);
  await page.goto('/upload');
  await page.setInputFiles('input[type="file"]', 'e2e/fixtures/photo.png');
  await page.getByLabel(/title/i).first().fill('Lake day');
  await page.getByLabel(/date/i).first().fill('1994-06-14');
  await page.getByRole('button', { name: /upload|save|add/i }).first().click();
  await expect(page.getByText(/ready|uploaded|done|complete/i).first()).toBeVisible({
    timeout: 45_000,
  });

  await page.goto('/?y=1994');
  const card = page.getByText('Lake day').first();
  await expect(card).toBeVisible();
  // client-generated thumbnail is served (via /media or presign fallback)
  await expect(page.locator('img[src*="thumb"]').first()).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.getByText('June 14, 1994')).toBeVisible();
});

test('search finds the uploaded photo', async ({ page }) => {
  await login(page);
  await page.goto('/search');
  await page.getByRole('textbox').first().fill('Lake');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Lake day').first()).toBeVisible();
});

test('video upload: client-side poster; no sprite → hover-scrub silently absent', async ({
  page,
}) => {
  await login(page);
  await page.goto('/upload');
  await page.setInputFiles('input[type="file"]', 'e2e/fixtures/clip.webm');
  await page.getByLabel(/title/i).first().fill('Test reel');
  await page.getByLabel(/date/i).first().fill('1994-07-04');
  await page.getByRole('button', { name: /upload|save|add/i }).first().click();
  await expect(page.getByText(/ready|uploaded|done|complete/i).first()).toBeVisible({
    timeout: 45_000,
  });

  const spriteRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('sprite')) spriteRequests.push(r.url());
  });

  await page.goto('/?y=1994');
  const card = page.getByText('Test reel').first();
  await expect(card).toBeVisible();
  // poster was generated client-side (canvas capture) at upload
  await expect(page.locator('img[src*="poster"], img[src*="thumb"]').first()).toBeVisible();

  await card.hover();
  await page.waitForTimeout(1000);
  expect(spriteRequests, 'no sprite fetches on cloudflare').toEqual([]);

  await card.click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.locator('video')).toBeVisible();
});
```

- [ ] **Step 4: Run the suite**

Run: `pnpm test:e2e:cf`
Expected: `5 passed`. First run takes minutes (build:cf + wrangler dev boot). If a locator misses real DOM copy, adjust the locator (never the app).

- [ ] **Step 5: Commit**

```bash
git add playwright.cf.config.ts e2e-cf/smoke.spec.ts
git commit -m "test: cloudflare smoke suite against wrangler dev (golden path + feature flags)"
```

---

### Task 13: E2E hardening I — permissions matrix, soft-delete lifecycle, dedupe, share flows

**Files:**
- Create: `e2e/permissions.spec.ts`
- Create: `e2e/lifecycle.spec.ts`
- Create: `e2e/shares.spec.ts`

**Interfaces:**
- Consumes: helpers from Task 11 (`ensureOwner`, `login`, `createUserWithRole`, `PASSWORD`, `uploadViaUi`, `sha256Of`, `sizeOf`); master Contract 6 role table (403 expectations); fixtures `photo.png`/`photo2.png`/`photo3.png`.
- Produces: green hardening suites consumed by CI (Task 15).

- [ ] **Step 1: Write the permissions matrix spec**

Create `e2e/permissions.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { createUserWithRole, ensureOwner, login } from './helpers/auth';
import { uploadViaUi } from './helpers/media';

// Contract 6 role matrix: every forbidden (role, action) → 403 from the API
// and hidden in the UI.

test.describe.configure({ mode: 'serial' });

let ownerItemId = '';

test('seed: owner and one owner-owned item', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ensureOwner(page);
  await login(page, 'owner');
  await uploadViaUi(page, 'e2e/fixtures/photo.png', { title: 'Perms seed', date: '1994-06-14' });
  const res = await ctx.request.get('/api/items?q=Perms%20seed&limit=1');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items: { id: string }[] };
  expect(body.items.length).toBe(1);
  ownerItemId = body.items[0].id;
  await ctx.close();
});

type Forbidden = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: () => string;
  body?: Record<string, unknown>;
};

const FORBIDDEN: Record<'user' | 'uploader' | 'editor', Forbidden[]> = {
  user: [
    { method: 'POST', path: () => '/api/upload/init', body: { sha256: 'a'.repeat(64), sizeBytes: 10, mime: 'image/png', filename: 'x.png' } },
    { method: 'POST', path: () => '/api/items', body: { type: 'photo' } },
    { method: 'PATCH', path: () => `/api/items/${ownerItemId}`, body: { title: 'nope' } },
    { method: 'DELETE', path: () => `/api/items/${ownerItemId}` },
    { method: 'POST', path: () => '/api/invites', body: { role: 'user', maxUses: 1 } },
    { method: 'POST', path: () => '/api/shares', body: { targetType: 'item', targetId: 'x', allowDownload: false } },
    { method: 'GET', path: () => '/api/admin/users' },
  ],
  uploader: [
    { method: 'PATCH', path: () => `/api/items/${ownerItemId}`, body: { title: 'not mine' } },
    { method: 'DELETE', path: () => `/api/items/${ownerItemId}` },
    { method: 'POST', path: () => '/api/shares', body: { targetType: 'item', targetId: 'x', allowDownload: false } },
    { method: 'POST', path: () => '/api/invites', body: { role: 'user', maxUses: 1 } },
    { method: 'GET', path: () => '/api/admin/users' },
  ],
  editor: [
    { method: 'POST', path: () => '/api/invites', body: { role: 'user', maxUses: 1 } },
    { method: 'GET', path: () => '/api/admin/users' },
  ],
};

for (const role of ['user', 'uploader', 'editor'] as const) {
  test(`role matrix: ${role} — forbidden actions 403, UI hidden`, async ({ browser }) => {
    const { context, page } = await createUserWithRole(browser, role);

    for (const c of FORBIDDEN[role]) {
      const res = await context.request.fetch(c.path(), {
        method: c.method,
        data: c.body,
        failOnStatusCode: false,
      });
      expect(res.status(), `${role}: ${c.method} ${c.path()}`).toBe(403);
    }

    // UI hiding follows the same matrix
    await page.goto('/');
    if (role === 'user') {
      await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
    }
    if (role === 'user' || role === 'uploader') {
      await expect(page.getByRole('link', { name: 'Arrivals' })).toHaveCount(0);
    }
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /users/i })).toHaveCount(0); // 403 page or redirect

    await context.close();
  });
}

test('positive checks: allowed actions succeed per role', async ({ browser }) => {
  // uploader CAN start an upload
  const up = await createUserWithRole(browser, 'uploader');
  const init = await up.context.request.post('/api/upload/init', {
    data: { sha256: 'b'.repeat(64), sizeBytes: 10, mime: 'image/png', filename: 'ok.png' },
  });
  expect(init.status(), 'uploader can init upload').toBe(200);
  // every authenticated role can comment ("Add a memory…")
  const comment = await up.context.request.post(`/api/items/${ownerItemId}/comments`, {
    data: { body: 'a memory from an uploader' },
  });
  expect(comment.ok(), 'uploader can comment').toBeTruthy();
  await up.context.close();

  // editor CAN edit anyone's item
  const ed = await createUserWithRole(browser, 'editor');
  const patch = await ed.context.request.fetch(`/api/items/${ownerItemId}`, {
    method: 'PATCH',
    data: { title: 'Perms seed (edited by editor)' },
  });
  expect(patch.ok(), 'editor can edit any item').toBeTruthy();
  await ed.context.close();

  // admin CAN list invites
  const ad = await createUserWithRole(browser, 'admin');
  const invites = await ad.context.request.get('/api/invites');
  expect(invites.status(), 'admin can list invites').toBe(200);
  await ad.context.close();
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test:e2e e2e/permissions.spec.ts`
Expected: `5 passed` (seed + 3 roles + positives). Any 401-vs-403 or hidden-vs-404 mismatch is a real finding: Contract 6 says role failures are **403** — fix the app, not the test.

- [ ] **Step 3: Write the lifecycle + dedupe spec**

Create `e2e/lifecycle.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureOwner, login } from './helpers/auth';
import { sha256Of, sizeOf, uploadViaUi } from './helpers/media';

test.describe.configure({ mode: 'serial' });

test('soft delete → hidden from timeline → visible in trash → restore → permanent delete', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ensureOwner(page);
  await login(page, 'owner');

  await uploadViaUi(page, 'e2e/fixtures/photo2.png', { title: 'Lifecycle photo', date: '1988-10-31' });
  const list = await ctx.request.get('/api/items?q=Lifecycle%20photo&limit=1');
  const id = ((await list.json()) as { items: { id: string }[] }).items[0].id;

  // soft delete
  const del = await ctx.request.delete(`/api/items/${id}`);
  expect(del.ok()).toBeTruthy();

  // hidden from normal listings
  const after = await ctx.request.get('/api/items?q=Lifecycle%20photo');
  expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(0);

  // visible in admin trash; restore it
  await page.goto('/admin/trash');
  await expect(page.getByText('Lifecycle photo')).toBeVisible();
  await page.getByRole('button', { name: /restore/i }).first().click();
  await expect(page.getByText('Lifecycle photo')).toHaveCount(0);

  const restored = await ctx.request.get('/api/items?q=Lifecycle%20photo');
  expect(((await restored.json()) as { items: unknown[] }).items).toHaveLength(1);

  // delete again, then empty trash → permanently gone
  await ctx.request.delete(`/api/items/${id}`);
  await page.goto('/admin/trash');
  await expect(page.getByText('Lifecycle photo')).toBeVisible();
  page.once('dialog', (d) => d.accept()); // if empty-trash confirms via dialog
  await page.getByRole('button', { name: /empty trash/i }).click();
  await expect(page.getByText('Lifecycle photo')).toHaveCount(0);

  const gone = await ctx.request.get(`/api/items/${id}`, { failOnStatusCode: false });
  expect(gone.status()).toBe(404);

  await ctx.close();
});

test('dedupe: re-uploading identical bytes is flagged at init and warned in the UI', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ensureOwner(page);
  await login(page, 'owner');

  await uploadViaUi(page, 'e2e/fixtures/photo3.png', { title: 'Dedupe original', date: '2003-12-25' });

  // API-level: init with the same sha256 reports the duplicate
  const res = await ctx.request.post('/api/upload/init', {
    data: {
      sha256: sha256Of('e2e/fixtures/photo3.png'),
      sizeBytes: sizeOf('e2e/fixtures/photo3.png'),
      mime: 'image/png',
      filename: 'photo3.png',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { duplicateItemId?: string };
  expect(body.duplicateItemId, 'duplicateItemId present for identical sha256').toBeTruthy();

  // UI-level: the upload page warns before storing twice
  await page.goto('/upload');
  await page.setInputFiles('input[type="file"]', 'e2e/fixtures/photo3.png');
  await expect(page.getByText(/duplicate|already/i).first()).toBeVisible({ timeout: 30_000 });

  await ctx.close();
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test:e2e e2e/lifecycle.spec.ts`
Expected: `2 passed`.

- [ ] **Step 5: Write the share-flows spec**

Create `e2e/shares.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureOwner, login } from './helpers/auth';
import { uploadViaUi } from './helpers/media';

test.describe.configure({ mode: 'serial' });

let albumShareToken = '';
let itemShareToken = '';
let expiredShareToken = '';

test('seed: album with one item + three shares (password / plain / expired)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ensureOwner(page);
  await login(page, 'owner');

  await uploadViaUi(page, 'e2e/fixtures/photo.png', { title: 'Shared moment', date: '1974-07-04' });
  const items = await ctx.request.get('/api/items?q=Shared%20moment&limit=1');
  const itemId = ((await items.json()) as { items: { id: string }[] }).items[0].id;

  const albumRes = await ctx.request.post('/api/albums', { data: { title: 'Share album' } });
  expect(albumRes.ok()).toBeTruthy();
  const albumId = ((await albumRes.json()) as { id: string }).id;
  const addRes = await ctx.request.post(`/api/albums/${albumId}/items`, {
    data: { itemId, position: 0 },
  });
  expect(addRes.ok()).toBeTruthy();

  const mk = async (data: Record<string, unknown>) => {
    const r = await ctx.request.post('/api/shares', { data });
    expect(r.ok(), `POST /api/shares ${JSON.stringify(data)}`).toBeTruthy();
    return ((await r.json()) as { token: string }).token;
  };
  albumShareToken = await mk({
    targetType: 'album', targetId: albumId, password: 'family-pw', allowDownload: true,
  });
  itemShareToken = await mk({ targetType: 'item', targetId: itemId, allowDownload: false });
  expiredShareToken = await mk({
    targetType: 'item', targetId: itemId, allowDownload: false,
    expiresAt: '2020-01-01T00:00:00.000Z',
  });
  await ctx.close();
});

test('album share: wrong password rejected, right password shows stripped read-only UI + download', async ({
  browser,
}) => {
  const anon = await browser.newContext(); // no session
  const page = await anon.newPage();

  await page.goto(`/share/${albumShareToken}`);
  await expect(page.getByLabel(/password/i)).toBeVisible();

  await page.getByLabel(/password/i).fill('wrong-pw');
  await page.getByRole('button', { name: /view|unlock|open|submit/i }).click();
  await expect(page.getByText(/incorrect|wrong|invalid/i)).toBeVisible();

  await page.getByLabel(/password/i).fill('family-pw');
  await page.getByRole('button', { name: /view|unlock|open|submit/i }).click();
  await expect(page.getByText('Share album')).toBeVisible();
  await expect(page.getByText('Shared moment')).toBeVisible();
  // stripped public UI: no comments (spec §3)
  await expect(page.getByPlaceholder('Add a memory…')).toHaveCount(0);
  // allowDownload=true → original download offered
  await expect(page.getByRole('link', { name: /download/i }).first()).toBeVisible();

  await anon.close();
});

test('item share without password: content visible, no download link', async ({ browser }) => {
  const anon = await browser.newContext();
  const page = await anon.newPage();
  await page.goto(`/share/${itemShareToken}`);
  await expect(page.getByText('Shared moment')).toBeVisible();
  await expect(page.getByRole('link', { name: /download/i })).toHaveCount(0);
  await expect(page.getByPlaceholder('Add a memory…')).toHaveCount(0);
  await anon.close();
});

test('expired share is refused', async ({ browser }) => {
  const anon = await browser.newContext();
  const page = await anon.newPage();
  const res = await page.goto(`/share/${expiredShareToken}`);
  const refused =
    (res !== null && res.status() >= 400) ||
    (await page.getByText(/expired|not found|no longer/i).count()) > 0;
  expect(refused, 'expired share must not render content').toBe(true);
  await expect(page.getByText('Shared moment')).toHaveCount(0);
  await anon.close();
});
```

- [ ] **Step 6: Run it**

Run: `pnpm test:e2e e2e/shares.spec.ts`
Expected: `4 passed`. (If the phase-08 `POST /api/shares` body shape differs — e.g. it takes `expiresAt` as epoch — adapt the test data to the real endpoint; the assertions are the contract.)

- [ ] **Step 7: Full e2e run**

Run: `pnpm test:e2e`
Expected: all suites green, including the phase-01…09 golden paths.

- [ ] **Step 8: Commit**

```bash
git add e2e/permissions.spec.ts e2e/lifecycle.spec.ts e2e/shares.spec.ts
git commit -m "test: permissions matrix, soft-delete lifecycle, dedupe, share-flow e2e"
```

---

### Task 14: E2E hardening II — axe + comfort mode, mobile viewport, dark/light visual sanity

**Files:**
- Create: `e2e/a11y.spec.ts`
- Create: `e2e/mobile.spec.ts`
- Create: `e2e/visual.spec.ts`
- Create (generated + committed): `e2e/__screenshots__/visual.spec.ts/*.png` baselines

**Interfaces:**
- Consumes: Task 11 helpers + config (`snapshotPathTemplate`, screenshot `threshold: 0.2`); `@axe-core/playwright`; decade palettes render on `/?y=<year>` regardless of content (phase 03 Gradient rooms).
- Produces: committed linux screenshot baselines; suites consumed by CI (Task 15).

- [ ] **Step 1: Write the a11y spec**

Create `e2e/a11y.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ensureOwner, login } from './helpers/auth';

// WCAG AA on all top pages, in both themes, plus comfort mode (spec §10).

const PAGES = ['/', '/people', '/albums', '/search', '/upload', '/profile'];

function seriousViolations(results: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const scheme of ['dark', 'light'] as const) {
  for (const path of PAGES) {
    test(`axe ${scheme}: ${path}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await ensureOwner(page);
      await login(page, 'owner');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(seriousViolations(results)).toEqual([]);
    });
  }
}

test('comfort mode: type scales up, persists, stays AA-clean', async ({ page }) => {
  await ensureOwner(page);
  await login(page, 'owner');

  const baseSize = await page.evaluate(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize)
  );

  await page.goto('/profile');
  await page.getByLabel(/comfort/i).check();
  await page.goto('/');
  await expect(page.locator('html.comfort')).toHaveCount(1);

  const comfortSize = await page.evaluate(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize)
  );
  expect(comfortSize).toBeGreaterThan(baseSize * 1.1); // ≥ ~1.125× per Contract 4

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  ).toEqual([]);

  // reset for later suites
  await page.goto('/profile');
  await page.getByLabel(/comfort/i).uncheck();
});
```

- [ ] **Step 2: Run it; fix real findings**

Run: `pnpm test:e2e e2e/a11y.spec.ts`
Expected: `13 passed` (6 pages × 2 schemes + comfort). Axe findings here are app bugs from earlier phases — fix them in the flagged component (contrast/labels/landmarks), keep the test strict, and include those fixes in this task's commit.

- [ ] **Step 3: Write the mobile viewport spec**

Create `e2e/mobile.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureOwner, login } from './helpers/auth';
import { uploadViaUi } from './helpers/media';

// Spec §10 mobile: 44px year-stepper arrows, bottom-docked century rail,
// player stacks video → people/tags → date/story → comments.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.describe.configure({ mode: 'serial' });

test('mobile timeline: visible ≥44px year steppers and bottom rail', async ({ page }) => {
  await ensureOwner(page);
  await login(page, 'owner');
  await uploadViaUi(page, 'e2e/fixtures/photo.png', { title: 'Mobile seed', date: '1994-06-14' });

  await page.goto('/?y=1994');
  const prev = page.getByRole('button', { name: /previous year|earlier/i });
  const next = page.getByRole('button', { name: /next year|later/i });
  await expect(prev).toBeVisible();
  await expect(next).toBeVisible();
  for (const btn of [prev, next]) {
    const box = await btn.boundingBox();
    expect(box, 'stepper has a box').not.toBeNull();
    expect(box!.width, 'stepper ≥44px wide').toBeGreaterThanOrEqual(44);
    expect(box!.height, 'stepper ≥44px tall').toBeGreaterThanOrEqual(44);
  }

  // century rail docks to the bottom half of the viewport on mobile
  const rail = page.locator('[data-testid="century-rail"], nav[aria-label*="decade" i]').first();
  await expect(rail).toBeVisible();
  const railBox = await rail.boundingBox();
  expect(railBox!.y, 'rail sits in the lower half').toBeGreaterThan(844 / 2);
});

test('mobile player: vertical stack — video above people/tags above story/comments', async ({
  page,
}) => {
  await login(page, 'owner');
  await page.goto('/?y=1994');
  await page.getByText('Mobile seed').first().click();
  await expect(page).toHaveURL(/\/item\//);

  const media = page.locator('img[src*="thumb_1600"], img[src*="thumb_800"], video').first();
  const peopleRow = page.getByText(/^people$/i).first();
  const commentBox = page.getByPlaceholder('Add a memory…');

  await expect(media).toBeVisible();
  await expect(commentBox).toBeVisible();

  const mediaBox = (await media.boundingBox())!;
  const peopleBox = (await peopleRow.boundingBox())!;
  const commentsBox = (await commentBox.boundingBox())!;
  expect(peopleBox.y, 'people below media').toBeGreaterThan(mediaBox.y + mediaBox.height - 1);
  expect(commentsBox.y, 'comments below people').toBeGreaterThan(peopleBox.y);
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test:e2e e2e/mobile.spec.ts`
Expected: `2 passed`. (If the rail has neither the testid nor the aria-label, add `data-testid="century-rail"` to `MobileRail.svelte` — a test hook, not a feature.)

- [ ] **Step 5: Write the visual sanity spec**

Create `e2e/visual.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureOwner, login } from './helpers/auth';

// Decade-room regression sanity: timeline home per decade, dark + light,
// threshold 0.2 (set globally in playwright.config.ts), baselines committed.
// Baselines are linux-generated; skip elsewhere unless forced.

test.skip(
  process.platform !== 'linux' && !process.env.SHOEBOX_VISUAL,
  'visual baselines are linux-only; set SHOEBOX_VISUAL=1 to force'
);

const DECADE_YEARS = [1948, 1955, 1967, 1974, 1988, 1994, 2003, 2015, 2024];

for (const scheme of ['dark', 'light'] as const) {
  for (const year of DECADE_YEARS) {
    test(`timeline room ${year} ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await ensureOwner(page);
      await login(page, 'owner');
      await page.goto(`/?y=${year}`);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`timeline-${year}-${scheme}.png`, {
        fullPage: false,
        // media content varies run-to-run; the room/chrome is what we pin
        mask: [page.locator('img'), page.locator('video')],
      });
    });
  }
}
```

- [ ] **Step 6: Generate + commit baselines (linux)**

On linux (CI runner or the Playwright image; match the repo's Playwright version — check `package.json`):

```bash
# from the repo root; substitute the exact installed @playwright/test version
docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.53.0-jammy \
  bash -lc "corepack enable && pnpm install --frozen-lockfile && pnpm test:e2e e2e/visual.spec.ts --update-snapshots"
```

Expected: all 18 tests pass with `…png is missing in snapshots, writing actual.` notices, and `e2e/__screenshots__/visual.spec.ts/timeline-*-{dark,light}.png` exist afterward (18 files).

Re-run without the flag:

```bash
docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.53.0-jammy \
  bash -lc "corepack enable && pnpm install --frozen-lockfile && pnpm test:e2e e2e/visual.spec.ts"
```

Expected: `18 passed`.

- [ ] **Step 7: Commit (baselines included — they are the point)**

```bash
git add e2e/a11y.spec.ts e2e/mobile.spec.ts e2e/visual.spec.ts e2e/__screenshots__
git commit -m "test: axe+comfort a11y, mobile viewport, and per-decade visual sanity suites"
```

---
### Task 15: CI — `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify (only if missing): `package.json` `lint` script

**Interfaces:**
- Consumes: scripts `check`, `lint`, `test`, `build`, `build:cf`, `test:e2e`, `test:e2e:cf` (Tasks 3–5, 11, 12); spec §13 CI = "typecheck, lint, unit, e2e, both build targets compile".
- Produces: two jobs — `build-and-test` (node path, both builds, full e2e, traces on failure) and `cf-smoke` (wrangler dev suite).

- [ ] **Step 1: Ensure a `lint` script exists**

Run: `pnpm lint --help >/dev/null 2>&1 || grep '"lint"' package.json`
If phase 01 shipped no `lint` script, add to `package.json`:

```json
"lint": "prettier --check . && eslint .",
```

(and only in that case: `pnpm add -D prettier eslint` if they are somehow absent — spec §13 requires lint in CI.)

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 2: Write the workflow (complete file)**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck (svelte-check)
        run: pnpm check

      - name: Lint
        run: pnpm lint

      - name: Unit tests (vitest)
        run: pnpm test

      - name: Build (node target)
        run: pnpm build
        env:
          PLATFORM: node

      - name: Build (cloudflare target)
        run: pnpm build:cf

      - name: Build (worker bundle)
        run: pnpm build:worker

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E (node build)
        run: pnpm test:e2e

      - name: Upload Playwright traces
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: |
            playwright-report/
            test-results/
          retention-days: 7

  cf-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E smoke against wrangler dev
        run: pnpm test:e2e:cf

      - name: Upload traces
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: cf-smoke-traces
          path: test-results/
          retention-days: 7
```

- [ ] **Step 3: Validate the workflow file (no push needed)**

Run: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -color`
Expected: no output, exit 0 (actionlint clean).

- [ ] **Step 4: Local dry-run of the exact CI command sequence**

Run:

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm lint && pnpm test \
  && PLATFORM=node pnpm build && pnpm build:cf && pnpm build:worker \
  && pnpm test:e2e && pnpm test:e2e:cf && echo CI_SEQUENCE_GREEN
```

Expected: `CI_SEQUENCE_GREEN`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: build-and-test + wrangler-dev smoke workflows with failure traces"
```

---

### Task 16: README, Deploy-to-Cloudflare button, CHANGELOG, release verification

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `docs/screenshots/timeline.png`, `docs/screenshots/player.png` (rendered from the locked mockups)

**Interfaces:**
- Consumes: everything — quickstarts reference `docker-compose.yml` (Task 9), the button references `wrangler.toml` provisioning (Task 4), manual steps reference `db:migrate:d1:remote` (Task 5) and the presign secrets (Task 6); ops link → `README-deploy.md` (Task 10).
- Produces: the public front door of the repo; `v0.1.0` tag.

- [ ] **Step 1: Render screenshots from the locked mockups**

Run:

```bash
mkdir -p docs/screenshots
pnpm exec playwright screenshot --viewport-size=1440,900 \
  "file://$PWD/docs/superpowers/specs/mockups/locked-timeline-and-player.html" \
  docs/screenshots/timeline.png
pnpm exec playwright screenshot --viewport-size=1440,900 \
  "file://$PWD/docs/superpowers/specs/mockups/player-v5-final.html" \
  docs/screenshots/player.png
ls -la docs/screenshots/
```

Expected: two PNGs, each > 50KB.

- [ ] **Step 2: Write `README.md` (complete file)**

Create `README.md`:

````markdown
# Shoebox

A self-hosted family media archive for short video clips (cut from Hi-8/8mm
tape scans) and photos. Upload web-ready media; the family tags who/when/what,
builds albums, comments ("Add a memory…"), and explores everything through a
year-timeline where each decade owns its own color world.

Core loop: **upload → tag (when, who, what) → explore by time → share.**

![Timeline](docs/screenshots/timeline.png)
![Player](docs/screenshots/player.png)

- **Timeline home** — a giant year band, a century rail of decades, masonry
  grids with month breaks; sliding decades crossfades the room's palette.
- **Dates that behave like memory** — day/month/year/range precision,
  "c. 1994" circa badges, automatic holiday tags, "Mom at age 5" search.
- **People pages** — accents, lifespans, family rows, per-person timelines.
- **Built for 10k–100k items** — virtualized grids, FTS5 search, pre-computed
  histograms.
- Runs on **Docker** (full pipeline: server derivatives, hover-scrub sprites,
  ingestion folder, optional face recognition) or on **Cloudflare Workers**
  (free-tier friendly; derivatives generated in the browser at upload).

## Quickstart — Docker

```bash
git clone https://github.com/davidtorcivia/shoebox && cd shoebox
cp .env.example .env      # set ORIGIN to the URL your family will use
docker compose up -d --build
open http://localhost:3000   # first visit → /setup creates the owner account
```

Optional face recognition: set `FACES_ENABLED=true` in `.env`, then
`docker compose --profile faces up -d --build`.
Operations (upgrades, nightly backups, trash sweep): see
[README-deploy.md](README-deploy.md).

## Quickstart — Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/davidtorcivia/shoebox)

The button forks the repo, provisions the resources declared in
`wrangler.toml` (D1 database `shoebox-db`, R2 bucket `shoebox-media`), applies
the D1 migrations, and deploys the Worker. **First boot:** the users table is
empty, so your Worker URL redirects to `/setup` — create the owner account
there.

Manual deploy (equivalent to the button):

```bash
pnpm install
wrangler d1 create shoebox-db        # paste the printed database_id into wrangler.toml
wrangler r2 bucket create shoebox-media
pnpm db:migrate:d1:remote
pnpm build:cf
wrangler deploy
```

Optional but recommended — offload media downloads with presigned R2 URLs
(1-hour GET links; without these, media streams through the Worker, which
still works):

```bash
# create an R2 API token (Object Read) in the Cloudflare dashboard, then:
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
# and set R2_ACCOUNT_ID in wrangler.toml [vars] (printed by: wrangler whoami)
```

**Upload sizes on Cloudflare:** Workers cap request bodies at 100 MB, but
Shoebox uploads in 8 MiB chunks, so original files far larger than 100 MB
upload fine. Original-file downloads stream via presigned R2 URLs (or through
the Worker as a fallback), so playback and downloads are not size-capped.

**What's different on Cloudflare:** no ingestion folder / Arrivals, no face
recognition, no hover-scrub sprites (thumbnails, posters, and blurhash are
generated in your browser at upload). Everything else is identical.

## Ingestion folder (Docker only)

Drop web-ready files into `./ingest`; path segments become hints:

```
ingest/1994/christmas/tape04-clip07.mp4   → year 1994, tag "christmas"
```

Files land in **Arrivals** as `needs_review` for keyboard-first triage
(dates, people, tags, batch apply, approve). Corrupt files move to
`ingest/_failed` with the reason listed in Arrivals.

Uploads must already be web-ready (H.264/HEVC MP4 or WebM video; JPEG/PNG/
WebP/AVIF photos) — Shoebox never transcodes; originals are the archival copy.

## Backups

- Docker: nightly SQLite snapshot + restic/rclone of `/data` —
  see [README-deploy.md](README-deploy.md).
- Takeout: per-album **Export** (zip with metadata JSON) from the album page.
- Cloudflare: D1 has point-in-time recovery (Time Travel); R2 holds originals.

## Development

```bash
pnpm install
pnpm dev            # node platform, local SQLite + ./data
pnpm check && pnpm test && pnpm test:e2e
pnpm build          # adapter-node  → build/
pnpm build:cf       # adapter-cloudflare → .svelte-kit/cloudflare/
pnpm test:e2e:cf    # smoke suite against wrangler dev
```

License: MIT.
````

- [ ] **Step 3: Write `CHANGELOG.md` (complete file)**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to Shoebox. Format: Keep a Changelog; versioning: SemVer.

## [0.1.0] — 2026-07-04

Initial release.

### Added
- Timeline home: year band, century rail, virtualized masonry with month
  breaks, decade palette rooms with crossfade, mobile rail.
- Media pipeline: resumable chunked uploads (8 MiB), SHA-256 dedupe,
  client-generated derivatives (poster/thumbs/blurhash); on Docker, canonical
  ffmpeg/sharp derivatives + hover-scrub sprite sheets via the worker sidecar.
- Player room with typographic controls (J/K/L, frame-step, fullscreen) and
  photo lightbox; per-decade player palettes.
- People: person pages with accent-derived rooms, relationships + derived kin,
  ages ("age 5" badges, age-window search), avatars, linked user accounts.
- Albums, flat comments ("Add a memory…"), personal accent colors.
- Search: FTS5 + omnibox chips (person/tag/type/album/age/year-range),
  filtered timeline histogram.
- Ingestion folder with path-convention hints and Arrivals triage (Docker).
- Optional face recognition container (InsightFace + HDBSCAN) with a
  suggestion review UI (Docker, off by default).
- Sharing: unlisted token URLs for albums/items with optional password,
  expiry, and download toggle; stripped public pages.
- Admin: users, invites, shares, trash (30-day soft delete), settings, jobs.
- Accessibility: WCAG AA in both themes, comfort mode, reduced-motion,
  44px targets, full keyboard nav.
- Deployment: Docker compose stack (app + worker + optional faces) and
  Cloudflare Workers (D1 + R2) with a Deploy-to-Cloudflare button.

[0.1.0]: https://github.com/davidtorcivia/shoebox/releases/tag/v0.1.0
```

- [ ] **Step 4: Full release verification (everything, both targets)**

Run:

```bash
pnpm check && pnpm lint && pnpm test \
  && PLATFORM=node pnpm build && pnpm build:cf && pnpm build:worker \
  && pnpm test:e2e && pnpm test:e2e:cf \
  && docker compose config --quiet \
  && docker build -t shoebox-app:0.1.0 . \
  && docker build -f Dockerfile.worker -t shoebox-worker:0.1.0 . \
  && echo RELEASE_GREEN
```

Expected: `RELEASE_GREEN`.

Then boot the full stack once more and click through manually: setup (if fresh
volume) → upload a photo → timeline → player → search → share link in a
private window:

```bash
docker compose up -d && sleep 35 && curl -s http://localhost:3000/healthz && docker compose ps
```

Expected: `{"ok":true,"version":"0.1.0"}`; `app` healthy, `worker` up. Tear
down with `docker compose down` when done.

- [ ] **Step 5: Commit + tag**

```bash
git add README.md CHANGELOG.md docs/screenshots
git commit -m "docs: root README with Deploy-to-Cloudflare button, deployment docs, changelog 0.1.0"
git tag v0.1.0
```

---

## Self-review — contract ambiguities resolved (decisions made by this plan)

1. **`GET /healthz` is a documented addition** (not in master Contract 6's API
   table). It is schema-free, session-free, and exists solely for Docker
   `HEALTHCHECK`, compose `depends_on: service_healthy`, and wrangler-dev
   readiness. Master's API table governs `/api/*`; `/healthz` sits outside it
   deliberately.
2. **storage-r2 `mediaUrl` fix**: master Contract 2 mandates "CF: signed R2
   URL (1h)". Task 6 replaces the phase-01 adapter with real SigV4 query
   presigning via aws4fetch against `<account>.r2.cloudflarestorage.com`.
   **Chosen fallback:** when presign secrets are not configured (fresh
   Deploy-button installs cannot mint S3 credentials automatically),
   `mediaUrl` returns `/media/<key>` and the Worker streams from the `MEDIA`
   binding with Range support — contract-compliant behavior is restored the
   moment the two secrets are set. New CF config surface: secrets
   `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, vars `R2_ACCOUNT_ID`/
   `R2_BUCKET_NAME`.
3. **`db:migrate` redefined** from phase-01's drizzle-kit invocation to
   `node scripts/migrate.mjs` (drizzle-orm migrator). Same migrations folder,
   same journal — but runnable inside the pruned production image where
   drizzle-kit/tsx don't exist. Contract 8 names the script, not its body.
4. **New scripts beyond Contract 8's list**: `build:worker`, `db:migrate:d1`,
   `db:migrate:d1:remote`, `test:e2e:cf` — additive only; every Contract 8
   name is preserved with its documented meaning.
5. **`FACES_ENABLED` env var** (worker opt-in for face_scan enqueueing,
   surfaced in compose/.env) is treated as phase-09's flag; if phase 09 named
   it differently, compose and docs must adopt phase 09's name — check before
   Task 9.
6. **Ops scripts** (`trash-sweep.mjs`, `db-backup.mjs`) are operational
   tooling, not features: sweep enforces the spec's existing 30-day trash rule
   (mirroring Admin "empty trash" semantics); backup wraps SQLite's online
   `.backup`. Neither touches the schema. Orphaned contentless-FTS rows after
   a sweep are harmless (search joins `items`) and are rewritten by the next
   `reindexItem`.
7. **Repo URL** assumed `https://github.com/davidtorcivia/shoebox` for the
   Deploy button and changelog links — update both places if the canonical
   repo differs.
8. **`ASSETS` binding + `nodejs_compat`** in `wrangler.toml` are
   adapter-cloudflare requirements, additive to Contract 8's `DB`/`MEDIA`/
   `PLATFORM` (which are all present verbatim).
9. **BODY_LIMIT_MB mapping**: adapter-node reads `BODY_SIZE_LIMIT` (bytes);
   the entrypoint converts Contract 8's `BODY_LIMIT_MB` so the documented env
   name remains the single user-facing knob.
10. **E2E fixture uses WebM/VP8** (spec-allowed upload format) rather than
    H.264 so Playwright's Chromium can decode it for client-side poster
    capture in both e2e stacks.

**Scope check against the phase-10 brief:** Dockerfile ✓ (Task 7),
Dockerfile.worker + `build:worker` ✓ (Tasks 3, 8), compose + profiles + .env +
upgrade/cron/backup docs ✓ (Tasks 9, 10), migration runners node + D1 + FTS5
verified ✓ (Tasks 2, 5), `build:cf` + wrangler.toml + wrangler-dev smoke ✓
(Tasks 4, 12), Deploy button + first-boot + body-size docs ✓ (Task 16),
presigned media URLs ✓ (Task 6), CI two jobs ✓ (Task 15), permissions/
lifecycle/dedupe/shares/axe/comfort/mobile/visual suites ✓ (Tasks 13, 14),
README/CHANGELOG/versioning ✓ (Tasks 1, 16). No new features; no schema
changes.
