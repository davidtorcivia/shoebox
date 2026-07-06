# Deploying Shoebox on Ubuntu with Docker

Shoebox's primary production target is Docker on a Linux Ubuntu server. This
guide installs the app, worker, and (optionally) faces services with **separate
host directories for the database and the media files**.

## 1. First run

Install Docker and the Compose plugin, then create the host directories that
back the containers:

```sh
sudo mkdir -p /srv/shoebox/{data,media,ingest}
sudo chown -R $USER:$USER /srv/shoebox
```

Clone the repo and copy the environment template:

```sh
git clone https://github.com/davidtorcivia/shoebox.git /opt/shoebox
cd /opt/shoebox
cp .env.example .env
```

Edit `.env`:

- `ORIGIN` — **the exact external URL browsers will use**, including a LAN IP
  (`http://192.168.1.50:3000`) or HTTPS domain (`https://photos.example.com`).
  SvelteKit's multipart/form CSRF check on `/api/upload/complete` compares the
  request `Origin` header to `ORIGIN`; a mismatch (for example leaving the
  default `http://localhost:3000` while browsing by IP) makes uploads fail with
  `403 Cross-site POST form submissions are forbidden`.
- `SHOEBOX_DATA_DIR=/srv/shoebox/data`
- `SHOEBOX_MEDIA_DIR=/srv/shoebox/media`
- `SHOEBOX_INGEST_DIR=/srv/shoebox/ingest`
- `FACES_ENABLED=0`

Build and start the stack:

```sh
docker compose up -d --build
```

The app container runs migrations on startup and then serves on port 3000.
Browse to `http://<server>:3000/setup` and create the first owner account. The
SQLite database lives under `SHOEBOX_DATA_DIR`; originals and derivatives live
under `SHOEBOX_MEDIA_DIR/media/<itemId>/...`.

## 2. Optional face review

```sh
# in .env: FACES_ENABLED=1
docker compose --profile faces up -d --build
```

`FACES_ENABLED` is numeric: `1` enables faces, `0` disables them. Do **not** use
`true`/`false`.

## 3. Upgrading

1. Pull/build the new images: `docker compose build`.
2. Run migrations without starting the app: `docker compose run --rm --no-deps --entrypoint node app scripts/migrate.mjs`.
3. Restart dependencies first, then the app:
   ```sh
   docker compose up -d --no-deps worker
   docker compose --profile faces up -d --no-deps faces   # if enabled
   docker compose up -d --no-deps app
   ```
4. Confirm health: `curl -fsS http://localhost:3000/healthz` → `{"ok":true,"version":"0.1.0"}`.

## 4. Nightly maintenance cron

```cron
0 3 * * * cd /opt/shoebox && docker compose exec -T app node scripts/trash-sweep.mjs
15 3 * * * cd /opt/shoebox && docker compose exec -T app node scripts/db-backup.mjs /data/backups
```

`trash-sweep.mjs` purges items/comments/albums soft-deleted more than 30 days
ago and removes their media. `db-backup.mjs` writes a timestamped snapshot to
`/data/backups` (inside the container → `SHOEBOX_DATA_DIR/backups` on the host)
and prunes backups older than `BACKUP_KEEP_DAYS` (default 14).

## 5. Backups

Back up **both** host directories off-site:

- `/srv/shoebox/data` — the live `shoebox.db` plus the consistent snapshots in
  `data/backups/`. This is the canonical database copy.
- `/srv/shoebox/media` — originals and derivatives, stored separately from the
  database.

## 6. Restore

```sh
docker compose down
# restore media into SHOEBOX_MEDIA_DIR
# restore a DB snapshot into SHOEBOX_DATA_DIR (e.g. cp snapshot.db shoebox.db)
rm -f /srv/shoebox/data/shoebox.db-wal /srv/shoebox/data/shoebox.db-shm
docker compose up -d
```

Delete the stale WAL/SHM files so SQLite rebuilds them against the restored
snapshot.

## 7. Ingestion folder

Drop files into `${SHOEBOX_INGEST_DIR}/<year>/<tag>/clip.mp4` on the host. The
worker (which mounts `/ingest`) imports them into Arrivals, deriving year and
tag hints from the folder structure. Files already in the archive move to
`_duplicates/`; unsupported or unreadable files move to `_failed/`.
