#!/bin/sh
set -eu

# Default the request body cap to 4 GiB unless the operator overrides it.
BODY_LIMIT_MB="${BODY_LIMIT_MB:-4096}"
# adapter-node reads BODY_SIZE_LIMIT (bytes) to enforce multipart/form-data caps.
export BODY_SIZE_LIMIT=$((BODY_LIMIT_MB * 1048576))

# Bring the database to the latest schema before serving traffic.
node scripts/migrate.mjs

exec node build/index.js
