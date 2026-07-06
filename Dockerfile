# syntax=docker/dockerfile:1

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
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch
COPY . .
ENV PLATFORM=node
RUN pnpm install --frozen-lockfile --offline
RUN pnpm build && pnpm build:worker
RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts

# ---- app runtime ------------------------------------------------------------
FROM node:22-slim AS app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	PLATFORM=node \
	DATABASE_PATH=/data/shoebox.db \
	MEDIA_PATH=/media \
	MIGRATIONS_PATH=/app/migrations
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/migrate.mjs /app/scripts/db-backup.mjs /app/scripts/trash-sweep.mjs ./scripts/
COPY --from=build /app/src/lib/server/db/migrations ./migrations
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
	&& mkdir -p /data /media \
	&& chown -R node:node /app /data /media
USER node
EXPOSE 3000
VOLUME ["/data", "/media"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
