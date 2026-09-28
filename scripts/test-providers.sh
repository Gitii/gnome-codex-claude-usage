#!/usr/bin/env bash
# Run the provider modules under gjs against the mock API for every scenario.
# Needs: gjs, gir1.2-soup-3.0 (Ubuntu) / gjs + libsoup3 (Fedora), python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8765}"
BASE="http://127.0.0.1:$PORT"

cleanup() { kill "${MOCK_PID:-}" 2>/dev/null || true; rm -rf "${WORK:-}"; }
trap cleanup EXIT

run_scenario() {
  local scenario="$1" mock_scenario="${2:-$1}"
  WORK="$(mktemp -d -t ccu-prov-XXXXXX)"
  export MOCK_HOME="$WORK/mock"
  python3 "$ROOT/scripts/mock-api.py" --port "$PORT" --scenario "$mock_scenario" >"$WORK/mock.log" 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 1 50); do
    grep -q listening "$WORK/mock.log" 2>/dev/null && break
    sleep 0.1
  done
  export CODEX_HOME="$MOCK_HOME/codex" CLAUDE_CONFIG_DIR="$MOCK_HOME/claude"
  case "$scenario" in
    offline) base="http://127.0.0.1:1" ;;
    no-credentials) export CODEX_HOME="$WORK/none" CLAUDE_CONFIG_DIR="$WORK/none"; base="$BASE" ;;
    *) base="$BASE" ;;
  esac
  timeout 60 gjs -m "$ROOT/test/providers-smoke.js" "$base" "$scenario"
  kill "$MOCK_PID"; wait "$MOCK_PID" 2>/dev/null || true
  rm -rf "$WORK"
}

for s in normal codex-expired claude-expired limit; do run_scenario "$s"; done
run_scenario offline normal
run_scenario no-credentials normal
echo "All provider scenarios passed."
