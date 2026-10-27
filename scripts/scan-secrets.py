#!/usr/bin/env python3
"""Scan this repository for credential literals.

Two modes:

    python scripts/scan-secrets.py            # tracked files (fast, pre-commit)
    python scripts/scan-secrets.py --history  # every blob in the git database

Exit code 0 = clean, 1 = findings. Matches are printed masked, so the scanner
itself never writes a usable credential to a terminal log or CI transcript.

Why it exists: the repository was public with live keys in it until
2026-10-27 (see docs/security/secret-rotation-2026-10-27.md). This gate keeps
that from happening again.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Only shapes that a *live* credential has: long enough that prose, examples
# and synthetic fixtures ("sk-test", "AKIAIOSFODNN7EXAMPLE") do not match.
PATTERNS: dict[str, re.Pattern[str]] = {
    "llm-key": re.compile(r"\bsk-[A-Za-z0-9]{32,}\b"),
    "llm-key-proj": re.compile(r"\bsk-proj-[A-Za-z0-9_-]{32,}\b"),
    "kimi-key": re.compile(r"\bsk-kimi-[A-Za-z0-9]{30,}"),
    "tavily-key": re.compile(r"\btvly-[A-Za-z0-9]{30,}"),
    "aliyun-ak": re.compile(r"\bLTAI[0-9A-Za-z]{16,}\b"),
    "aws-ak": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "github-token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{30,}"),
    "google-key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "slack-token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{20,}"),
    "private-key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "signed-jwt": re.compile(
        r"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}"
    ),
}

# Paths that legitimately hold synthetic, credential-shaped strings.
ALLOWED_PATHS = (
    "backend-services/basic-service/tests/security/test_05_secrets.py",
    "scripts/scan-secrets.py",
    "docs/security/",
)
SKIP_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mp3", ".wav", ".webm",
    ".ico", ".pdf", ".zip", ".tgz", ".bundle", ".pack", ".woff", ".woff2",
    ".ttf", ".otf", ".db", ".sqlite", ".pyc",
)
SKIP_NAMES = ("package-lock.json", "tsconfig.tsbuildinfo")
MAX_BYTES = 2 * 1024 * 1024
# Canonical example values from vendor documentation, reused in unit tests.
KNOWN_PLACEHOLDERS = ("IOSFODNN7EXAMPLE", "EXAMPLE", "XAMPLE", "xxxxxxxx", "00000000")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace", check=False,
    ).stdout


def mask(value: str) -> str:
    """Keep just enough to locate the finding, never enough to use it."""
    return f"{value[:4]}...{value[-2:]}(len={len(value)})"


def report(where: str, text: str) -> int:
    hits = 0
    for name, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            value = match.group(0)
            if any(marker in value for marker in KNOWN_PLACEHOLDERS):
                continue
            line = text.count("\n", 0, match.start()) + 1
            print(f"  ! {where}:{line} [{name}] {mask(value)}")
            hits += 1
    return hits


def scan_tracked() -> int:
    tracked = [p for p in git("ls-files").splitlines() if p]
    print(f"[scan] tracked files: {len(tracked)}")
    findings = 0
    for name in tracked:
        if name.startswith(ALLOWED_PATHS) or name.endswith(SKIP_SUFFIXES):
            continue
        if Path(name).name in SKIP_NAMES:
            continue
        path = REPO_ROOT / name
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            continue
        try:
            body = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        findings += report(name, body)
    return findings


def scan_history() -> int:
    raw = subprocess.run(
        ["git", "cat-file", "--batch-all-objects", "--batch"],
        cwd=REPO_ROOT, capture_output=True, check=False,
    ).stdout
    print(f"[scan] object stream: {len(raw) / 1e6:.0f} MB")
    findings = 0
    pos = 0
    while pos < len(raw):
        newline = raw.find(b"\n", pos)
        if newline < 0:
            break
        parts = raw[pos:newline].decode("ascii", "replace").split()
        if len(parts) < 3:
            pos = newline + 1
            continue
        sha, kind, size = parts[0], parts[1], int(parts[2])
        start, end = newline + 1, newline + 1 + size
        if kind == "blob" and size <= MAX_BYTES:
            findings += report(f"blob {sha[:10]}", raw[start:end].decode("utf-8", "replace"))
        pos = end + 1
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true",
                        help="scan every blob in the git object database")
    args = parser.parse_args()
    findings = scan_history() if args.history else scan_tracked()
    if findings:
        print(f"\n[scan] FAIL: {findings} credential-shaped match(es) found")
        return 1
    print("\n[scan] OK: no credential-shaped literal found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
