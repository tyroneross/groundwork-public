#!/usr/bin/env bash
# run-supervised.sh — supervises designer-server.mjs.
#
# Restarts the server ONLY when it was killed by a signal (exit status > 128,
# e.g. the event-loop watchdog's SIGTERM=143 or the grace-period SIGKILL=137).
# A deterministic failure — EADDRINUSE, a bad flag, anything exiting <= 128 —
# is NOT restarted; this script exits immediately with that same status
# instead of looping forever on a failure that will never self-heal.
#
# Forwards TERM/INT/HUP to the child and waits for it before exiting, so
# `kill "$GW_DESIGNER_PID"` (the PID this script prints via `$!` at its own
# call site) stops both the supervisor loop and the server in one shot —
# killing only the inner `node` process would otherwise get it relaunched
# immediately by the loop below.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$SCRIPT_DIR/designer-server.mjs"

MAX_RESTARTS="${GROUNDWORK_DESIGNER_MAX_RESTARTS:-20}"
restarts=0
CHILD_PID=""

on_signal() {
  if [[ -n "$CHILD_PID" ]]; then
    kill "$CHILD_PID" 2>/dev/null
    wait "$CHILD_PID" 2>/dev/null
  fi
  exit 0
}
trap on_signal TERM INT HUP

while true; do
  start_ts=$(date +%s)
  node "$SERVER" "$@" &
  CHILD_PID=$!
  wait "$CHILD_PID"
  status=$?
  CHILD_PID=""
  ran_secs=$(( $(date +%s) - start_ts ))

  # A child that ran for a while before dying gets a fresh restart budget —
  # only a fast-crashing child should ever exhaust the cap.
  if (( ran_secs >= 60 )); then
    restarts=0
  fi

  if (( status <= 128 )); then
    exit "$status"
  fi

  restarts=$((restarts + 1))
  if (( restarts > MAX_RESTARTS )); then
    echo "designer-server exited with status $status; restart cap ($MAX_RESTARTS) reached, giving up" >&2
    exit "$status"
  fi

  echo "designer-server exited with status $status; restarting ($restarts)" >&2
  sleep 1
done
