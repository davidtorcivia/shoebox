# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-04

First tagged release.

### Added

- Timeline, item/player room, people, relationships, albums, comments, search,
  sharing, admin tools, and optional face review.
- Chunked upload pipeline with 8 MiB chunks, client-side derivative generation,
  dedupe by SHA-256, and soft-delete with a 30-day trash grace window.
- Folder ingestion watcher (Docker/worker target) with year/tag conventions.
- Docker stack (app + worker + optional faces) with separate `/data` and
  `/media` volumes, migration-on-start entrypoint, healthcheck, and nightly
  backup/trash-sweep scripts.
- Cloudflare Workers compatibility build (D1 + R2) with streaming presigned R2
  media URLs.
- `/healthz` dependency-free health endpoint and `BODY_LIMIT_MB` body-size cap.

[0.1.0]: https://github.com/davidtorcivia/shoebox/releases/tag/v0.1.0
