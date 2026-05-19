"""Log redaction helpers — keeps secrets out of structured & freeform logs.

This module is consumed by the request-logging middleware in ``app/main.py``
and may also be used by any router/service that wants to log header / body
maps without leaking credentials.

Design notes
------------
* Case-insensitive header matching. HTTP header keys are case-insensitive
  per RFC 9110; ``Authorization`` and ``authorization`` must both redact.
* The body-key matcher only inspects shallow dict keys (cheap, deterministic).
  Deeply-nested redaction would be useful but is intentionally not added to
  avoid surprising O(n) blow-ups in middleware.
* The string regex pass catches ``Bearer <token>`` and ``sk-<token>`` /
  ``sk_<token>`` patterns anywhere inside a stringified payload. This is a
  belt-and-braces safety net — primary defense is the header/key dict pass.
* Replacement string: ``***REDACTED***`` (matches spec 05 §3.4).
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

REDACTED = "***REDACTED***"

# Lowercased — caller-provided keys are normalized before comparison.
SENSITIVE_HEADERS: frozenset[str] = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-session-token",
        "x-api-key",
        "x-api-app-key",
        "x-api-access-key",
        "x-auth-token",
        "proxy-authorization",
    }
)

# Substring match (case-insensitive). A key is sensitive if any of these
# substrings appear in it (e.g. ``volcano_tts_secret_key`` matches ``secret``).
SENSITIVE_BODY_KEY_SUBSTRINGS: tuple[str, ...] = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "private_key",
    "session_token",
    "active_session_token",
    "authorization",
    "credential",
)

# Patterns inside string payloads. Order matters — apply most specific first.
# Each pattern preserves the prefix (e.g. ``Bearer ``) so the log still tells
# you *what kind* of secret was redacted, just not the secret itself.
_STRING_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # Bearer / Basic <token>
    (re.compile(r"(?i)(Bearer\s+)[A-Za-z0-9._\-+/=]+"), r"\1" + REDACTED),
    (re.compile(r"(?i)(Basic\s+)[A-Za-z0-9+/=]+"), r"\1" + REDACTED),
    # OpenAI-style sk-... keys (>= 20 char tail to avoid false positives on
    # short identifiers like ``sk-test``).
    (re.compile(r"\bsk-[A-Za-z0-9._\-]{20,}"), "sk-" + REDACTED),
    # api_key=<value> or token=<value> in query strings / form bodies.
    (
        re.compile(
            r"(?i)\b(api[_-]?key|access[_-]?token|session[_-]?token|password)\s*=\s*[^\s&;,\"']+"
        ),
        r"\1=" + REDACTED,
    ),
    # JSON ``"key": "value"`` form for the same sensitive names.
    (
        re.compile(
            r'(?i)("(?:api[_-]?key|access[_-]?token|session[_-]?token|password|secret|authorization)"\s*:\s*")[^"]*(")'
        ),
        r"\1" + REDACTED + r"\2",
    ),
)


def _is_sensitive_body_key(key: str) -> bool:
    """True if ``key`` looks like a credential-bearing field name."""

    lowered = key.lower()
    return any(token in lowered for token in SENSITIVE_BODY_KEY_SUBSTRINGS)


def redact_headers(headers: Mapping[str, Any] | Iterable[tuple[str, Any]]) -> dict[str, Any]:
    """Return a copy of ``headers`` with sensitive values replaced.

    Accepts any mapping or iterable-of-pairs (matches both ``dict`` and
    Starlette's ``Headers`` object). The original input is never mutated.
    """

    if hasattr(headers, "items"):
        items = list(headers.items())  # type: ignore[union-attr]
    else:
        items = list(headers)  # type: ignore[arg-type]

    out: dict[str, Any] = {}
    for key, value in items:
        k_lower = str(key).lower()
        if k_lower in SENSITIVE_HEADERS:
            out[key] = REDACTED
        else:
            out[key] = value
    return out


def redact_body(body: Any) -> Any:
    """Redact secrets in arbitrary body payloads.

    * ``dict``  → recursively redact each key (shallow recursion into nested
      dicts and lists; primitives are passed through unless the key is
      sensitive).
    * ``list/tuple`` → element-wise recursion.
    * ``str``   → run the regex pass.
    * other primitive types → returned as-is.
    """

    if isinstance(body, Mapping):
        out: dict[str, Any] = {}
        for key, value in body.items():
            if isinstance(key, str) and _is_sensitive_body_key(key):
                out[key] = REDACTED
            else:
                out[key] = redact_body(value)
        return out

    if isinstance(body, list):
        return [redact_body(item) for item in body]
    if isinstance(body, tuple):
        return tuple(redact_body(item) for item in body)

    if isinstance(body, str):
        return redact_string(body)

    return body


def redact_string(payload: str) -> str:
    """Apply each ``_STRING_PATTERNS`` substitution to ``payload``."""

    if not payload:
        return payload
    out = payload
    for pattern, repl in _STRING_PATTERNS:
        out = pattern.sub(repl, out)
    return out


__all__ = [
    "REDACTED",
    "SENSITIVE_HEADERS",
    "SENSITIVE_BODY_KEY_SUBSTRINGS",
    "redact_headers",
    "redact_body",
    "redact_string",
]
