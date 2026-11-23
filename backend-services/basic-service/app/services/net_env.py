"""Shared httpx environment policy for outbound calls (spec R2-03).

Standard library only, so any service may import it without creating a cycle.
"""

from __future__ import annotations

import ipaddress
from typing import Any, Dict
from urllib.parse import urlsplit


def is_loopback_host(host: str) -> bool:
    """True for ``localhost`` and any loopback literal (``127.0.0.0/8``, ``::1``)."""
    name = (host or "").strip("[]").lower()
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def loopback_env_kwargs(url: str) -> Dict[str, Any]:
    """``httpx`` kwargs that keep loopback targets away from system proxies.

    A developer proxy (Clash on Windows) answers 502 for ``127.0.0.1``, which
    breaks a local gateway or LLM server. Real hosts return ``{}`` so their
    behaviour (and any test substituting the client factory) is unchanged.
    """
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return {}
    return {"trust_env": False} if is_loopback_host(host) else {}
