# Shoebox

Shoebox is a self-hosted family media archive for photos and short video clips.

It supports upload, tagging, people, albums, comments, timeline browsing, search, sharing, admin tools, ingestion, and optional face review.

## Requirements

- Node.js 22 or newer
- pnpm
- SQLite for local development

## Development

```sh
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:5173` and create the first owner account.

## Useful Commands

```sh
pnpm check
pnpm test
pnpm test:e2e
pnpm worker
```

## License

Shoebox is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE`.
