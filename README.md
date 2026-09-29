# Codex & Claude Usage — GNOME Shell extension

A top-bar indicator for **GNOME Shell 46 to 51** that shows how much of your
**Codex (ChatGPT)** and **Claude Code** plan quota you have used, with the
5-hour and weekly windows, reset times, plan and account for each provider.

It merges the ideas of two single-provider extensions into one:

- [bmikuska46/codex-usage-gnome](https://github.com/bmikuska46/codex-usage-gnome) (Codex, GNOME 50, Python D-Bus backend)
- [Ayce45/claude-usage-extension](https://github.com/Ayce45/claude-usage-extension), itself a backport of
  [Haletran/claude-usage-extension](https://github.com/Haletran/claude-usage-extension) (Claude, GNOME 43/44)

Unlike the Codex original there is **no Python service, no systemd unit and no
D-Bus daemon**: the extension is pure GJS and reads the OAuth tokens that the
`codex` and `claude` command-line tools already store on disk.

## Features

- One panel button with a segment per provider: icon, percentage and/or a
  small progress bar. Either provider can be hidden.
- Dropdown with a section per provider: 5-hour and weekly bars coloured by
  severity, "Resets in …" with a live countdown during the last five minutes,
  plan type, account e-mail, limit-reached warning.
- Per-model quotas: scoped limits the Claude API reports, such as the weekly
  Fable limit on Max plans, are listed under the two standard windows. Can be
  switched off in the settings.
- Per-provider error states (not logged in, login expired, network error) so
  one broken provider never hides the other.
- Choose whether percentages mean **used** quota (Claude style) or
  **remaining** quota (Codex style), and which window the panel number follows.
- Picks up a new login immediately by watching the credential files.
- Optional HTTP proxy, configurable refresh interval.
- Codex access tokens that expired are refreshed **in memory only**; the CLI's
  `auth.json` is never modified. If the refresh fails you are asked to run
  `codex login`.

## Requirements

- GNOME Shell 46, 47, 48, 49, 50 or 51 (Wayland or X11).
- For Codex: the [Codex CLI](https://github.com/openai/codex) logged in with a
  ChatGPT account (`codex login`). Tokens are read from `$CODEX_HOME/auth.json`,
  `~/.codex/auth.json` or `~/.config/codex/auth.json`. API-key logins have no
  plan quota and are ignored.
- For Claude: [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  logged in with a Claude subscription. Tokens are read from
  `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json`.

You need at least one of the two; the other provider can be switched off in
the settings.

## Install

### Debian package (Ubuntu 24.04 / GNOME 46, Ubuntu 26.04 / GNOME 50)

Every [release](https://github.com/Gitii/gnome-codex-claude-usage/releases)
ships one `.deb` per supported Ubuntu, built and tested on that Ubuntu by the
`Package` workflow. Pick the file matching your release
(`…~ubuntu24.04_all.deb` or `…~ubuntu26.04_all.deb`) and install it:

```sh
sudo apt install ./gnome-shell-extension-codex-claude-usage_*_all.deb
```

The package installs the extension system-wide under
`/usr/share/gnome-shell/extensions/` and its schema under
`/usr/share/glib-2.0/schemas/`. Log out and back in, then enable it:

```sh
gnome-extensions enable codex-claude-usage@gitii.github.io
```

The package has no compiled code, so either file works on any GNOME 46 to 51
system with `gnome-shell` and `gir1.2-soup-3.0` installed. Remove it with
`sudo apt remove gnome-shell-extension-codex-claude-usage`.

### From source

```sh
git clone https://github.com/Gitii/gnome-codex-claude-usage.git
cd gnome-codex-claude-usage
make install
```

Then log out and back in (required on Wayland) and enable it:

```sh
gnome-extensions enable codex-claude-usage@gitii.github.io
```

`make zip` builds `build/codex-claude-usage@gitii.github.io.shell-extension.zip`,
which can be installed with `gnome-extensions install --force <zip>` or
uploaded to extensions.gnome.org.

### Uninstall

```sh
make uninstall
```

## Settings

Open them from the dropdown ("Settings…") or with
`gnome-extensions prefs codex-claude-usage@gitii.github.io`.

| Setting | Values | Default |
| --- | --- | --- |
| Codex / Claude Code | on/off per provider | both on |
| Display mode | percentage, progress bar, both | percentage |
| Percentages show | used, remaining | used |
| Panel value | 5-hour window, weekly window, whichever is more used | 5-hour |
| Show icons | on/off | on |
| Per-model windows | on/off | on |
| Refresh interval | 30 to 3600 s | 180 s |
| Proxy URL | e.g. `http://localhost:3128` | system default |

## Migrating from the original extensions

- **codex-usage-gnome**: the Python backend is no longer needed. Remove it
  with the upstream uninstall steps (`systemctl --user disable --now
  codex-usage.service`, remove the D-Bus service file, `pip uninstall
  codex-usage`). If you logged in through `codex-usage-login` rather than the
  Codex CLI, run `codex login` once; this extension reads the CLI's tokens.
- **claude-usage-extension**: nothing to migrate. Disable the old extension to
  avoid two indicators.

## Development

```sh
make check           # syntax, schema, metadata and node unit tests
make lint            # eslint (needs node/npx)
make test-providers  # provider modules under gjs against the mock API
make test-nested     # nested GNOME Shell against the mock API (see below)
```

`make test-providers` needs `gjs` and the Soup 3 introspection data
(`gjs gir1.2-soup-3.0` on Ubuntu, `gjs libsoup3` on Fedora). It runs the real
credential, HTTP and token-refresh code for every scenario without a GNOME
Shell, and is what CI runs.

### Testing without real accounts

`scripts/mock-api.py` serves fake Codex and Claude endpoints and writes fake
credential files. `scripts/test-nested.sh` starts it, points the extension at
it through the hidden `*-url` settings keys, and launches
`gnome-shell --nested --wayland` with the extension enabled. Scenarios:

```sh
scripts/test-nested.sh                        # normal usage
SCENARIO=codex-expired scripts/test-nested.sh # stale Codex token -> in-memory refresh
SCENARIO=claude-expired scripts/test-nested.sh
SCENARIO=limit scripts/test-nested.sh         # limit reached
REAL=1 scripts/test-nested.sh                 # your real credentials
```

### Testing other GNOME versions

Run the same script inside a Fedora `toolbox` of the release that ships the
GNOME version you want; toolbox shares your Wayland socket, so the nested
shell opens as a window on your desktop:

| GNOME | Fedora |
| --- | --- |
| 46 | 40 |
| 47 | 41 |
| 48 | 42 |
| 49 | 43 |
| 50 | 44 |
| 51 | 45 |

```sh
toolbox create -d fedora -r 42 gnome48
toolbox enter gnome48
sudo dnf install -y gnome-shell gnome-extensions-app python3 make glib2
make test-nested
```

### Releasing

Bump `version` and `version-name` in `metadata.json` and the top entry of
`debian/changelog`, then push a tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The `Package` workflow builds the `.deb` files in Ubuntu 24.04 and 26.04
containers, runs the unit and provider tests in each, and attaches the
packages to a GitHub release for the tag.

Alternatively run the `Package` workflow manually (Actions, "Run
workflow") on `main` with `release_tag` set to the new tag, e.g. `v1.1.2`.
The release job then creates the tag and the release itself. The tag must
match the version at the top of `debian/changelog`. Builds on ordinary pushes upload
the same `.deb` files as workflow artifacts with a `+git<date>.<sha>`
version. A local build needs `dpkg-dev` and `debhelper`:

```sh
dpkg-buildpackage -us -uc -b   # writes ../gnome-shell-extension-codex-claude-usage_*.deb
```

### Compatibility notes

- ESM extension modules (GNOME 45+ style) throughout.
- `St.BoxLayout.vertical` was deprecated in 48 and removed in 51;
  `lib/compat.js` picks `orientation` when available.
- `disable()` is synchronous, as required since 51; in-flight requests are
  invalidated with a generation counter.
- All timers, file monitors and the Soup session are torn down on disable.

## Privacy and security

- Tokens are read from the CLIs' files and sent only to the respective
  provider's API (`chatgpt.com` / `auth.openai.com` and `api.anthropic.com`).
- Nothing is written to disk by the extension except its own GSettings.
- Both APIs are undocumented and may change without notice.

## License

GPL-3.0-or-later. The Claude and Codex brand marks in `icons/` are the
monochrome icons from [thesvg.org](https://github.com/glincker/thesvg) (MIT);
the trademarks belong to Anthropic and OpenAI respectively. Not affiliated with, funded by or endorsed by OpenAI or Anthropic.
