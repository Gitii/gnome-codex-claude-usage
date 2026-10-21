#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for command in gjs dbus-run-session gnome-keyring-daemon; do
    command -v "$command" >/dev/null || { echo "Missing test dependency: $command" >&2; exit 1; }
done
temp_base=${TMPDIR:-/tmp}
if [[ -d /tmp/opencode ]]; then temp_base=/tmp/opencode; fi
test_home=$(mktemp -d "$temp_base/go-keyring.XXXXXX")
trap 'rm -rf "$test_home"' EXIT
chmod 700 "$test_home"
mkdir -p "$test_home/runtime" "$test_home/data" "$test_home/config" "$test_home/cache"
chmod 700 "$test_home/runtime"
# A fresh bus, HOME and XDG directories: never contact the operator's keyring.
env -u GNOME_KEYRING_CONTROL -u DISPLAY -u WAYLAND_DISPLAY \
    HOME="$test_home" XDG_RUNTIME_DIR="$test_home/runtime" \
    XDG_DATA_HOME="$test_home/data" XDG_CONFIG_HOME="$test_home/config" XDG_CACHE_HOME="$test_home/cache" \
    GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR="$PWD/codex-claude-usage@gitii.github.io/schemas" \
    dbus-run-session -- bash -euo pipefail -c '
        printf "%s" "isolated-dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets
        timeout 60 gjs -m test/secret-store-smoke.js
    '
