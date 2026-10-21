# Access Secret Service through libsecret

Status: accepted 2026-10-21

## The Problem

Read, replace, and remove the extension-owned Go key without blocking GNOME Shell or implementing a secret-storage protocol.

## Options Considered

- **Use libsecret through GObject introspection.**
- Implement Secret Service D-Bus interactions directly with Gio.
- Invoke an external secret-storage command.

## Rationale

libsecret supplies an established Secret Service client that fits GJS and avoids a custom security-sensitive D-Bus implementation or subprocess command dependency. It is not currently a project dependency, so packaging and setup instructions must add its introspection bindings.

## Notes

Implements [the secure Go key architecture](../adr/0001-store-user-configured-go-keys-in-secret-service.md). Use asynchronous operations and load the binding so its absence affects Go only, not extension startup or existing providers. Unlock interaction belongs in explicit preferences actions; background polling must not repeatedly prompt to unlock. Refuse plaintext fallback. Keep test keys isolated from the user's real keyring.
