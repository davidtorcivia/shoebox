# Shoebox Master Implementation Plan (00)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement plans task-by-task. This master document defines the shared contracts; execute the phase plans `01`–`10` in order. Never contradict this document — if a phase plan conflicts with it, this document wins.

**Goal:** Build Shoebox — a self-hosted family media archive (video clips + photos) with timeline navigation, tagging, people pages, albums, search, sharing — running from one SvelteKit codebase on Docker (Node) and Cloudflare Workers.

**Architecture:** Single SvelteKit (Svelte 5) app; all platform differences behind interfaces in `src/lib/server/platform/` selected by `PLATFORM=node|cloudflare` at build time. Docker adds a sidecar worker process (jobs: ffmpeg/sharp derivatives, ingestion watcher) and an optional Python faces container. Cloudflare uses D1 + R2 with client-generated derivatives.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript strict, Drizzle ORM, better-sqlite3 (node) / D1 (CF), R2 / filesystem storage, Vitest, Playwright, sharp + ffmpeg (worker only), Fraunces + Archivo (self-hosted via @fontsource), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-04-shoebox-design.md` (approved). Locked mockups: `docs/superpowers/specs/mockups/*.html` — implementers of UI tasks MUST open these and match them.

## Global Constraints (apply to every task in every phase plan)

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

## Repository layout (final)

```
shoebox/
├─ package.json  pnpm-lock.yaml  svelte.config.js  vite.config.ts  tsconfig.json
├─ drizzle.config.ts  wrangler.toml  Dockerfile  Dockerfile.worker  docker-compose.yml
├─ .env.example
├─ src/
│  ├─ app.html  app.css  app.d.ts  hooks.server.ts
│  ├─ lib/
│  │  ├─ ui/
│  │  │  ├─ tokens.ts                # palettes, accents, fonts, grain, motion
│  │  │  ├─ theme.ts                 # dark/light + comfort-mode stores
│  │  │  ├─ Gradient.svelte          # layered gradient room + grain overlay
│  │  │  ├─ Nav.svelte  Avatar.svelte  Button.svelte  Field.svelte
│  │  │  ├─ MasonryGrid.svelte  MediaCard.svelte  MonthBreak.svelte
│  │  │  ├─ YearBand.svelte  CenturyRail.svelte  MobileRail.svelte
│  │  │  ├─ Player.svelte  Lightbox.svelte  ScrubTrack.svelte
│  │  │  ├─ PeopleRow.svelte  TagsRow.svelte  Comments.svelte
│  │  │  └─ DatePicker.svelte        # precision-aware date entry
│  │  ├─ domain/                     # pure, platform-free logic (unit-test heavy)
│  │  │  ├─ dates.ts                 # precision model, display, sort_date, circa
│  │  │  ├─ holidays.ts  ages.ts  relationships.ts
│  │  │  ├─ accents.ts               # accent auto-assignment
│  │  │  └─ search-query.ts          # omnibox chip parser → SQL filter AST
│  │  └─ server/
│  │     ├─ db/schema.ts  db/index.ts  db/migrations/
│  │     ├─ auth.ts  roles.ts  invites.ts  shares.ts
│  │     ├─ items.ts  people.ts  albums.ts  comments.ts  search.ts  aggregates.ts
│  │     ├─ upload.ts  dedupe.ts
│  │     └─ platform/
│  │        ├─ index.ts              # getPlatform(): Platform (build-time switch)
│  │        ├─ types.ts              # Storage, JobQueue interfaces
│  │        ├─ storage-fs.ts  storage-r2.ts
│  │        ├─ queue-sqlite.ts  queue-noop.ts
│  │        └─ db-node.ts  db-d1.ts
│  ├─ routes/
│  │  ├─ +layout.svelte  +layout.server.ts
│  │  ├─ +page.svelte                # timeline home (year via ?y=1994)
│  │  ├─ setup/+page.svelte  login/+page.svelte  invite/[token]/+page.svelte
│  │  ├─ item/[id]/+page.svelte      # player / lightbox room
│  │  ├─ people/+page.svelte  people/[id]/+page.svelte
│  │  ├─ albums/+page.svelte  albums/[id]/+page.svelte
│  │  ├─ search/+page.svelte  upload/+page.svelte  arrivals/+page.svelte
│  │  ├─ share/[token]/+page.svelte  profile/+page.svelte
│  │  ├─ admin/(users|invites|shares|trash|settings|jobs)/+page.svelte
│  │  ├─ media/[...key]/+server.ts   # node: streams from fs with Range; CF: 302 to signed R2 URL
│  │  └─ api/                        # JSON endpoints (see §API)
│  └─ worker/                        # Docker sidecar (node-only; separate build)
│     ├─ index.ts  jobs.ts  derivatives.ts  ingest-watcher.ts  conventions.ts
├─ faces/                            # optional python container (phase 09)
│  ├─ Dockerfile  main.py  requirements.txt
├─ e2e/                              # Playwright
├─ static/fonts/                     # Fraunces + Archivo woff2 (copied from @fontsource)
└─ docs/superpowers/{specs,plans}/
```

## Contract 1 — Database schema (`src/lib/server/db/schema.ts`)

The single source of truth. Phase plans may ADD nothing to this schema without updating this master file. Drizzle `sqlite-core` (works for SQLite and D1):

```ts
import { sqliteTable, text, integer, blob, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),                    // nanoid(12)
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),  // pbkdf2$310000$<salt_b64>$<hash_b64>
  role: text('role', { enum: ['owner','admin','editor','uploader','user'] }).notNull(),
  accentColor: text('accent_color').notNull(),    // hex from ACCENTS
  personId: text('person_id'),
  comfortMode: integer('comfort_mode', { mode: 'boolean' }).notNull().default(false),
  theme: text('theme', { enum: ['system','dark','light'] }).notNull().default('system'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),                    // sha256(token) hex
  userId: text('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),        // nanoid(24)
  role: text('role', { enum: ['admin','editor','uploader','user'] }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  maxUses: integer('max_uses').notNull().default(1),
  useCount: integer('use_count').notNull().default(0),
  createdBy: text('created_by').notNull().references(() => users.id),
});

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['video','photo'] }).notNull(),
  title: text('title'),
  description: text('description'),
  dateStart: text('date_start'),                  // ISO 'YYYY-MM-DD' or null
  dateEnd: text('date_end'),
  datePrecision: text('date_precision', { enum: ['day','month','year','range','unknown'] }).notNull().default('unknown'),
  sortDate: text('sort_date'),                    // ISO midpoint, null if unknown
  duration: real('duration'),                     // seconds, videos only
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  source: text('source', { enum: ['upload','ingest'] }).notNull(),
  tapeLabel: text('tape_label'),
  status: text('status', { enum: ['processing','needs_review','ready'] }).notNull(),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [index('items_sort').on(t.sortDate), index('items_status').on(t.status), uniqueIndex('items_sha').on(t.sha256)]);

export const itemFiles = sqliteTable('item_files', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id),
  kind: text('kind', { enum: ['original','poster','thumb_400','thumb_800','thumb_1600','sprite'] }).notNull(),
  storageKey: text('storage_key').notNull(),      // 'media/<itemId>/<kind>.<ext>'
  mime: text('mime').notNull(),
  width: integer('width'),
  height: integer('height'),
}, (t) => [index('item_files_item').on(t.itemId)]);

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname'),                     // e.g. "Grandma" — rendered as the hero's quote line
  birthdate: text('birthdate'),                   // ISO date
  deathDate: text('death_date'),
  birthPlace: text('birth_place'),
  bio: text('bio'),                               // markdown
  avatarItemId: text('avatar_item_id'),
  avatarCrop: text('avatar_crop'),                // JSON '{"x":0,"y":0,"w":1,"h":1}'
  accentColor: text('accent_color').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  personA: text('person_a').notNull().references(() => people.id),
  personB: text('person_b').notNull().references(() => people.id),
  type: text('type', { enum: ['parent-of','spouse-of','sibling-of'] }).notNull(),
}, (t) => [uniqueIndex('rel_unique').on(t.personA, t.personB, t.type)]);

export const itemPeople = sqliteTable('item_people', {
  itemId: text('item_id').notNull().references(() => items.id),
  personId: text('person_id').notNull().references(() => people.id),
  faceBox: text('face_box'),                      // JSON '{"x":..,"y":..,"w":..,"h":..}' normalized 0-1
  source: text('source', { enum: ['manual','ml'] }).notNull().default('manual'),
}, (t) => [primaryKey({ columns: [t.itemId, t.personId] })]);

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),          // lowercase, trimmed
  kind: text('kind', { enum: ['topic','holiday'] }).notNull().default('topic'),
});

export const itemTags = sqliteTable('item_tags', {
  itemId: text('item_id').notNull().references(() => items.id),
  tagId: text('tag_id').notNull().references(() => tags.id),
}, (t) => [primaryKey({ columns: [t.itemId, t.tagId] })]);

export const albums = sqliteTable('albums', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  coverItemId: text('cover_item_id'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const albumItems = sqliteTable('album_items', {
  albumId: text('album_id').notNull().references(() => albums.id),
  itemId: text('item_id').notNull().references(() => items.id),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.albumId, t.itemId] })]);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id),
  userId: text('user_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),        // nanoid(24)
  targetType: text('target_type', { enum: ['album','item'] }).notNull(),
  targetId: text('target_id').notNull(),
  passwordHash: text('password_hash'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  allowDownload: integer('allow_download', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id),
});

export const faces = sqliteTable('faces', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => items.id),
  frameTime: real('frame_time'),
  box: text('box').notNull(),                     // JSON normalized
  embedding: blob('embedding', { mode: 'buffer' }).notNull(),  // float32[512]
  clusterId: text('cluster_id'),
  personId: text('person_id'),
  status: text('status', { enum: ['pending','confirmed','rejected'] }).notNull().default('pending'),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['derivatives','sprite','ingest_scan','face_scan'] }).notNull(),
  payload: text('payload').notNull(),             // JSON
  status: text('status', { enum: ['pending','running','done','failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  runAfter: integer('run_after', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => [index('jobs_claim').on(t.status, t.runAfter)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),                 // JSON
});

export const yearCounts = sqliteTable('year_counts', {
  year: integer('year').notNull(),
  type: text('type', { enum: ['video','photo'] }).notNull(),
  count: integer('count').notNull(),
}, (t) => [primaryKey({ columns: [t.year, t.type] })]);
```

**FTS5** (raw SQL migration, not Drizzle): virtual table `search_fts(item_id UNINDEXED, title, description, people, tags, albums, comments)` using `content=''` (contentless); domain code in `src/lib/server/search.ts` rebuilds a row with `INSERT INTO search_fts(search_fts, rowid, ...)` delete+insert pattern on every item/people/tag/album/comment mutation via `reindexItem(db, itemId)`.

## Contract 2 — Platform interfaces (`src/lib/server/platform/types.ts`)

```ts
export interface StorageAdapter {
  put(key: string, data: Uint8Array | ReadableStream<Uint8Array>, opts: { contentType: string; sizeHint?: number }): Promise<void>;
  get(key: string, range?: { start: number; end?: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** URL the browser can fetch. Node: `/media/${key}`. CF: signed R2 URL (1h). */
  mediaUrl(key: string): Promise<string>;
}

export interface JobQueueAdapter {
  enqueue(kind: 'derivatives'|'sprite'|'ingest_scan'|'face_scan', payload: Record<string, unknown>, runAfter?: Date): Promise<void>;
}

export interface Platform {
  name: 'node' | 'cloudflare';
  storage: StorageAdapter;
  queue: JobQueueAdapter;      // queue-noop on cloudflare
  features: { ingestion: boolean; faces: boolean; serverDerivatives: boolean };
}
```

`getPlatform(event)` returns the singleton; on CF it is constructed per-request from `event.platform.env` bindings (`DB: D1Database`, `MEDIA: R2Bucket`). In `app.d.ts`, `App.Locals = { user: SessionUser | null; platform: Platform; db: Db }` where `SessionUser = { id: string; username: string; role: Role; accentColor: string; personId: string | null; comfortMode: boolean; theme: 'system'|'dark'|'light' }` and `Db = ReturnType<typeof drizzle>` — populated by `hooks.server.ts` for every request.

## Contract 3 — Auth

- Password hashing: WebCrypto PBKDF2-SHA256, 310,000 iterations, 16-byte salt → `pbkdf2$310000$<salt_b64>$<hash_b64>` (portable node/CF). Functions in `src/lib/server/auth.ts`: `hashPassword(pw): Promise<string>`, `verifyPassword(pw, stored): Promise<boolean>`, `createSession(db, userId): Promise<{ token: string; expiresAt: Date }>` (30-day expiry, cookie `sb_session`, httpOnly, SameSite=Lax, Secure in prod), `validateSession(db, token): Promise<SessionUser | null>` (stores sha256(token) as session id).
- Role helper `src/lib/server/roles.ts`: `const ROLE_RANK = { user: 0, uploader: 1, editor: 2, admin: 3, owner: 4 }`; `requireRole(locals, min: Role): SessionUser` throws SvelteKit `error(401/403)`.
- First-run: if `users` table empty, all routes redirect to `/setup` which creates the owner.

## Contract 4 — Design tokens (`src/lib/ui/tokens.ts`)

```ts
export const INK = '#171412';        // iron black — dark text/chrome anchor
export const CREAM = '#FFF5E8';      // pale egg — light text anchor
export const DAWN = '#FA7B62';       // control accents (elapsed bar, eyebrows)

export const ACCENTS = [             // user/person accent set (AA-checked pairings)
  { hex: '#FA7B62', on: 'ink' }, { hex: '#FFD9A8', on: 'ink' }, { hex: '#A8D8EA', on: 'ink' },
  { hex: '#FFD700', on: 'ink' }, { hex: '#C3272B', on: 'cream' }, { hex: '#6B6E23', on: 'cream' },
  { hex: '#446179', on: 'cream' }, { hex: '#D3826E', on: 'ink' }, { hex: '#FFB11B', on: 'ink' },
  { hex: '#A8B8C4', on: 'ink' }, { hex: '#5E6F4D', on: 'cream' }, { hex: '#B8B0A8', on: 'ink' },
] as const;

export type DecadePalette = {
  decade: number;                    // 1900, 1910, …
  stops: [string, string, string];   // deep → mid → pale
  pools: { color: string; pos: string; size: string }[];  // radial accents
  chromeOn: 'ink' | 'cream';         // which anchor the histogram/meta chrome uses in LIGHT areas
};

export const DECADES: DecadePalette[] = [
  // pre-1940 reuse (cycled): 1900s Sumi #515151→#585850→#A88868, 1910s Ebicha, 1920s Saki-nezu, 1930s Konzumi
  { decade: 1940, stops: ['#585850', '#A88868', '#C9B99F'], pools: [{ color: '#51515166', pos: '10% -10%', size: '80% 60%' }], chromeOn: 'ink' },
  { decade: 1950, stops: ['#A8D8EA', '#CFE3D8', '#F7E1A0'], pools: [{ color: '#F7E1A099', pos: '70% 40%', size: '70% 55%' }], chromeOn: 'ink' },
  { decade: 1960, stops: ['#FFD700', '#C9C25A', '#446179'], pools: [{ color: '#44617955', pos: '85% 5%', size: '70% 50%' }], chromeOn: 'ink' },
  { decade: 1970, stops: ['#FFB11B', '#D8D0C0', '#FFF1CF'], pools: [{ color: '#D3826E55', pos: '0% 80%', size: '60% 50%' }], chromeOn: 'ink' },
  { decade: 1980, stops: ['#0C0C0C', '#1F3A8A', '#AB5C57'], pools: [{ color: '#1F3A8A88', pos: '75% 15%', size: '80% 60%' }], chromeOn: 'cream' },
  { decade: 1990, stops: ['#F35336', '#FA7B62', '#FFD9A8'], pools: [{ color: '#9D2B22AA', pos: '8% -10%', size: '90% 70%' }, { color: '#FFD9A899', pos: '108% 38%', size: '70% 55%' }], chromeOn: 'ink' },
  { decade: 2000, stops: ['#672422', '#C3272B', '#A8B8C4'], pools: [{ color: '#67242288', pos: '15% -5%', size: '80% 55%' }], chromeOn: 'cream' },
  { decade: 2010, stops: ['#171412', '#5E6F4D', '#B8B0A8'], pools: [{ color: '#5E6F4D66', pos: '80% 20%', size: '75% 55%' }], chromeOn: 'cream' },
  { decade: 2020, stops: ['#1F3A8A', '#47484B', '#D6D6D6'], pools: [{ color: '#1F3A8A77', pos: '20% -10%', size: '80% 60%' }], chromeOn: 'cream' },
];
export function paletteFor(year: number): DecadePalette;   // clamps/cycles pre-1940
export function playerRoomFor(year: number): { stops: [string,string,string]; pool: string };  // palette collapsed to deep end
export function personRoomFor(accentHex: string): { stops: [string,string,string]; pools: DecadePalette['pools'] };

export const GRAIN_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E";

export const FONT = { serif: "'Fraunces Variable', Georgia, serif", sans: "'Archivo Variable', 'Helvetica Neue', sans-serif" };
export const MOTION = { fast: 200, slow: 300 };  // ms
```

Dark mode weights `stops[0]`-end; light mode weights `stops[2]`-end (Gradient.svelte takes `mode` from theme store and interpolates). Comfort mode: CSS class `comfort` on `<html>` → `font-size: 112.5%→125%`, motion off, chrome opacity raised.

## Contract 5 — Domain functions (signatures phase plans must match)

```ts
// src/lib/domain/dates.ts
export type DatePrecision = 'day'|'month'|'year'|'range'|'unknown';
export interface ItemDate { dateStart: string|null; dateEnd: string|null; precision: DatePrecision; }
export function sortDate(d: ItemDate): string | null;             // midpoint ISO
export function displayDate(d: ItemDate): string;                 // "June 14, 1994" | "June 1994" | "1994" | "Between 1992 and 1995" | "Undated"
export function shortDate(d: ItemDate): string;                   // "Jun 14" | "Jun" | "c. 1994" | "c. 1992–95" | "—"
export function yearOf(d: ItemDate): number | null;

// src/lib/domain/holidays.ts
export function holidaysFor(isoDate: string): string[];           // ['christmas'] etc; US set + easter algorithm

// src/lib/domain/ages.ts
export function ageAt(birthdate: string, onDate: string, deathDate?: string|null): number | null;
export function dateWindowForAge(birthdate: string, age: { min: number; max: number }): { start: string; end: string };

// src/lib/domain/relationships.ts
export type RelType = 'parent-of'|'spouse-of'|'sibling-of';
export interface Rel { personA: string; personB: string; type: RelType }
export function familyOf(personId: string, rels: Rel[]): { parents: string[]; children: string[]; spouses: string[]; siblings: string[]; grandparents: string[]; grandchildren: string[] };

// src/lib/domain/accents.ts
export function nextAccent(used: string[]): string;               // least-used from ACCENTS

// src/lib/domain/search-query.ts
export interface SearchQuery { text: string; people: string[]; tags: string[]; type?: 'video'|'photo'; album?: string; yearFrom?: number; yearTo?: number; age?: { person: string; min: number; max: number }; uploader?: string; }
export function parseOmnibox(input: string): SearchQuery;         // 'person:Mom age:5-7 tag:christmas 1988..1999'
```

## Contract 6 — API routes (JSON; all under `src/routes/api/`)

| Route | Method | Role | Purpose |
|---|---|---|---|
| `/api/items` | GET | user/share | list; query params: `year, month, people (csv), tags, type, album, status, q, cursor, limit≤100` → `{ items: ItemDTO[], nextCursor }` |
| `/api/items` | POST | uploader | create after upload complete |
| `/api/items/[id]` | GET/PATCH/DELETE | user / uploader-own / editor | detail (PATCH: metadata; DELETE: soft) |
| `/api/items/[id]/comments` | GET/POST | user | comments |
| `/api/upload/init` | POST | uploader | `{ sha256, sizeBytes, mime, filename }` → `{ uploadId, duplicateItemId? , chunkSize }` |
| `/api/upload/chunk` | PUT | uploader | `?uploadId&index` raw body; resumable |
| `/api/upload/complete` | POST | uploader | assembles → storage `media/<itemId>/original.<ext>`; accepts client derivatives as multipart fields `poster, thumb_400, thumb_800, thumb_1600, blurhash, meta` |
| `/api/timeline` | GET | user/share | `{ years: { year, count }[], earliest, latest }` from `year_counts` |
| `/api/people` (+`/[id]`) | GET/POST/PATCH/DELETE | user read; editor write; linked-user PATCH own bio | person CRUD + relationships (`PATCH /api/people/[id]/relationships`) |
| `/api/tags` | GET/POST | user read; editor write | |
| `/api/albums` (+`/[id]`, `/[id]/items`) | CRUD | editor (uploader: create own) | position updates batched |
| `/api/search` | GET | user | `?q=<omnibox string>` → parsed + executed, `{ items, people, albums }` |
| `/api/invites` | GET/POST/DELETE | admin | |
| `/api/shares` | GET/POST/DELETE | editor | |
| `/api/arrivals` | GET/POST | editor | queue list; POST `{ itemIds, apply: { date?, people?, tags?, albumId? }, approve: boolean }` |
| `/api/admin/*` | * | admin | users, trash restore/empty, settings, jobs list/retry |

`ItemDTO = { id, type, title, description, date: ItemDate, displayDate, shortDate, duration, width, height, status, urls: { poster, thumb400, thumb800, thumb1600, original?, sprite? }, blurhash, people: { id, name, accentColor, age? }[], tags: { id, name, kind }[], albums: { id, title }[], uploadedBy, tapeLabel }`.

## Contract 7 — Storage keys & media URL flow

- Keys: `media/<itemId>/original.<ext>`, `.../poster.webp`, `.../thumb_400.webp`, `thumb_800`, `thumb_1600`, `.../sprite.webp` (10×10 grid of 160×90 frames, one per duration/100 s).
- Browser never hits storage directly except CF signed URLs. Node streams via `/media/[...key]` with HTTP Range support (`206`, `Accept-Ranges: bytes`).
- Share pages resolve the same DTOs but scoped by share token middleware (`src/lib/server/shares.ts: resolveShare(db, token, password?)`).

## Contract 8 — Environment & builds

```
# .env.example
PLATFORM=node                # node | cloudflare (build-time)
DATABASE_PATH=/data/shoebox.db
MEDIA_PATH=/data/media
INGEST_PATH=/ingest
ORIGIN=http://localhost:5173
BODY_LIMIT_MB=4096
```
- `svelte.config.js` picks `@sveltejs/adapter-node` or `@sveltejs/adapter-cloudflare` from `process.env.PLATFORM`.
- Scripts: `dev`, `build`, `build:cf`, `check`, `test` (vitest), `test:e2e` (playwright), `db:generate`, `db:migrate`, `worker` (tsx src/worker/index.ts).
- CF bindings in `wrangler.toml`: `DB` (D1), `MEDIA` (R2); `[vars] PLATFORM=cloudflare`.

## Phase plans & boundaries (execute in order)

| # | Plan file (`docs/superpowers/plans/`) | Delivers (working software each phase) | Depends on |
|---|---|---|---|
| 01 | `…-shoebox-01-foundation.md` | Repo scaffold, tokens, schema+migrations, platform adapters (fs/sqlite + r2/d1 contract tests), auth/sessions/roles/invites, first-run setup, login, layout shell w/ Nav + theme/comfort stores, hooks | — |
| 02 | `…-shoebox-02-media-core.md` | Upload UI + chunked resumable API, client-side derivative generation (poster/thumbs/blurhash/meta via canvas), dedupe, item CRUD + DTOs, `/media` streaming with Range, `year_counts` aggregates, trash | 01 |
| 03 | `…-shoebox-03-timeline.md` | Timeline home: YearBand, CenturyRail, MasonryGrid (virtualized), MonthBreak, MediaCard (captions, duration badge, hover-scrub-ready), decade Gradient rooms + crossfade, mobile rail, `/api/timeline` | 02 |
| 04 | `…-shoebox-04-player.md` | Item room: Player (custom controls, keyboard J/K/L etc.), Lightbox for photos, people/tags rows, right-rail story, prev/next within query context | 02 (03 for nav context) |
| 05 | `…-shoebox-05-people-albums-comments.md` | People index+person pages (rooms from accent, family rows, ages, own-bio editing), relationships, albums CRUD+pages, comments with accent identities | 04 |
| 06 | `…-shoebox-06-search.md` | FTS5 index + reindex hooks, omnibox parser, search page, filter chips on timeline, age-window search, holiday auto-tagging on date writes | 05 |
| 07 | `…-shoebox-07-worker-ingestion.md` | Docker worker: jobs runner, ffmpeg/sharp canonical derivatives + sprite sheets, hover-scrub on cards, chokidar ingestion + conventions parser, Arrivals triage UI, `_failed` handling | 02 (UI bits 03) |
| 08 | `…-shoebox-08-sharing-admin.md` | Share links (password/expiry/download flag) + public room pages, admin pages (users, invites UI, shares, trash, settings, jobs), profile page, comfort mode polish pass, export-album zip | 05 |
| 09 | `…-shoebox-09-faces.md` | Python InsightFace container, face_scan jobs, clustering, suggestion review UI, feature-flag off on CF | 07 |
| 10 | `…-shoebox-10-deploy.md` | Dockerfiles + compose (app/worker/faces profiles), CF build, wrangler config, Deploy-to-Cloudflare button + provisioning docs, D1 migration runner, backup/export docs, full e2e hardening across both builds | all |

Each phase plan MUST: follow the task format from superpowers:writing-plans (bite-sized TDD steps, complete code, exact paths/commands); consume ONLY the contracts above plus its listed dependencies; end with Playwright e2e proving its golden path; keep `pnpm check && pnpm test` green at every commit.
