"""Reproduce the whole lock-out chain against a running account server (dev).

    426 client_outdated  ->  the only affordance is clientDownloadUrl()
                         ->  GET /download answers 404

The script reads the root-admin credentials from `webserver/.env` (never prints
them), raises `client.minVersion` above the shipped desktop build, performs a
desktop login, probes the URL the desktop blocker opens, and restores the
previous setting in a `finally` block so the dev database is left untouched.

    python docs/diagnoses/client-download-unavailable/evidence/repro-426-then-404.py

Writes `lockout-chain.txt` next to this file.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8787"
ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
ENV_FILE = ROOT / "webserver" / ".env"
MIN_VERSION = "9.9.9"
SHIPPED_BUILD = "1.0.1"  # desktop/package.json


def read_env(*keys: str) -> dict[str, str]:
    """Minimal .env reader: KEY=VALUE lines, no shell expansion, no printing."""
    wanted = set(keys)
    values: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        if name.strip() in wanted:
            values[name.strip()] = value.strip().strip('"').strip("'")
    missing = wanted - set(values)
    if missing:
        raise SystemExit(f"missing in {ENV_FILE}: {sorted(missing)}")
    return values


def call(method: str, path: str, body: dict | None = None,
         token: str | None = None) -> tuple[int, dict | str]:
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=payload, method=method)
    if payload is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw


def main() -> None:
    credentials = read_env("ROOT_ADMIN_EMAIL", "ROOT_ADMIN_PASSWORD")
    lines: list[str] = []
    # A desktop login is the only one that returns bearer tokens, and a bearer
    # request is CSRF-exempt — the shortest path to a settings PATCH.
    status, payload = call("POST", "/api/v1/auth/login", {
        "identifier": credentials["ROOT_ADMIN_EMAIL"],
        "password": credentials["ROOT_ADMIN_PASSWORD"],
        "client": "desktop",
        "clientVersion": SHIPPED_BUILD,
        "device": {"deviceKey": "diag-client-download-probe",
                   "platform": "win32", "appVersion": SHIPPED_BUILD},
    })
    lines.append(f"{status}  POST /api/v1/auth/login (desktop, root admin)")
    if status != 200:
        raise SystemExit(f"admin login failed: {json.dumps(payload)[:300]}")
    token = payload["data"]["accessToken"]

    _, current = call("GET", "/api/v1/admin/settings", token=token)
    previous = current["data"]["settings"]["client.minVersion"]
    lines.append(f"      previous client.minVersion = {previous!r}")
    try:
        status, patched = call("PATCH", "/api/v1/admin/settings",
                               {"client.minVersion": MIN_VERSION}, token)
        lines.append(f"{status}  PATCH /api/v1/admin/settings client.minVersion="
                     f"{MIN_VERSION}")

        status, refusal = call("POST", "/api/v1/auth/login", {
            "identifier": credentials["ROOT_ADMIN_EMAIL"],
            "password": credentials["ROOT_ADMIN_PASSWORD"],
            "client": "desktop",
            "clientVersion": SHIPPED_BUILD,
        })
        lines.append("")
        lines.append(f"{status}  POST /api/v1/auth/login "
                     f"(desktop {SHIPPED_BUILD}) -> the lock-out")
        lines.append(json.dumps(refusal, ensure_ascii=False, indent=2))

        status, body = call("GET", "/download")
        lines.append("")
        lines.append(f"{status}  GET /download  <- what AuthBlocker opens "
                     f"(clientDownloadUrl())")
        lines.append(str(body)[:300])
    finally:
        status, _ = call("PATCH", "/api/v1/admin/settings",
                         {"client.minVersion": previous}, token)
        lines.append("")
        lines.append(f"{status}  PATCH /api/v1/admin/settings restored to "
                     f"{previous!r}")
    (HERE / "lockout-chain.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
