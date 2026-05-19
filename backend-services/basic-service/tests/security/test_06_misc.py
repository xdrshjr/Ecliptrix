"""
Tests for spec 06 — misc high-risk checks + report finalize.

Covers:
  V06-A — static-scan invariants: no `pickle.loads`, no `yaml.load(` without
          safe_load, no `eval(` / `exec(` in ``app/``. These are subprocess
          (ripgrep / fallback `os.walk`) assertions so the suite fails loudly
          if a future commit reintroduces an unsafe deserialisation primitive.

  V06-C — FastAPI must NOT expose ``/docs``, ``/redoc`` or ``/openapi.json``
          in production. Dev/staging keeps them on for the local workflow.

Strategy
--------
For V06-C we mirror the post-patch ``app/main.py`` flag computation in this
test file rather than importing ``app.main`` (importing main pulls cv2 /
ffmpeg / heavyweight routers, which is expensive for a unit test and
unrelated to the behaviour under test). The flag computation is one line, so
keeping a mirror here is cheap; the actual production wiring is verified by
reading the source string and asserting the exact pattern is present.

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
# V06-C — openapi disabled in production
# ---------------------------------------------------------------------------


def _build_app(env_marker: str) -> FastAPI:
    """Build a FastAPI instance using the exact same flag rule as ``app/main.py``.

    Kept in lock-step with the patch in ``app/main.py`` (see comment with
    ``spec/06 V06-C`` marker). If main.py's rule diverges the source-pattern
    assertion below will fail loudly first.
    """
    is_dev = (env_marker or "production").lower() in ("development", "dev")
    return FastAPI(
        title="test",
        version="test",
        docs_url="/docs" if is_dev else None,
        redoc_url="/redoc" if is_dev else None,
        openapi_url="/openapi.json" if is_dev else None,
    )


def test_V06C_prod_disables_docs() -> None:
    app = _build_app("production")
    client = TestClient(app)

    resp = client.get("/docs")
    assert resp.status_code == 404, "Expected /docs to return 404 in production"

    resp = client.get("/redoc")
    assert resp.status_code == 404, "Expected /redoc to return 404 in production"

    resp = client.get("/openapi.json")
    assert (
        resp.status_code == 404
    ), "Expected /openapi.json to return 404 in production"


def test_V06C_dev_enables_docs() -> None:
    app = _build_app("development")
    client = TestClient(app)

    resp = client.get("/docs")
    assert resp.status_code == 200, "Expected /docs to render in development"
    assert (
        "swagger" in resp.text.lower() or "openapi" in resp.text.lower()
    ), "Expected the dev /docs response to contain Swagger UI markup"

    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert "openapi" in body and "paths" in body


def test_V06C_dev_alias_marker() -> None:
    # The shorthand "dev" alias should be treated identically to "development".
    app = _build_app("dev")
    client = TestClient(app)
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_V06C_main_py_uses_env_gated_docs_kwargs() -> None:
    """Lock the source pattern: main.py must construct FastAPI with env-gated
    ``docs_url`` / ``redoc_url`` / ``openapi_url`` kwargs.

    This guards against a future refactor accidentally re-enabling docs in
    production by dropping the kwargs.
    """
    main_src = (BACKEND_APP_DIR / "main.py").read_text(encoding="utf-8")
    assert (
        "docs_url=\"/docs\" if _is_dev_env else None" in main_src
    ), "main.py must gate docs_url on _is_dev_env"
    assert (
        "redoc_url=\"/redoc\" if _is_dev_env else None" in main_src
    ), "main.py must gate redoc_url on _is_dev_env"
    assert (
        "openapi_url=\"/openapi.json\" if _is_dev_env else None" in main_src
    ), "main.py must gate openapi_url on _is_dev_env"


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
