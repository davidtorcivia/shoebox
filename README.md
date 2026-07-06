# Shoebox

Shoebox is a self-hosted media archive for a family's photos and short video
clips. You run it on your own hardware. Originals and generated derivatives
live under a media directory you control, and metadata lives in a SQLite
database on disk. Nothing leaves the host unless you deploy the Cloudflare
build.

The archive is a timeline banded by year and decade, backed by people,
relationships, albums, comments, full-text search, and share links. An
optional worker process ingests files dropped into a watched folder, and an
optional Python service detects and clusters faces.

- License: GNU AGPL v3.0 only. See [LICENSE](./LICENSE).
- Source: https://github.com/davidtorcivia/shoebox
- Releases: https://github.com/davidtorcivia/shoebox/releases

## Features

- **Timeline.** Year- and decade-banded grid. Hover a video to scrub its
  sprite strip. Thumbnails lazy-load with responsive `srcset`.
- **Item room.** Video player with shuttle, speed, frame stepping, and
  keyboard control. Photo lightbox. Neighbor navigation. Inline metadata
  editing for title, date, tags, people, and tape label.
- **People and relationships.** Named people with accent colors, a
  relationship graph, and ages computed from item dates.
- **Albums.** Ordered collections with drag-to-reorder and zip export.
- **Comments.** Markdown, sanitized before render.
- **Search.** Omnibox over titles, descriptions, and tags, composed with
  `person:`, `tag:`, year-range, and age filters.
- **Sharing.** Time-limited links with optional passwords. Share cookies are
  HMAC-signed, so holding a link alone cannot forge access.
- **Roles.** owner, admin, editor, uploader, user. Write endpoints enforce a
  minimum role and verify ownership.
- **Admin tools.** User and invite management, trash with a 30-day grace
  window, settings, job inspection, face review.
- **Folder ingestion.** Drop files into `<ingest>/<year>/<tag>/file`. The
  worker imports them into Arrivals and derives year and tag hints from the
  path. Duplicates move to `_duplicates/`; unsupported files move to
  `_failed/`.
- **Faces (optional).** Insightface detection and clustering, reviewed in the
  admin area.

## Architecture

Shoebox is a SvelteKit 5 application that builds for two runtimes from one
codebase. A platform abstraction in `src/lib/server/platform` swaps the
storage, database, and queue adapters per target, so the domain logic above it
is identical on both.

| Concern | Docker / Node | Cloudflare |
| --- | --- | --- |
| Database | SQLite via better-sqlite3 (WAL) | D1 |
| Media | filesystem under `/media` | R2 bucket |
| Job queue | SQLite `jobs` table | none, derivatives run client-side |
| Worker process | yes | no |
| Faces service | optional | no |

The Node target is primary and the only one that runs the worker or the faces
service. The Cloudflare build is a single Worker: it hides the Arrivals UI and
generates derivatives in the browser. Chunked upload and byte-range media
streaming work on both targets.

The worker is a separate Node process. It claims jobs atomically from the
shared `jobs` table, generates derivatives and sprites with sharp and ffmpeg,
and watches the ingest folder. Two workers can never claim the same job: the
claim is a single `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING`
statement, which runs under SQLite's serialized write lock. Jobs stuck in a
running state past fifteen minutes are reclaimed.

## Security

- **Passwords and sessions.** PBKDF2-HMAC-SHA256 at 310,000 iterations with a
  16-byte random salt. Session tokens are 256 random bits, stored only as a
  SHA-256 digest; cookies are HttpOnly, SameSite=Lax, and Secure in
  production. Login is rate-limited to five attempts per minute per username.
- **Uploads.** Chunked at 8 MiB, deduplicated by SHA-256, capped at 4 GiB.
  The stored media type is determined by sniffing the bytes with `file-type`,
  ignoring the client's declared MIME. Derivatives are forced to `image/webp`.
- **Media serving.** Responses send `X-Content-Type-Options: nosniff` and
  clamp executable or SVG content types to `application/octet-stream`, so an
  uploaded HTML or SVG file cannot execute on the app origin.
- **Shares.** Links can be password-protected and time-limited. The
  share-access cookie is an HMAC of the token keyed by `SECRET_KEY`; without
  the secret, a link alone cannot forge the cookie.
- **Authorization.** Every write endpoint calls `requireRole` with a minimum
  role, and item, album, and share mutations also check ownership.

## Quick start (Docker)

The primary target is Docker on a Linux server, with separate host
directories for the database and the media files. Full instructions covering
upgrades, backups, restore, and cron are in
[README-deploy.md](./README-deploy.md).

```sh
git clone https://github.com/davidtorcivia/shoebox.git
cd shoebox
cp .env.example .env   # then set ORIGIN to the exact URL browsers will use
docker compose up -d --build
```

Browse to `http://<host>:3000/setup` and create the first owner. To enable
face review, set `FACES_ENABLED=1` in `.env` and run:

```sh
docker compose --profile faces up -d --build
```

> `ORIGIN` must be the exact external URL, whether a LAN IP or an HTTPS
> domain. SvelteKit's CSRF check on `/api/upload/complete` compares it to the
> request `Origin` header, so a mismatch breaks uploads.

## Deploy to Cloudflare (Workers, D1, R2)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/davidtorcivia/shoebox)

Manual setup:

```sh
wrangler d1 create shoebox-db                 # paste the database_id into wrangler.toml
wrangler r2 bucket create shoebox-media
wrangler whoami                               # copy the Account ID into R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
pnpm install
pnpm db:migrate:d1:remote
pnpm build:cf
wrangler deploy
```

When the R2 presign secrets are set, media requests redirect to short-lived
signed R2 URLs (one hour). Without them the Worker streams media directly from
the R2 binding with byte-range support. Keep upload sizes within the Workers
request limits; use the Docker stack for very large originals.

## Configuration

Environment variables, read by the app and the worker. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLATFORM` | `node` | `node` for Docker, `cloudflare` for Workers |
| `DATABASE_PATH` | `/data/shoebox.db` | SQLite database path (Node) |
| `MEDIA_PATH` | `/media` | originals and derivatives (Node) |
| `INGEST_PATH` | `/ingest` | watched drop folder (Node, worker) |
| `ORIGIN` | `http://localhost:3000` | exact external URL; drives CSRF |
| `BODY_LIMIT_MB` | `4096` | request body size cap |
| `FACES_ENABLED` | `0` | `1` enables the faces profile |
| `BACKUP_KEEP_DAYS` | `14` | nightly backup retention |
| `SECRET_KEY` | random per process | HMAC key for share cookies; set it for multi-instance deploys |

## Development

Requirements: Node.js 22 or newer, pnpm.

```sh
pnpm install
pnpm db:migrate
pnpm dev          # app on http://localhost:5173
pnpm worker       # derivative, sprite, and ingestion worker, separate terminal
```

| Command | What it does |
| --- | --- |
| `pnpm check` | svelte-check type checking |
| `pnpm test` | vitest unit tests |
| `pnpm test:workers` | Cloudflare-pool tests over D1 and R2 |
| `pnpm test:e2e` | build, serve, and run the Playwright suite |
| `pnpm build` | adapter-node production build |
| `pnpm build:cf` | adapter-cloudflare production build |
| `pnpm build:worker` | esbuild worker bundle |

## Operations

Backups, restore, upgrades, and the nightly cron are documented in
[README-deploy.md](./README-deploy.md). The short version: back up both host
directories, `/srv/shoebox/data` for the database and `/srv/shoebox/media` for
the files, because they are stored separately on purpose.

The `/healthz` endpoint returns `{"ok":true,"version":"0.1.0"}` after
confirming the database responds; it returns 503 if the database is
unreachable.

## License

Shoebox is licensed under the [GNU Affero General Public License v3.0
only](./LICENSE). `package.json`, this README, and `LICENSE` agree on
`AGPL-3.0-only`.
