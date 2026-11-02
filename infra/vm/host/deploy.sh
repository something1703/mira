#!/bin/bash
# Starts one release of MIRA on the VM, or goes back to the one before. Run as root from /opt/mira:
#   deploy.sh <tag>     pull and start <tag>; if it fails its health checks, restart the last tag
#   deploy.sh rollback  restart the tag that was live before the current one
set -euo pipefail

DIR=/opt/mira
STATE=/var/lib/mira

# Unit caps (D35). The YouCam balance is real money, so a public URL gets tight daily limits:
# one profile is 40-56 units and a shade match about 63.
SESSION_UNIT_CAP=120
RUN_UNIT_CAP=120
DEPLOYMENT_DAILY_UNIT_CAP=150

meta() {
  curl -fsS -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"
}
secret() { gcloud secrets versions access latest --secret="$1" --quiet; }

HOST=$(meta mira-host)
REGISTRY=$(meta mira-registry)

write_settings() {
  umask 077
  # Local state (profiles, ledger, runs on this disk) with real YouCam measuring: the mode every
  # live test ran in (docs/TESTS.md). The Cloud Run stack in infra/ needs live adapters first.
  cat >/etc/mira/common.env <<EOF
MIRA_MODE=mock
MIRA_YOUCAM=live
NODE_ENV=production
LOG_LEVEL=info
MIRA_WEB_URL=https://${HOST}
MIRA_WORKFLOWS_URL=http://workflows:4020
MIRA_AGENT_URL=http://agent:4010
MIRA_ENGINES_URL=http://engines:4040
MIRA_SESSION_UNIT_CAP=${SESSION_UNIT_CAP}
MIRA_RUN_UNIT_CAP=${RUN_UNIT_CAP}
MIRA_DEPLOYMENT_DAILY_UNIT_CAP=${DEPLOYMENT_DAILY_UNIT_CAP}
EOF
  # Each secret goes only to the service that uses it.
  local key session
  key=$(secret "$(meta mira-secret-youcam-api-key)")
  session=$(secret "$(meta mira-secret-session-secret)")
  printf 'YOUCAM_API_KEY=%s\n' "$key" >/etc/mira/workflows.env
  printf 'MIRA_SESSION_SECRET=%s\n' "$session" >/etc/mira/web.env
}

compose() { docker compose --project-directory "$DIR" -f "$DIR/compose.yaml" "$@"; }

start() {
  printf 'MIRA_REGISTRY=%s\nMIRA_TAG=%s\nMIRA_HOST=%s\n' "$REGISTRY" "$1" "$HOST" >"$DIR/.env"
  compose pull --quiet || return 1
  compose up --detach --remove-orphans --wait --wait-timeout 240 || return 1
}

cmd=${1:?usage: deploy.sh <tag> | rollback}
gcloud auth configure-docker "${REGISTRY%%/*}" --quiet >/dev/null 2>&1
write_settings
current=$(cat "$STATE/release" 2>/dev/null || true)

if [ "$cmd" = rollback ]; then
  previous=$(cat "$STATE/release.previous" 2>/dev/null || true)
  if [ -z "$previous" ]; then
    echo "No earlier release to go back to." >&2
    exit 1
  fi
  start "$previous"
  echo "$previous" >"$STATE/release"
  echo "$current" >"$STATE/release.previous"
  echo "Live again: $previous"
  exit 0
fi

if start "$cmd"; then
  if [ -n "$current" ] && [ "$current" != "$cmd" ]; then echo "$current" >"$STATE/release.previous"; fi
  echo "$cmd" >"$STATE/release"
  # Images older than a week that no container uses; the previous release stays for a rollback.
  docker image prune --all --force --filter "until=168h" >/dev/null
  echo "Live: $cmd at https://${HOST}"
else
  echo "Release $cmd did not pass its health checks." >&2
  compose ps >&2 || true
  compose logs --tail 60 >&2 || true
  if [ -n "$current" ]; then
    echo "Going back to $current." >&2
    start "$current" || echo "The previous release did not start either." >&2
  fi
  exit 1
fi
