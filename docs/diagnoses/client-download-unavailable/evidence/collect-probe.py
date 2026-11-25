"""Reproduce the missing download channel against a running account server.

Run with the webserver listening on 127.0.0.1:8787:

    python docs/diagnoses/client-download-unavailable/evidence/collect-probe.py

Writes `route-probe.txt` (status codes) and `landing-download-section.html`
(the rendered download block) next to this file. Read-only: no writes to the
database, no configuration changes.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8787"
HERE = Path(__file__).resolve().parent

# The routes a user reaches from the landing page and from the desktop
# "client too old" blocker, plus the two references a release channel needs.
ROUTES = [
    "/",
    "/#download",
    "/download",
    "/download/windows",
    "/api/v1/meta",
    "/api/v1/downloads",
    "/api/v1/releases",
    "/api/v1/admin/releases",
    "/register",
    "/login",
]


def fetch(url: str) -> tuple[int, str]:
    """Return (status, body) — 4xx/5xx are data here, not exceptions."""
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def main() -> None:
    lines = []
    for route in ROUTES:
        status, body = fetch(BASE + route)
        marker = ""
        if status == 404:
            marker = "  <- not found"
        lines.append(f"{status:>3}  GET {route}{marker}")
        if route == "/":
            section = re.search(
                r'<section id="download".*?</section>', body, re.S
            )
            if section:
                (HERE / "landing-download-section.html").write_text(
                    section.group(0), encoding="utf-8"
                )
    status, body = fetch(BASE + "/api/v1/meta")
    lines.append("")
    lines.append(f"{status:>3}  GET /api/v1/meta payload:")
    lines.append(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
    (HERE / "route-probe.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
