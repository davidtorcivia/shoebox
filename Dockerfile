# syntax=docker/dockerfile:1

# One build graph, two runtime targets (app, worker): compose points each
# service at its target, so BuildKit shares every expensive layer between them
# instead of maintaining two near-identical files that merely happened to
# content-dedupe.

# ---- base: shared Node + pnpm -----------------------------------------------
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable

# ---- build: install toolchain, deps, build app + worker ---------------------
FROM base AS build
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Dependency layers cache on the lockfile alone, so editing source never
# re-runs the install. The config files ride along only because the root
# `prepare` script (svelte-kit sync) needs them during install, and
# pnpm-workspace.yaml because it holds onlyBuiltDependencies — without it,
# pnpm 10 silently skips better-sqlite3's native build and the app cannot
# open its database.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json svelte.config.js vite.config.ts tsconfig.json ./
RUN pnpm fetch
ENV PLATFORM=node
RUN pnpm install --frozen-lockfile --offline
COPY . .
RUN pnpm build && pnpm build:worker
# Prune to production deps and drop the sync scratch dir in the same layer, so
# the /app tree that ships below carries no dev weight.
RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
	&& rm -rf .svelte-kit

# Layer commits on this host (overlay2 over zfs) cost ~10s each regardless of
# size, so each runtime stage below performs exactly ONE per-build operation:
# a single COPY of the whole built /app tree. Everything else (apt, mount
# points, env) sits above it and caches until the base image changes. node
# runs unprivileged and only reads /app (root-owned, world-readable), so no
# chown pass over node_modules is needed — only the writable mount points.

# ---- app runtime ------------------------------------------------------------
FROM node:22-slim AS app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data /media \
	&& chown node:node /data /media
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	PLATFORM=node \
	DATABASE_PATH=/data/shoebox.db \
	MEDIA_PATH=/media \
	MIGRATIONS_PATH=/app/src/lib/server/db/migrations
COPY --from=build /app /app
USER node
EXPOSE 3000
VOLUME ["/data", "/media"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]

# ---- worker runtime ---------------------------------------------------------
FROM node:22-slim AS worker
# exiftool extracts the embedded JPEG preview from camera RAW files (CR2/CR3/
# NEF/ARW/DNG/RW2/RAF/ORF) so the worker can build web derivatives from them.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libimage-exiftool-perl \
	&& rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data /media /ingest \
	&& chown node:node /data /media /ingest
WORKDIR /app
ENV NODE_ENV=production \
	PLATFORM=node \
	DATABASE_PATH=/data/shoebox.db \
	MEDIA_PATH=/media \
	INGEST_PATH=/ingest \
	MIGRATIONS_PATH=/app/src/lib/server/db/migrations
COPY --from=build /app /app
USER node
VOLUME ["/data", "/media", "/ingest"]
CMD ["node", "build-worker/index.js"]
