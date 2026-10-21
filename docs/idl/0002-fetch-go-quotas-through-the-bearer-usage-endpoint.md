# Fetch Go quotas through the bearer usage endpoint

Status: accepted 2026-10-21

## The Problem

Obtain authoritative Go subscription quota percentages and resets on Linux without browser extraction or device-local estimates.

## Options Considered

- **GET the bearer-authenticated Go usage endpoint used by CodexBar.**
- Import browser cookies and use Console subscription endpoints.
- Estimate usage from OpenCode's local history.
- Use Console budget accounting instead of subscription quotas.

## Rationale

The operator chose API-key-only access. A read-only authenticated request on 2026-10-21 returned HTTP 200 and rolling, weekly, and monthly quota data with ISO reset timestamps. Browser extraction adds session and workspace complexity. Local history is incomplete and estimated. Budget accounting excludes included Go usage and therefore cannot substitute for subscription quotas.

## Notes

Use `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>`, JSON acceptance, and the extension's own user agent through the shared HTTP client. Read `usage.rolling`, `usage.weekly`, and `usage.monthly`; `percent` is in percentage units, not a fraction. Normalize resets to the existing epoch-seconds model. Weekly/monthly are optional; unknown resets remain unknown. Malformed required quota data is an error, not zero usage.

As of the verification date, the endpoint is not documented in the official Console API reference. Minimum restricted-key permissions and non-subscriber responses were not verified. Do not claim that Usage Read is sufficient or infer subscription status from an unknown response. Distinguish rejected credentials from permission failures where responses allow it. No key refresh, browser fallback, local estimate, or budget substitution is provided.
