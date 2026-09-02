"""Regression tests for spec 05: secrets-and-config-exposure.

Covers:
- V05-B: ``.gitignore`` blocks ``.env`` / ``.env.*`` re-introduction & no
  ``__pycache__`` / ``.env`` is tracked.
- V05-D: ``redact_headers`` / ``redact_body`` / ``redact_string`` from
  ``app.security.log_redact`` properly mask credentials.
- V05-E: ``env.template`` files contain no obvious real keys.

Static (subprocess) tests require ``git`` on PATH and a checkout that has a
``.git`` directory. If unavailable the test is xfail-skipped (e.g. running
from a tarball CI without git).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

from app.security.log_redact import (
    REDACTED,
    redact_body,
    redact_headers,
    redact_string,
)


REPO_ROOT = Path(__file__).resolve().parents[4]


# ---------------------------------------------------------------------------
# V05-D: redact_headers
# ---------------------------------------------------------------------------


class TestRedactHeaders:
    def test_authorization_header_is_redacted(self):
        out = redact_headers(
            {"Authorization": "Bearer eyJhbGc.xxx.yyy", "Content-Type": "application/json"}
        )
        assert out["Authorization"] == REDACTED
        assert out["Content-Type"] == "application/json"

    def test_case_insensitive_match(self):
        out = redact_headers({"authorization": "Bearer abc", "AUTHORIZATION": "Bearer def"})
        assert out["authorization"] == REDACTED
        assert out["AUTHORIZATION"] == REDACTED

    def test_cookie_and_session_token_redacted(self):
        out = redact_headers(
            {
                "Cookie": "session=abc; other=ok",
                "X-Session-Token": "sometoken",
                "X-Api-Key": "sk-real-key",
                "User-Agent": "pytest/0",
            }
        )
        assert out["Cookie"] == REDACTED
        assert out["X-Session-Token"] == REDACTED
        assert out["X-Api-Key"] == REDACTED
        assert out["User-Agent"] == "pytest/0"

    def test_accepts_iterable_of_tuples(self):
        # Starlette Headers behaves like a list-of-pairs in addition to .items().
        out = redact_headers([("Authorization", "Bearer x"), ("Accept", "*/*")])
        assert out["Authorization"] == REDACTED
        assert out["Accept"] == "*/*"

    def test_does_not_mutate_input(self):
        original = {"Authorization": "Bearer x", "Other": "y"}
        redact_headers(original)
        assert original["Authorization"] == "Bearer x"


# ---------------------------------------------------------------------------
# V05-D: redact_body
# ---------------------------------------------------------------------------


class TestRedactBody:
    def test_password_key_redacted(self):
        out = redact_body({"password": "abc", "user": "u"})
        assert out["password"] == REDACTED
        assert out["user"] == "u"

    def test_substring_match_redacts_session_token(self):
        out = redact_body({"active_session_token": "xyz", "name": "n"})
        assert out["active_session_token"] == REDACTED
        assert out["name"] == "n"

    def test_nested_dict_recursion(self):
        out = redact_body({"outer": {"api_key": "sk-secret"}, "k": "v"})
        assert out["outer"]["api_key"] == REDACTED
        assert out["k"] == "v"

    def test_list_recursion(self):
        out = redact_body([{"password": "p"}, {"safe": "s"}])
        assert out[0]["password"] == REDACTED
        assert out[1]["safe"] == "s"

    def test_string_pass_redacts_bearer(self):
        out = redact_body("Authorization: Bearer eyJhbGc.payload.sig")
        assert "Bearer" in out
        assert "eyJhbGc.payload.sig" not in out
        assert REDACTED in out

    def test_string_pass_redacts_sk_key(self):
        out = redact_string("token=***REMOVED*** ok")
        assert "***REMOVED***" not in out
        # Either the prefixed form or the api_key= form replaces it.
        assert REDACTED in out

    def test_primitives_pass_through(self):
        assert redact_body(42) == 42
        assert redact_body(None) is None
        assert redact_body(True) is True

    def test_json_like_string_redacts_key_value(self):
        payload = '{"api_key": "secret123", "model": "gpt"}'
        out = redact_string(payload)
        assert "secret123" not in out
        assert "gpt" in out

    def test_does_not_mutate_dict_input(self):
        original = {"password": "p"}
        redact_body(original)
        assert original["password"] == "p"


# ---------------------------------------------------------------------------
# V05-B: git tracking hygiene
# ---------------------------------------------------------------------------


def _git_ls_files() -> list[str] | None:
    """Run ``git ls-files`` from REPO_ROOT. Returns None if git unavailable."""

    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return [line for line in result.stdout.splitlines() if line]


class TestGitTracking:
    def test_no_env_files_tracked_except_templates(self):
        tracked = _git_ls_files()
        if tracked is None:
            pytest.skip("git not available or not a checkout")

        env_files = [
            f
            for f in tracked
            if re.search(r"(^|/)\.env($|\.)", f) or f.endswith(".env")
        ]

        # Templates are explicitly allowed.
        allowed_suffixes = ("env.template", ".env.example")
        offenders = [
            f for f in env_files if not any(f.endswith(s) for s in allowed_suffixes)
        ]
        assert offenders == [], (
            f"Found .env-like files tracked by git that contain (or are likely to "
            f"contain) credentials: {offenders}. Run `git rm --cached <file>` and "
            f"ensure .gitignore covers them."
        )

    def test_no_pycache_tracked(self):
        tracked = _git_ls_files()
        if tracked is None:
            pytest.skip("git not available or not a checkout")

        offenders = [f for f in tracked if "__pycache__" in f or f.endswith(".pyc")]
        assert offenders == [], f"__pycache__ / .pyc files tracked: {offenders[:5]}..."


# ---------------------------------------------------------------------------
# V05-E: env.template normalization
# ---------------------------------------------------------------------------


_TEMPLATE_PATHS = [
    REPO_ROOT / "env.template",
    REPO_ROOT / "backend-services" / "basic-service" / "env.template",
    # .env.example is allow-listed by test_no_env_files_tracked_except_templates,
    # which means it ships with the repo as a template. So it must also be
    # placeholder-only — orchestrator fix 2026-05-20 caught a stale
    # `LLM_API_KEY=sk-...` here that dev-05 missed.
    REPO_ROOT / ".env.example",
]


_OBVIOUS_REAL_KEY_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),  # OpenAI-style real keys
    re.compile(r"tvly-[A-Za-z0-9_-]{16,}"),  # Tavily real keys
    re.compile(r"[A-Za-z0-9]{32,}\.[A-Za-z0-9]{8,}"),  # zhipu-style "id.secret"
    re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),  # JWTs
]


@pytest.mark.parametrize("template_path", _TEMPLATE_PATHS)
def test_env_template_has_no_real_keys(template_path: Path):
    if not template_path.exists():
        pytest.skip(f"{template_path} missing")
    content = template_path.read_text(encoding="utf-8")
    for pattern in _OBVIOUS_REAL_KEY_PATTERNS:
        match = pattern.search(content)
        assert match is None, (
            f"{template_path} contains what looks like a real credential "
            f"matching {pattern.pattern!r}: {match.group(0)[:12]}...; replace "
            f"with a `<your-key-here>` placeholder."
        )
