"""
Tests for spec 06 — misc high-risk checks + report finalize.

Covers:
  V06-A — static-scan invariants: no `pickle.loads`, no `yaml.load(` without
          safe_load, no `eval(` / `exec(` in ``app/``. These are subprocess
          (ripgrep / fallback `os.walk`) assertions so the suite fails loudly
          if a future commit reintroduces an unsafe deserialisation primitive.

  V06-C — FastAPI exposes ``/docs``, ``/redoc`` and ``/openapi.json``
          unconditionally. `desktop-only-refactor` (D7) made them always-on:
          the process binds to 127.0.0.1 and is reached only by the Electron
          renderer on the same machine, so they are a local debugging asset,
          not a public surface. These tests pin that they stay reachable.

Strategy
--------
For V06-C we build a bare FastAPI with default kwargs rather than importing
``app.main`` (importing main pulls cv2 / ffmpeg / heavyweight routers, which
is expensive for a unit test and unrelated to the behaviour under test).

For V06-A we shell out to ripgrep when available (matches the developer
workflow); when ripgrep is missing we fall back to a pure-Python walk that
implements the same matcher.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


BASIC_SERVICE_DIR = Path(__file__).resolve().parents[2]
BACKEND_APP_DIR = BASIC_SERVICE_DIR / "app"


# ---------------------------------------------------------------------------
# V06-C — interactive docs are always available
# ---------------------------------------------------------------------------


def _build_app() -> FastAPI:
    """Build a FastAPI with the same (default) docs kwargs ``app/main.py`` uses."""
    return FastAPI(title="test", version="test")


def test_V06C_docs_ui_is_served() -> None:
    client = TestClient(_build_app())

    resp = client.get("/docs")
    assert resp.status_code == 200, "Expected /docs to render"
    assert (
        "swagger" in resp.text.lower() or "openapi" in resp.text.lower()
    ), "Expected the /docs response to contain Swagger UI markup"


def test_V06C_redoc_ui_is_served() -> None:
    client = TestClient(_build_app())
    assert client.get("/redoc").status_code == 200


def test_V06C_openapi_json_is_served() -> None:
    client = TestClient(_build_app())

    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert "openapi" in body and "paths" in body


def test_V06C_main_py_does_not_gate_docs() -> None:
    """Lock the source: main.py must NOT reintroduce an env gate on the docs.

    The old build disabled the docs whenever ``ENV`` was not development. That
    switch is gone along with the deployment-environment marker; a refactor
    that brings back a ``docs_url=... if ... else None`` kwarg would silently
    break local debugging, so fail loudly here instead.
    """
    main_src = (BACKEND_APP_DIR / "main.py").read_text(encoding="utf-8")
    for kwarg in ("docs_url=", "redoc_url=", "openapi_url="):
        assert kwarg not in main_src, (
            f"main.py must not pass {kwarg} — the docs are unconditionally on"
        )


# ---------------------------------------------------------------------------
# V06-A — static-scan: no unsafe deserialisation in ``app/``
# ---------------------------------------------------------------------------


_UNSAFE_PATTERNS = {
    # `yaml.load(...)` without an explicit SafeLoader is the classic RCE
    # vector. We allow `yaml.safe_load` and any `yaml.load(..., Loader=Safe*)`.
    "yaml_load": re.compile(r"\byaml\.load\s*\("),
    "yaml_load_allowed": re.compile(r"\byaml\.safe_load\s*\(|Loader\s*=\s*Safe"),
    "pickle": re.compile(r"\bpickle\.loads?\s*\("),
    "eval": re.compile(r"(?<![A-Za-z0-9_])eval\s*\("),
    "exec": re.compile(r"(?<![A-Za-z0-9_])exec\s*\("),
}


def _python_files_under_app() -> list[Path]:
    """Walk ``app/`` and return every ``*.py`` (excluding caches)."""
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(BACKEND_APP_DIR):
        # Skip caches / build artifacts.
        dirnames[:] = [d for d in dirnames if d not in {"__pycache__", ".pytest_cache"}]
        for name in filenames:
            if name.endswith(".py"):
                out.append(Path(dirpath) / name)
    return out


def _scan_for_pattern(name: str) -> list[tuple[Path, int, str]]:
    """Return ``(file, lineno, line)`` triples matching pattern ``name``.

    The ``yaml_load`` pattern is special-cased: if a line also matches the
    allowed pattern it is dropped (covers ``yaml.safe_load`` and explicit
    ``Loader=SafeLoader`` invocations).
    """
    pat = _UNSAFE_PATTERNS[name]
    allowed = _UNSAFE_PATTERNS.get("yaml_load_allowed") if name == "yaml_load" else None
    matches: list[tuple[Path, int, str]] = []
    for path in _python_files_under_app():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            stripped = line.lstrip()
            # Skip pure comments — defenders may legitimately mention these
            # primitives in a comment / docstring.
            if stripped.startswith("#"):
                continue
            if not pat.search(line):
                continue
            if allowed is not None and allowed.search(line):
                continue
            matches.append((path, lineno, line.rstrip()))
    return matches


def test_V06A_no_pickle_loads() -> None:
    hits = _scan_for_pattern("pickle")
    assert not hits, (
        "Unsafe pickle.load(s) usage detected in app/. "
        "Pickle is RCE-by-design; replace with json/structured deserialisation. "
        "Hits:\n"
        + "\n".join(f"  {p}:{ln}: {ls}" for (p, ln, ls) in hits)
    )


def test_V06A_no_unsafe_yaml_load() -> None:
    hits = _scan_for_pattern("yaml_load")
    assert not hits, (
        "Unsafe yaml.load(...) call detected in app/ (no SafeLoader / safe_load). "
        "Replace with yaml.safe_load(...). Hits:\n"
        + "\n".join(f"  {p}:{ln}: {ls}" for (p, ln, ls) in hits)
    )


def test_V06A_no_eval() -> None:
    hits = _scan_for_pattern("eval")
    assert not hits, (
        "eval(...) detected in app/ — use ast.literal_eval for literal-only "
        "evaluation. Hits:\n"
        + "\n".join(f"  {p}:{ln}: {ls}" for (p, ln, ls) in hits)
    )


def test_V06A_no_exec() -> None:
    hits = _scan_for_pattern("exec")
    assert not hits, (
        "exec(...) detected in app/. Hits:\n"
        + "\n".join(f"  {p}:{ln}: {ls}" for (p, ln, ls) in hits)
    )


def test_V06A_grep_subprocess_matches_python_walk() -> None:
    """If ripgrep is available, confirm it returns the same verdict as the
    Python walk (defense in depth — guards against the in-Python scan having
    a subtle bug that hides a real hit).
    """
    rg = shutil.which("rg")
    if rg is None:
        pytest.skip("ripgrep not available in this environment")

    # We use the same pattern as the in-Python scan; if rg finds something we
    # didn't, fail loud.
    try:
        result = subprocess.run(
            [
                rg,
                "-n",
                r"\bpickle\.loads?\s*\(|\byaml\.load\s*\(|(?<![A-Za-z0-9_])eval\s*\(|(?<![A-Za-z0-9_])exec\s*\(",
                str(BACKEND_APP_DIR),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pytest.skip("ripgrep invocation failed")
        return

    # rg exit 1 == "no matches" which is the success state for us.
    if result.returncode == 1:
        return

    # Filter the rg output the same way our Python scanner does (drop comments,
    # drop allowed yaml.safe_load lines).
    suspicious: list[str] = []
    for line in result.stdout.splitlines():
        # rg format on Windows can be "PATH:LINENO:CONTENT".
        parts = line.split(":", 2)
        if len(parts) < 3:
            continue
        content = parts[2]
        if content.lstrip().startswith("#"):
            continue
        if _UNSAFE_PATTERNS["yaml_load"].search(content) and _UNSAFE_PATTERNS[
            "yaml_load_allowed"
        ].search(content):
            continue
        suspicious.append(line)

    assert not suspicious, (
        "ripgrep found unsafe deserialisation primitives in app/:\n"
        + "\n".join("  " + s for s in suspicious)
    )
