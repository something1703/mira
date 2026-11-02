#!/usr/bin/env bash
# Starts the Firestore and Pub/Sub emulators (need Java and `gcloud components install
# cloud-firestore-emulator pubsub-emulator`), runs the runtime tests against them, and stops them.
# Without the emulators those tests are skipped.
set -euo pipefail
FS_PORT="${FIRESTORE_EMULATOR_PORT:-8787}"
PS_PORT="${PUBSUB_EMULATOR_PORT:-8788}"
LOG="$(mktemp)"
gcloud emulators firestore start --host-port="127.0.0.1:${FS_PORT}" >"$LOG" 2>&1 &
FS=$!
gcloud beta emulators pubsub start --quiet --host-port="127.0.0.1:${PS_PORT}" >>"$LOG" 2>&1 &
PS=$!
trap 'kill "$FS" "$PS" 2>/dev/null || true; rm -f "$LOG"' EXIT
for port in "$FS_PORT" "$PS_PORT"; do
  for _ in $(seq 1 60); do
    if curl -s "http://127.0.0.1:${port}" >/dev/null 2>&1; then break; fi
    sleep 1
  done
done
FIRESTORE_EMULATOR_HOST="127.0.0.1:${FS_PORT}" PUBSUB_EMULATOR_HOST="127.0.0.1:${PS_PORT}" \
  pnpm exec vitest run "$@"
