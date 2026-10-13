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
PM2_APP="${PM2_APP:-padelbot_api}"
BRANCH="${BRANCH:-master}"
PM2_NODE_INTERPRETER="${PM2_NODE_INTERPRETER:-$(command -v node)}"

cd "$(dirname "$0")/.."   # repo root (api/)

echo "==> [1/6] fast-forward $BRANCH"
if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  echo "ERROR: expected branch $BRANCH, found $(git branch --show-current)" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "ERROR: the server checkout has uncommitted files; refusing to overwrite them" >&2
  exit 1
fi
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"

echo "==> [2/6] install deps (frozen lockfile)"
pnpm install --frozen-lockfile --prod=false

echo "==> [3/6] prisma generate"
pnpm exec prisma generate

echo "==> [4/6] prisma migrate deploy (solo aplica migraciones pendientes, no resetea)"
pnpm exec prisma migrate deploy

echo "==> [5/6] build"
pnpm build

echo "==> [6/6] restart pm2 with an explicit Node runtime ($PM2_APP)"
if [[ ! -f dist/src/main.js ]]; then
  echo "ERROR: expected compiled entrypoint dist/src/main.js was not generated" >&2
  exit 1
fi

if [[ ! -x "$PM2_NODE_INTERPRETER" ]]; then
  echo "ERROR: Node interpreter is not executable: $PM2_NODE_INTERPRETER" >&2
  exit 1
fi

node_version="$("$PM2_NODE_INTERPRETER" -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_minor_patch="${node_version#*.}"
node_minor="${node_minor_patch%%.*}"
if (( node_major < 22 || (node_major == 22 && node_minor < 12) )); then
  echo "ERROR: Node >= 22.12 is required; found $node_version at $PM2_NODE_INTERPRETER" >&2
  exit 1
fi
echo "==> using Node $node_version ($PM2_NODE_INTERPRETER)"

# PM2 cluster workers inherit the Node version of the shared PM2 daemon. That daemon still
# runs under Node 18 on this VPS and also owns unrelated apps, so keep this API in fork mode
# with an explicit supported interpreter until a coordinated PM2 daemon upgrade is performed.
pm2_field() {
  pm2 jlist | PM2_TARGET="$PM2_APP" PM2_FIELD="$1" node -e '
    let input = ""
    process.stdin.on("data", chunk => { input += chunk })
    process.stdin.on("end", () => {
      const jsonStart = input.indexOf("[")
      if (jsonStart === -1) process.exit(0)
      const apps = JSON.parse(input.slice(jsonStart))
      const app = apps.find(candidate => candidate.name === process.env.PM2_TARGET)
      process.stdout.write(String(app?.pm2_env?.[process.env.PM2_FIELD] ?? ""))
    })
  '
}

existing_mode="$(pm2_field exec_mode)"
existing_out_log="$(pm2_field pm_out_log_path)"
expected_out_log="${PM2_LOG_DIR:-$PWD/logs}/out.log"

out_log_bytes_before="$(stat -c %s "$expected_out_log" 2>/dev/null || echo 0)"

# PM2 keeps a process's log paths from when it was first started and ignores changes on
# reload, so a process started with other paths must be recreated to log where we expect.
if [[ -n "$existing_mode" && ( "$existing_mode" != "fork_mode" || "$existing_out_log" != "$expected_out_log" ) ]]; then
  echo "==> recreating $existing_mode process (logs: $existing_out_log) in fork mode with Node $node_version"
  pm2 delete "$PM2_APP"
  PM2_APP="$PM2_APP" PM2_NODE_INTERPRETER="$PM2_NODE_INTERPRETER" \
    pm2 start scripts/ecosystem.config.cjs --update-env
else
  PM2_APP="$PM2_APP" PM2_NODE_INTERPRETER="$PM2_NODE_INTERPRETER" \
    pm2 startOrReload scripts/ecosystem.config.cjs --update-env
fi
pm2 save

echo "==> checking that $expected_out_log receives the boot logs"
for _ in $(seq 1 30); do
  if tail -c +"$((out_log_bytes_before + 1))" "$expected_out_log" 2>/dev/null | grep -q "Nest application successfully started"; then
    log_ok=1
    break
  fi
  sleep 1
done
if [[ -z "${log_ok:-}" ]]; then
  echo "WARNING: no boot line in $expected_out_log after 30s — check 'pm2 describe $PM2_APP'" >&2
fi

echo "✅ Deploy OK — $(git rev-parse --short HEAD)"
