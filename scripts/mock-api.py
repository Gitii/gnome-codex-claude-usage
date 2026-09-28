#!/usr/bin/env python3
"""Mock of the Codex and Claude usage endpoints for testing the extension.

Usage:
    scripts/mock-api.py [--port 8765] [--scenario normal|codex-expired|claude-expired|limit]

Endpoints served:
    GET  /backend-api/wham/usage   (Codex usage)
    POST /oauth/token              (Codex token refresh)
    GET  /api/oauth/usage          (Claude usage)

The script also writes fake credential files into $MOCK_HOME (default: a temp
directory printed on start-up) laid out like the real CLIs do:
    $MOCK_HOME/codex/auth.json
    $MOCK_HOME/claude/.credentials.json
Point CODEX_HOME and CLAUDE_CONFIG_DIR at those directories.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STALE_TOKEN = "codex-access-stale"
FRESH_TOKEN = "codex-access-fresh"
CLAUDE_TOKEN = "claude-access-token"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def fake_jwt(claims: dict) -> str:
    header = b64url(json.dumps({"alg": "none"}).encode())
    payload = b64url(json.dumps(claims).encode())
    return f"{header}.{payload}."


def write_credentials(home: str, scenario: str) -> None:
    codex_dir = os.path.join(home, "codex")
    claude_dir = os.path.join(home, "claude")
    os.makedirs(codex_dir, exist_ok=True)
    os.makedirs(claude_dir, exist_ok=True)

    codex_access = STALE_TOKEN if scenario == "codex-expired" else FRESH_TOKEN
    with open(os.path.join(codex_dir, "auth.json"), "w") as fh:
        json.dump({
            "OPENAI_API_KEY": None,
            "tokens": {
                "id_token": fake_jwt({"email": "tester@example.com"}),
                "access_token": codex_access,
                "refresh_token": "codex-refresh",
                "account_id": "acct_mock",
            },
            "last_refresh": "2026-01-01T00:00:00Z",
        }, fh, indent=2)

    expires = int(time.time() * 1000) + (-1 if scenario == "claude-expired" else 3600) * 1000
    with open(os.path.join(claude_dir, ".credentials.json"), "w") as fh:
        json.dump({
            "claudeAiOauth": {
                "accessToken": CLAUDE_TOKEN,
                "refreshToken": "claude-refresh",
                "expiresAt": expires,
                "scopes": ["user:inference", "user:profile"],
                "subscriptionType": "max",
            }
        }, fh, indent=2)


class Handler(BaseHTTPRequestHandler):
    scenario = "normal"

    def log_message(self, fmt, *args):  # noqa: N802
        print(f"[mock] {self.command} {self.path} -> {fmt % args}")

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _bearer(self) -> str:
        auth = self.headers.get("Authorization", "")
        return auth.removeprefix("Bearer ").strip()

    def do_GET(self):  # noqa: N802
        now = int(time.time())
        limit = self.scenario == "limit"
        if self.path.startswith("/backend-api/wham/usage"):
            if self._bearer() != FRESH_TOKEN:
                return self._json(401, {"detail": "Unauthorized"})
            primary_used = 100 if limit else 37
            return self._json(200, {
                "plan_type": "plus",
                "email": "tester@example.com",
                "rate_limit": {
                    "allowed": not limit,
                    "limit_reached": limit,
                    "primary_window": {
                        "used_percent": primary_used,
                        "limit_window_seconds": 18000,
                        "reset_after_seconds": 200,
                        "reset_at": now + 200,
                    },
                    "secondary_window": {
                        "used_percent": 62,
                        "limit_window_seconds": 604800,
                        "reset_after_seconds": 3 * 86400 + 4 * 3600,
                        "reset_at": now + 3 * 86400 + 4 * 3600,
                    },
                },
            })
        if self.path.startswith("/api/oauth/usage"):
            if self._bearer() != CLAUDE_TOKEN:
                return self._json(401, {"error": "unauthorized"})
            fmt = "%Y-%m-%dT%H:%M:%S+00:00"
            iso = lambda secs: time.strftime(fmt, time.gmtime(now + secs))  # noqa: E731
            five_hour = 100.0 if limit else 81.5
            # Shape mirrors a real 2026 response: the `limits` array is the
            # source of truth; the top-level keys next to five_hour/seven_day
            # are internal code names and must not be shown.
            return self._json(200, {
                "five_hour": {"utilization": five_hour, "resets_at": iso(2 * 3600 + 15 * 60),
                              "limit_dollars": None, "used_dollars": None, "locked_reason": None},
                "seven_day": {"utilization": 23.0, "resets_at": iso(5 * 86400),
                              "limit_dollars": None, "used_dollars": None, "locked_reason": None},
                "seven_day_opus": None,
                "seven_day_sonnet": None,
                "iguana_necktie": {"utilization": 68.256, "resets_at": iso(37 * 86400),
                                   "limit_dollars": 250, "used_dollars": 170.64, "locked_reason": None},
                "nimbus_quill": {"utilization": 0.0, "resets_at": None,
                                 "limit_dollars": None, "used_dollars": None, "locked_reason": None},
                "cinder_cove": None,
                "extra_usage": {"is_enabled": False, "monthly_limit": 0, "utilization": None},
                "limits": [
                    {"kind": "session", "group": "session", "percent": round(five_hour),
                     "severity": "normal", "resets_at": iso(2 * 3600 + 15 * 60), "scope": None, "is_active": False},
                    {"kind": "weekly_all", "group": "weekly", "percent": 23,
                     "severity": "normal", "resets_at": iso(5 * 86400), "scope": None, "is_active": False},
                    {"kind": "weekly_scoped", "group": "weekly", "percent": 64,
                     "severity": "normal", "resets_at": iso(5 * 86400),
                     "scope": {"model": {"id": None, "display_name": "Fable"}, "surface": None},
                     "is_active": True},
                ],
            })
        return self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path.startswith("/oauth/token"):
            if body.get("refresh_token") != "codex-refresh":
                return self._json(400, {"error": "invalid_grant"})
            return self._json(200, {
                "access_token": FRESH_TOKEN,
                "refresh_token": "codex-refresh-2",
                "id_token": fake_jwt({"email": "tester@example.com"}),
            })
        return self._json(404, {"error": "not found"})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--scenario", default="normal",
                        choices=["normal", "codex-expired", "claude-expired", "limit"])
    args = parser.parse_args()

    home = os.environ.get("MOCK_HOME") or tempfile.mkdtemp(prefix="ccu-mock-")
    write_credentials(home, args.scenario)
    Handler.scenario = args.scenario

    print(f"[mock] credentials in {home}")
    print(f"[mock] export CODEX_HOME={home}/codex CLAUDE_CONFIG_DIR={home}/claude")
    print(f"[mock] listening on http://127.0.0.1:{args.port}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
