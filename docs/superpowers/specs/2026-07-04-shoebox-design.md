# Shoebox — Design Specification

**Date:** 2026-07-04
**Status:** Approved pending final review
**Mockups:** `.superpowers/brainstorm/75816-1783208625/content/` (locked: `visual-direction-v4.html` minus horizontal bars → `locked-timeline-and-player.html` top half; player: `player-v5-final.html`)

## 1. What Shoebox is

A self-hosted family media archive for short video clips (cut from Hi-8/8mm tape scans in an NLE) and photos. The owner uploads web-ready media; family members tag who/when/what, build albums, comment, and explore everything through a year-timeline interface. It runs in Docker on a home server, and anyone can spin up their own instance on Cloudflare Workers + R2 with one click.

Core loop: **upload → tag (when, who, what) → explore by time → share.**

### Non-goals (v1)

- No in-app video trimming — clips are cut in the NLE before upload.
- No server-side video transcoding — uploads are already web-ready (H.264/HEVC MP4/WebM, JPEG/PNG/WebP/AVIF photos). Originals are the archival copies.
- No email delivery (invites are copy-link).
- No natural-language search (structured search only).
- No federation/multi-family tenancy — one family per instance.

## 2. Scale target

Tens of thousands of items. Everything (grids, search, timeline histogram) must be built for 10k–100k items: virtualized rendering, indexed queries, paginated APIs, pre-computed aggregates.

## 3. Users, roles, invites, sharing

Role hierarchy (each includes everything below it):

| Role | Capabilities |
|---|---|
| **Owner** | Everything; created at first-run setup; can create/demote admins; cannot be deleted |
| **Admin** | Site settings, user management, invites, all content, empty trash |
| **Editor** | Upload, edit/delete any content, tag, manage albums/people, process Arrivals |
| **Uploader** | Upload; edit/tag/delete **own** items; comment |
| **User** | View everything, comment |

- **Invites**: owner/admins mint invite links: preset role, expiry, max-use count. No open registration. Invitee picks username/password on redemption.
- **Account ↔ Person link**: a user account can be linked to a `person` record. Users can edit their **own** linked person's bio/details regardless of role (or an editor can do it for them).
- **Public shares**: albums and individual items get unlisted token URLs with optional password (hashed) and optional expiry; toggle for allowing original-file download. Public viewers get a stripped, read-only UI without comments.
- **Comments**: flat (non-threaded), any authenticated user; author or editor+ can delete. Input is labeled "Add a memory…".
- Every user gets a **personal accent color** from the gradient palette (auto-assigned, changeable in profile); it colors their username, avatar block, and activity everywhere.

## 4. The date model

Every item carries:

- `date_start`, `date_end` (ISO dates; equal when precise), `date_precision ∈ {day, month, year, range}`
- `sort_date` (computed midpoint) — position on timeline and default masonry order
- Display formats: `day` → "June 14, 1994" · `month` → "June 1994" · `year` → "1994" · `range` → "Between 1992 and 1995", with a "c. 1994" (circa) badge treatment in grids
- **Holidays**: derived automatically at write time from exact dates (US federal + common cultural set: Christmas, Thanksgiving, July 4th, Halloween, Easter, New Year's; extensible list in config) → system tags (`kind=holiday`)
- **Ages**: people have optional `birthdate` (and `death_date`); when both a person tag and an exact-enough item date exist, the UI shows "age N" and search supports age windows ("Mom at age 5" → date range filter computed from birthdate). Ages cap at death_date; lifespans sanity-bound circa guesses.

## 5. People, relationships, person pages

`people`: `name`, `birthdate?`, `death_date?`, `birth_place?`, `bio` (markdown), `avatar` (crop rect referencing an item), `accent_color`, `linked_user_id?`.

`relationships`: `(person_a, person_b, type ∈ {parent-of, spouse-of, sibling-of})`, stored once with canonical direction; inverses and derived kin (grandparents, cousins, in-laws) computed for display, never stored.

**Person page** = destination, not filter:
- Gradient hero (person's accent palette), name, lifespan ("1941 – 2019"), birth place
- Editable bio (markdown; owner of linked account or editor+)
- Immediate-family strip: parents / spouse / siblings / children as tappable chips
- Mini tree view: 2 generations up/down, auto-laid-out from relationship primitives
- The person's timeline: every item they appear in, chronological, with age badges
- Stats: items count, years covered

## 6. Architecture

**One SvelteKit (Svelte 5) codebase, swappable platform adapters.**

- UI + API routes in a single SvelteKit app. TypeScript throughout.
- `PLATFORM=node | cloudflare` selects adapter implementations at build time.
- **adapter-node** build → Docker image. **adapter-cloudflare** build → Workers.

Platform interfaces (`src/lib/server/platform/`):

| Interface | Node/Docker impl | Cloudflare impl |
|---|---|---|
| `Storage` (put/get/stream/delete/signedUrl) | Filesystem (`/data/media`) | R2 |
| `Database` (Drizzle ORM) | better-sqlite3, SQLite file + FTS5 | D1 + FTS5 |
| `JobQueue` (enqueue/claim/complete/retry) | SQLite-backed `jobs` table, polled by worker process | No-op (work happens client-side at upload) |
| `ImageOps` (resize, poster) | sharp + ffmpeg | Client-generated at upload; CF Image Resizing fallback |

Docker deployment (`docker-compose.yml`):
1. `app` — SvelteKit Node server
2. `worker` — Node process: job runner (derivatives), chokidar ingestion watcher
3. `faces` — Python + InsightFace/ONNX container, polls `jobs` (optional, off by default via compose profile)

Cloudflare deployment: single Worker + D1 + R2, provisioned by a "Deploy to Cloudflare" button (wrangler config in repo). Feature flags disable ingestion/faces UI on CF.

## 7. Media pipeline

**Web upload (both platforms):**
1. Browser hashes file (SHA-256) → dedupe check against existing items (warn, allow override).
2. Resumable chunked upload to storage.
3. Browser generates derivatives locally: poster frame (videos, canvas capture), thumbnail set (400/800/1600w WebP), blurhash placeholder, and extracts metadata (duration, dimensions, EXIF date for photos).
4. Server validates, stores derivatives, creates item (`status=ready`, or `needs_review` if no date).
5. On Docker, a background job regenerates canonical derivatives with ffmpeg/sharp (higher quality) plus a **scrub sprite sheet** for hover-scrubbing.

**Ingestion folder (Docker only):**
- chokidar watches `/ingest`; a file is claimed when size is stable.
- Path conventions parsed as hints: `/ingest/<year>/<tag>/file.mp4` → year + tag; EXIF/container dates used when present.
- Item created with `status=needs_review`, file moved into managed storage, full server-side derivative treatment.
- **Arrivals** page (editors+): keyboard-first triage queue — batch-confirm dates, people, tags; approve moves items to `ready`.

**Playback:** progressive MP4/WebM via HTTP range requests (signed URLs on CF). No HLS — clips are short.

**Face ML (Docker, optional):**
- `faces` container samples video frames (1 fps capped) and photos, detects + embeds (InsightFace), clusters (HDBSCAN incremental).
- Suggestions surface in UI: "Are these the same person?" review cards; confirming assigns `person_id` to face records and tags items; rejecting mutes the cluster pairing.
- CF deployment: manual tagging only (fast keyboard bulk-tag UI exists everywhere).

## 8. Search

- **FTS5** index over: item title/description, people names, tag names, album titles, comment text.
- Structured filters composable with text: people (AND-combos), tags, holidays, type (video/photo), albums, date windows, age windows, uploader.
- Omnibox with typed chips: `person:Mom age:5-7 tag:christmas type:video 1988..1999`.
- Timeline view accepts any filter set (filtered histogram re-renders).
- Aggregates table (`year → count` per filter-relevant dimensions) maintained on write for instant histograms.

## 9. Data model (Drizzle, SQLite/D1)

```
users(id, username, password_hash, role, accent_color, person_id?, comfort_mode, theme, created_at)
invites(id, token, role, expires_at?, max_uses, use_count, created_by)
sessions(id, user_id, expires_at)
items(id, type[video|photo], title?, description?, date_start?, date_end?, date_precision, sort_date?,
      duration?, width, height, size_bytes, sha256, source[upload|ingest], tape_label?,
      status[processing|needs_review|ready], uploaded_by, deleted_at?, created_at)
item_files(id, item_id, kind[original|poster|thumb_400|thumb_800|thumb_1600|sprite], storage_key, mime, width?, height?)
people(id, name, birthdate?, death_date?, birth_place?, bio?, avatar_item_id?, avatar_crop?, accent_color, created_at)
relationships(id, person_a, person_b, type[parent-of|spouse-of|sibling-of])
item_people(item_id, person_id, face_box?, source[manual|ml])
tags(id, name, kind[topic|holiday])
item_tags(item_id, tag_id)
albums(id, title, description?, cover_item_id?, created_by, created_at)
album_items(album_id, item_id, position)
comments(id, item_id, user_id, body, created_at, deleted_at?)
shares(id, token, target_type[album|item], target_id, password_hash?, expires_at?, allow_download, created_by)
faces(id, item_id, frame_time?, box, embedding BLOB, cluster_id?, person_id?, status[pending|confirmed|rejected])
jobs(id, kind, payload JSON, status[pending|running|done|failed], attempts, run_after, created_at)
settings(key, value)  -- site name, holiday set, feature flags
search_fts(FTS5 virtual table)
year_counts(year, type, count)  -- histogram aggregate
```

Soft-delete everywhere user-facing (30-day trash; admins can empty). All destructive endpoints require role check + CSRF protection.

## 10. Visual design system — "Full Chroma" (locked via mockups)

**Non-negotiables** (from approval rounds): sharp corners everywhere (zero border-radius), no borders on media, no frosted glass/blur panels, no play-button overlays on thumbnails, **no italics anywhere**, never the Inter typeface, minimal monospace (only tiny duration badges on grid thumbnails).

- **Gradient-first**: full-bleed saturated gradient backgrounds from the NUEVO.TOKYO set (`/Users/davidtorcivia/DEV/gradients`, all 41 to be catalogued into tokens). Layered composition: linear wash + 1–2 radial pools + film-grain overlay (SVG turbulence, mix-blend overlay, ~50%).
- **Decade worlds** — each decade owns a palette; sliding the timeline crossfades the room:
  - '40s Konzumi `#585850→#A88868`, '50s Usu-ao `#A8D8EA→#F7E1A0`, '60s Ki-iro `#FFD700→#446179`, '70s Yamabuki `#FFB11B→#D8D0C0→#FFF1CF`, '80s Ruri `#0C0C0C→#1F3A8A→#AB5C57`, '90s Benihi `#F35336→#FA7B62→#FFD9A8`, '00s Akabeni `#672422→#C3272B→#A8B8C4`, '10s Yanagi `#171412→#5E6F4D→#B8B0A8` (pre-1940s and 2020s+ assigned during token catalog pass; palettes extend as the archive grows)
- **Type**: serif carries the human layer (dates, titles, descriptions, comments, people, tags) — warm variable serif, e.g. Fraunces, always roman. Sans (e.g. Archivo) is the system layer: nav, labels, controls, timecodes — small, uppercase, letterspaced. Self-hosted (CF CSP + privacy).
- **Ink anchors**: `#171412` (iron black) and `#FFF5E8` (pale egg) are the two text colors; each decade palette declares which chrome elements flip to ink for contrast.
- **Dark/light**: both first-class; decade palettes have dark-end and light-end stops — dark mode weights the deep stops, light mode the pale stops. System preference + manual toggle.

### Timeline home (the main nav)

- Nav bar: SHOEBOX wordmark, Timeline / People / Albums / Search / **Arrivals** (editors+ only see Arrivals) + account block (name + square monogram in ink).
- Hero year band: giant active year (~170px desktop), flanked by fading neighbor years; drag, scroll-wheel, arrow keys, tap.
- **Century rail**: decade segments of ten year-ticks each, spanning (earliest item decade − 1) → (current decade + 1). Density = tick height; empty decades are faint dots but clickable (jump to nearest content); future decade ghosted; century marks (1900, 2000) bold; active decade label bold. No horizontal rule lines.
- Masonry grid per year, chronological; **month breaks** flow inside the grid as pure typography (small sans eyebrow + big month name in ink, no rules). Every card: mono duration badge (videos, bottom-right), caption row beneath — date left, people/event right, small mono-style caps at reduced ink opacity (exactly as in the locked mockup). Circa items show "c. YYYY".
- Hover-scrub on video cards via sprite sheets (desktop); thin bottom hairline shows scrub position. Tap = open player.
- Infinite scroll into adjacent years; the year band docks to a compact top scrubber while scrolling.

### The player (locked `player-v5-final.html`)

- Each decade's player room = its palette collapsed to the deep end (e.g. '90s: iron black → shrimp brown → benihi ember, radial top-right) + grain.
- Top bar: "← Back to 1994" (sans, uppercase), serif roman title center, "✕ Close" right — all generously sized.
- Big prev/next: 44px arrows + small labels, vertically centered at the video midline, outside the stage.
- Video large (~69% width); controls as typography below it: play glyph, tabular sans timecode, **8px-tall track** with dawn-colored elapsed bar and 4×28px white playhead, then Vol / 1× / Full as small sans text. Controls fade during playback, return on movement. No icon-kit buttons.
- Keyboard: space play/pause, J/K/L shuttle, ←/→ frame-step, ↑/↓ prev/next item, F fullscreen, M mute.
- Under the video, two stacked rows with fixed left labels: **People** (19px square avatar inline at text height + serif name + "· age N" in small sans) then **Tags** (serif, dawn color `#FFD9A8`, no underline — color alone marks them as links; album memberships appear here too).
- Right rail, top to bottom: sans eyebrow provenance ("Tuesday · Hi-8 · Tape 04"), 46px serif date, serif description, comments.
- **Comments**: inline 19px avatar + uppercase sans username in the user's accent color + relative time; serif body below at 16px. Input: an obvious sharp-cornered text box — filled field (cream tint on dark, no border, no underline) with generous padding and "Add a memory…" placeholder.
- Photos open in the same room minus the control row.
- Mobile: rail stacks below video; edges become swipe.

### Accessibility & elderly support

- WCAG AA contrast in both themes (each decade palette ships pre-verified ink/cream assignments).
- **Comfort mode** (one tap, persisted per account): ~1.25× type, larger targets, simplified chrome, reduced motion, stronger contrast.
- 44px+ touch targets, visible year stepper buttons (◀ ▶) alongside drag, no hover-only functionality (tap equivalents everywhere), full keyboard nav + focus states, screen-reader landmarks/alt flows, `prefers-reduced-motion` honored globally (kills gradient drift + crossfades).
- Base type ≥16px; motion 200–300ms springs.

## 11. Other screens (design language applies; build from tokens + locked patterns)

- **People index**: grid of square avatar cards (accent-palette gradient fill when no avatar) → person pages.
- **Albums**: cover-led grid; album page = same masonry + description header; share button (editors+).
- **Search**: omnibox with typed chips + results masonry + filtered timeline band.
- **Arrivals** (editors+): triage queue — big preview, keyboard-first date/people/tag entry, batch apply, approve.
- **Admin**: users & invites, shares, trash, settings (site name, holidays, feature flags), storage stats.
- **Upload**: drag-drop multi-file, per-file progress, dedupe warnings, inline metadata form (date w/ precision picker, people, tags, album, description).

## 12. Error handling

- Uploads: resumable, idempotent by SHA-256; dedupe warns before storing twice.
- Processing failures → item stays visible with placeholder + retry action; `jobs.attempts` with exponential backoff; failed jobs surface in Admin.
- Deletes: soft-delete + 30-day trash everywhere.
- Ingestion: unparseable/corrupt files land in a "problems" list in Arrivals with the reason, original file left untouched in `/ingest/_failed`.
- Sessions: httpOnly cookies; share tokens are 128-bit random, rate-limited password attempts.

## 13. Testing

- **Vitest** unit: date model (precision/ranges/ages/holidays), relationship derivation, search query builder, platform adapters (contract tests run against both impls — SQLite/D1 via Miniflare, fs/R2 via R2 emulation).
- **Playwright** e2e (Node build in CI): golden paths — first-run setup, invite redemption, upload→tag→timeline→player, search combos, album share with password, arrivals triage, comfort mode.
- Drizzle migrations tested against both SQLite and D1.
- CI: typecheck, lint, unit, e2e, both build targets compile.

## 14. Deployment

- **Docker**: `docker-compose up` → app + worker (+ faces profile). Volumes: `/data` (media + SQLite), `/ingest`. Single `.env`.
- **Cloudflare**: "Deploy to Cloudflare" button → provisions Worker, D1, R2, runs migrations, first-run setup screen creates owner.
- Backups (Docker): nightly SQLite snapshot + docs recommending restic/rclone for `/data`; Export feature (per-album zip with metadata JSON) for takeout.

## 15. Build phases (preview — full implementation plan is the next document)

1. Foundation: repo, SvelteKit, adapters, schema, auth/roles/invites, first-run setup
2. Media core: upload pipeline, client derivatives, storage, item CRUD, dedupe
3. Timeline home: year band, century rail, masonry, month breaks, decade palettes
4. Player + photo lightbox
5. People/relationships/person pages; albums; comments
6. Search + filters + omnibox
7. Docker extras: worker, ingestion watcher, Arrivals, sprite sheets
8. Sharing, admin, trash, comfort mode polish
9. Face ML container + review UI
10. CF deploy button, docs, e2e hardening
