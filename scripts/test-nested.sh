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

TEMP_BASE="${TMPDIR:-/tmp}"
if [[ -d /tmp/opencode ]]; then TEMP_BASE=/tmp/opencode; fi
WORK="$(mktemp -d "$TEMP_BASE/ccu-nested-XXXXXX")"
cleanup() {
  kill "${MOCK_PID:-}" 2>/dev/null || true
  # A headless Shell can activate the document portal's private FUSE mount.
  if mountpoint -q "$WORK/runtime/doc"; then
    fusermount3 -u "$WORK/runtime/doc" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

glib-compile-schemas --strict "$SRC/schemas"

export XDG_DATA_HOME="$WORK/data"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_CACHE_HOME="$WORK/cache"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
ln -s "$SRC" "$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
ENABLED="['$UUID']"
if [[ "${PROBE:-0}" == "1" ]]; then
  export CCU_TEST_ROOT="$ROOT"
  PROBE_UUID="go-ui-probe@test"
  PROBE_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$PROBE_UUID"
  mkdir -p "$PROBE_DIR"
  cp "$ROOT/test/nested-probe.js" "$PROBE_DIR/extension.js"
  printf '{"uuid":"%s","name":"Go test probe","description":"Disposable UI validation","shell-version":["46","47","48","49","50","51"]}' "$PROBE_UUID" > "$PROBE_DIR/metadata.json"
  ENABLED="['$UUID', '$PROBE_UUID']"
fi

# Make the extension's schema visible to `gsettings` in the nested session.
export GSETTINGS_SCHEMA_DIR="$SRC/schemas"

# Nested shell needs a fixed monitor size.
export MUTTER_DEBUG_DUMMY_MODE_SPECS="${MUTTER_DEBUG_DUMMY_MODE_SPECS:-1400x900}"
export SHELL_DEBUG="${SHELL_DEBUG:-all}"

SETUP=(
  gsettings set org.gnome.shell disable-user-extensions false
  "&&" gsettings set org.gnome.shell enabled-extensions "\"$ENABLED\""
)

if [[ "${REAL:-0}" != "1" ]]; then
  # Isolate fallback Codex/Claude paths as well as the keyring. Preserve the
  # parent's display socket for the nested compositor only.
  export HOME="$WORK/home"
  mkdir -p "$HOME"
  if [[ -n "${WAYLAND_DISPLAY:-}" && "$WAYLAND_DISPLAY" != /* ]]; then
    export WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:?}/$WAYLAND_DISPLAY"
  fi
  export XDG_RUNTIME_DIR="$WORK/runtime"
  mkdir -m 700 "$XDG_RUNTIME_DIR"
  unset GNOME_KEYRING_CONTROL
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
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage opencode-go-usage-url "'$BASE/zen/go/v1/usage'"
    "&&" bash -c "'printf isolated-test-password | gnome-keyring-daemon --unlock --components=secrets'"
    "&&" gjs -m "'$ROOT/test/seed-go-key.js'"
    "&&" gsettings set org.gnome.shell.extensions.codex-claude-usage refresh-interval 30
  )
fi

echo "==> Starting nested GNOME Shell (close its window to exit)"
if [[ -z "${SHELL_ARGS:-}" ]]; then
  if gnome-shell --help | grep -q -- --nested; then
    SHELL_ARGS='--nested --wayland'
  else
    SHELL_ARGS='--devkit --wayland'
  fi
fi
if [[ "${PROBE:-0}" == "1" ]]; then
  dbus-run-session -- bash -c "${SETUP[*]} && exec gnome-shell $SHELL_ARGS" 2>&1 | tee "$WORK/probe.log"
  grep -q 'GO UI PROBE PASSED' "$WORK/probe.log"
  if grep -q 'GO UI PROBE FAILED' "$WORK/probe.log"; then exit 1; fi
else
  dbus-run-session -- bash -c "${SETUP[*]} && exec gnome-shell $SHELL_ARGS"
fi
