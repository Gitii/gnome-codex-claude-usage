# OpenCode Go validation — 2026-10-21

## Automated checks

On Ubuntu 26.04, native GJS/Soup 3/libsecret and an isolated gnome-keyring:
`make check`, `make lint`, `make test-providers`, `make test-secret-store`, and
`make zip` passed. Provider tests isolate HOME/XDG fallback paths. No real key,
real keyring or live API was read. The shared HTTP client and actual mock server
cover normal three-window data, absent optional quotas, malformed rolling and
monthly data, 401, 403, 500, non-JSON, offline and missing credentials.
Controlled delayed responses test replacement/removal/disable invalidation.
ZIP inspection confirmed the provider, secure-store module, revision lifecycle
helper, schema and both official icons/notices are packaged; no test modules,
dummy credentials, environment files or keyrings are included.

## Headless rendered UI evidence

GNOME Shell/Mutter **50.1**, software rendering, 1400×900 virtual monitor:

```sh
GSK_RENDERER=cairo PROBE=1 CCU_EVIDENCE_DIR=/tmp/opencode/go-ui \
  SHELL_ARGS='--headless --wayland --virtual-monitor 1400x900' \
  scripts/test-nested.sh
```

The optional test-only extension asserts actual Shell actors and captures PNGs;
it is not shipped in the ZIP. The run printed **GO UI PROBE PASSED**. It checked:

- Three Go quotas loaded using the disposable keyring and mock server.
- Two stacked rows; primary/weekly/Highest usage modes; monthly retained when
  Per-model windows is off; percentage/bar/both and used/remaining semantics.
- Panel icon off/on and official light/dark variants selected separately in
  panel and menu using controlled light/dark actor backgrounds.
- Cross-process save, replacement and removal picked up without extension
  reload; replacement removed prior values; disable/re-enable recovered.
- A genuinely locked disposable keyring produced Go-only unlock guidance;
  Codex and Claude remained successful. The real preferences window opened.

The implementation agent inspected the generated `go-dark.png`, `go-light.png`,
`go-locked.png` and `go-preferences.png` captures. The supplied square mark is
readable on both tested backgrounds. The dropdown visibly has 0.5%, 1%, 92%,
with unknown resets shown as “—”. Preferences visibly shows the empty API-key
field, Save key, Remove saved key, visibility switch and locked-storage guidance.

## Limits of this evidence

No human click-through was performed. Save/remove operations in the rendered
Shell test use the production settings/storage helper from a separate GJS
process, not clicks in the GTK window. Masking and entry clearing are implemented
by the preferences code but were not manually exercised with typed input here.
Controlled backgrounds verify mark contrast, not every third-party Shell theme.
Other GNOME versions and interactive unlock prompts were not tested.

The first timeout-driven Shell shutdown exposed the pre-existing countdown
callback touching disposed labels. It is outside this feature; the successful
probe explicitly disables the extension before terminating Shell and shows no
extension JS errors. The default interactive harness still permits normal
close-window shutdown. GDM, camera, GPU and portal warnings in the headless
environment are not a claim of full desktop-session validation.
