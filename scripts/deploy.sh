#!/usr/bin/env bash
#
# Production deploy for the GTP API (runs ON the VPS).
#
# Trigger it from your machine with:
#   ssh <user>@<vps> 'cd /ruta/al/padelBot_api && ./scripts/deploy.sh'
#
# It pulls the latest master, installs deps, applies pending DB migrations
# (NEVER resets data — uses `migrate deploy`, not `migrate dev`), rebuilds
# and restarts the pm2 process.

set -euo pipefail

# --- config: ajustá el nombre del proceso pm2 si es distinto ---
PM2_APP="${PM2_APP:-padelbot-api}"
BRANCH="${BRANCH:-master}"

cd "$(dirname "$0")/.."   # repo root (api/)

echo "==> [1/6] git pull ($BRANCH)"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"   # descarta cambios locales del server, toma master tal cual

echo "==> [2/6] install deps (frozen lockfile)"
pnpm install --frozen-lockfile --prod=false

echo "==> [3/6] prisma generate"
pnpm exec prisma generate

echo "==> [4/6] prisma migrate deploy (solo aplica migraciones pendientes, no resetea)"
pnpm exec prisma migrate deploy

echo "==> [5/6] build"
pnpm build

echo "==> [6/6] restart pm2 ($PM2_APP)"
pm2 restart "$PM2_APP" --update-env
pm2 save

echo "✅ Deploy OK — $(git rev-parse --short HEAD)"
