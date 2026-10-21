# Store user-configured Go keys in Secret Service

## Status

accepted 2026-10-21

## Context

The extension currently reads Codex and Claude credentials maintained by their CLIs and does not own credential storage. OpenCode V2 instead stores saved accounts in SQLite. Automatically reusing those accounts would couple this extension to OpenCode's database layout and account selection. The operator wants to enter a Go API key in extension preferences and save it safely.

## Decision

Own one explicitly configured OpenCode Go API key and persist it only in the desktop's Secret Service/keyring. Do not discover credentials from OpenCode databases, legacy files, environment variables, or browser sessions. Do not put the key in GSettings, logs, fixtures, or plaintext fallback storage.

Preferences provide masked entry, secure save/replacement, removal, and a saved/not-saved status. They do not populate the field with a stored key. Saving successfully clears the field and enables Go; removing successfully disables Go. Go defaults hidden. Failures preserve the previously saved configuration and provide actionable guidance rather than pretending a change succeeded.

## Consequences

Users can configure monitoring without installing or running OpenCode, and CLI account changes cannot silently change the monitored account. Users must manage this monitoring key separately. Secure storage availability and unlock behavior become part of setup and testing. Missing or unavailable secure storage must not prevent Codex and Claude from running. The extension remains pure GJS without an extension-owned daemon.
