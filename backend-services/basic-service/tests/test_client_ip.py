"""
Unit tests for ``get_client_ip`` (spec 02 §2.2).

Resolution order:
  1. First segment of ``X-Forwarded-For`` (original client; nginx appends
     downstream proxies to the right).
  2. ``request.client.host`` (direct socket peer).
  3. ``"unknown"`` sentinel.

We build real Starlette ``Request`` objects from a hand-rolled ASGI scope so we
exercise the exact header/client lookup the middleware uses in production.
"""

from __future__ import annotations

from typing import Optional

from starlette.requests import Request

from app.services.rate_limiter import get_client_ip


def _make_request(
    *,
    xff: Optional[str] = None,
    client: Optional[tuple] = ("203.0.113.9", 12345),
) -> Request:
    """Construct a Starlette Request with optional XFF header + client peer."""
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode("latin-1")))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/anything",
        "headers": headers,
        "client": client,  # (host, port) or None
        "scheme": "http",
        "server": ("testserver", 80),
        "query_string": b"",
    }
    return Request(scope)


# ---------------------------------------------------------------------------
# X-Forwarded-For takes precedence; first segment is used
# ---------------------------------------------------------------------------
def test_xff_single_value():
    req = _make_request(xff="198.51.100.7")
    assert get_client_ip(req) == "198.51.100.7"


def test_xff_first_segment_of_chain():
    # nginx form: client, proxy1, proxy2 — the leftmost is the real client.
    req = _make_request(xff="198.51.100.7, 10.0.0.1, 10.0.0.2")
    assert get_client_ip(req) == "198.51.100.7"


def test_xff_first_segment_is_stripped():
    req = _make_request(xff="   198.51.100.7   , 10.0.0.1")
    assert get_client_ip(req) == "198.51.100.7"


def test_xff_overrides_client_peer():
    req = _make_request(xff="198.51.100.7", client=("10.9.9.9", 5))
    # XFF wins over the socket peer.
    assert get_client_ip(req) == "198.51.100.7"


# ---------------------------------------------------------------------------
# Fallback to request.client.host when XFF absent / empty
# ---------------------------------------------------------------------------
def test_fallback_to_client_host_when_no_xff():
    req = _make_request(xff=None, client=("203.0.113.9", 12345))
    assert get_client_ip(req) == "203.0.113.9"


def test_empty_xff_falls_back_to_client_host():
    req = _make_request(xff="", client=("203.0.113.9", 1))
    assert get_client_ip(req) == "203.0.113.9"


def test_whitespace_only_first_segment_falls_back():
    # Leading empty segment ("," chain start) → first stripped token is empty →
    # fall back to the socket peer rather than returning "".
    req = _make_request(xff="   , 10.0.0.1", client=("203.0.113.9", 1))
    assert get_client_ip(req) == "203.0.113.9"


# ---------------------------------------------------------------------------
# Unknown sentinel when neither source is available
# ---------------------------------------------------------------------------
def test_unknown_when_no_xff_and_no_client():
    req = _make_request(xff=None, client=None)
    assert get_client_ip(req) == "unknown"
