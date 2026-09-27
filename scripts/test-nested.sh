#!/usr/bin/env bash
# Launch a nested GNOME Shell with the extension enabled against the mock API.
#
# Run this from a GNOME session (or from a `toolbox` of another Fedora release
# to test a different GNOME version; toolbox shares the Wayland socket).
#
#   scripts/test-nested.sh                 # mock API, "normal" scenario
#   SCENARIO=codex-expired scripts/test-nested.sh
#   REAL=1 scripts/test-nested.sh          # use your real CLI credentials
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="codex-claude-usage@gitii.github.io"
SRC="$ROOT/$UUID"
PORT="${PORT:-8765}"
SCENARIO="${SCENARIO:-normal}"

WORK="$(mktemp -d -t ccu-nested-XXXXXX)"
trap 'kill "${MOCK_PID:-}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

glib-compile-schemas --strict "$SRC/schemas"

export XDG_DATA_HOME="$WORK/data"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_CACHE_HOME="$WORK/cache"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
ln -s "$SRC" "$XDG_DATA_HOME/gnome-shell/extensions/$UUID"

# Make the extension's schema visible to `gsettings` in the nested session.
export GSETTINGS_SCHEMA_DIR="$SRC/schemas"

# Nested shell needs a fixed monitor size.
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${MUTTER_DEBUG_DUMMY_MODE_SPECS:-1400x900}"
export SHELL_DEBUG="${SHELL_DEBUG:-all}"

SETUP=(
  gsettings set org.gnome.shell disable-user-extensions false
  "&&" gsettings set org.gnome.shell enabled-extensions "['$UUID']"
)

if [[ "${REAL:-0}" != "1" ]]; then
  export MOCK_HOME="$WORK/mock"
  python3 "$ROOT/scripts/mock-api.py" --port "$PORT" --scenario "$SCENARIO" &
  MOCK_PID=$!
  sleep 0.5
  export CODEX_HOME="$MOCK_HOME/codex"
  export CLAUDE_CONFIG_DIR="$MOCK_HOME/claude"
  BASE="http://127.0.0.1:$PORT"
  SETUP+=(
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage codex-usage-url "'$BASE/backend-api/wham/usage'"
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage codex-token-url "'$BASE/oauth/token'"
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage claude-usage-url "'$BASE/api/oauth/usage'"
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage refresh-interval 30
  )
fi

echo "==> Starting nested GNOME Shell (close its window to exit)"
dbus-run-session -- bash -c "${SETUP[*]} && exec gnome-shell --nested --wayland 2>&1 | grep -Ei 'codex-claude-usage|JS ERROR|JS WARNING|Extension' || true"
