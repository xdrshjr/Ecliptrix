"""Boundary validators for the ``skillrouter`` credential row (spec §3.2).

Pure functions raising :class:`CredentialValidationError` (imported lazily:
the credential store imports this module, not the other way around).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List
from urllib.parse import urlsplit

from app.services.skillrouter.constants import (
    LLM_SLOTS, MANUAL_ONLY, PROTOCOLS, ROUTED,
)

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_UNSAFE = re.compile(r"[\s\x00-\x1f\x7f]")
_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$")
_API_KEY_MIN, _API_KEY_MAX = 8, 256
_BASE_URL_MAX = 200


def _reject(code: str, field_name: str):
    from app.services.integration_credentials_service import CredentialValidationError

    raise CredentialValidationError(code, field_name)


def validate_base_url(raw: Any) -> str:
    """https only (http allowed for loopback dev hosts); no userinfo/query/fragment."""
    if not isinstance(raw, str):
        _reject("invalid_base_url", "base_url")
    value = raw.strip()
    if not value or len(value) > _BASE_URL_MAX or _UNSAFE.search(value):
        _reject("invalid_base_url", "base_url")
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
        parts.port  # noqa: B018 - raises ValueError on a malformed port
    except ValueError:
        _reject("invalid_base_url", "base_url")
    is_loopback = host in _LOOPBACK_HOSTS
    scheme_ok = parts.scheme == "https" or (parts.scheme == "http" and is_loopback)
    if not scheme_ok or not host:
        _reject("invalid_base_url", "base_url")
    if "@" in parts.netloc:
        _reject("invalid_base_url", "base_url")
    if parts.query or parts.fragment or "?" in value or "#" in value:
        _reject("invalid_base_url", "base_url")
    return value.rstrip("/")


def validate_api_key(raw: Any) -> str:
    """Non-empty, 8-256 chars, no whitespace. The ``ar-`` prefix is NOT enforced."""
    if not isinstance(raw, str):
        _reject("credential_malformed", "api_key")
    value = raw.strip()
    if not _API_KEY_MIN <= len(value) <= _API_KEY_MAX or _UNSAFE.search(value):
        _reject("credential_malformed", "api_key")
    return value


def parse_capability_list(raw: Any) -> List[str]:
    """Comma separated string or list -> de-duplicated ordered list."""
    if isinstance(raw, str):
        items = [item.strip() for item in raw.split(",")]
    elif isinstance(raw, list):
        items = [item.strip() for item in raw if isinstance(item, str)]
    else:
        _reject("credential_malformed", "manual_capabilities")
    ordered: List[str] = []
    for item in items:
        if item and item not in ordered:
            ordered.append(item)
    return ordered


def validate_manual_capabilities(raw: Any) -> str:
    """Stored as a comma string. MANUAL_ONLY ids are dropped, unknown ids rejected."""
    kept: List[str] = []
    for item in parse_capability_list(raw):
        if item in MANUAL_ONLY:
            continue
        if item not in ROUTED:
            _reject("unknown_capability", "manual_capabilities")
        kept.append(item)
    return ",".join(kept)


def validate_model_id(raw: Any, field_name: str) -> str:
    """A model id as the gateway lists it (permissive charset, bounded length)."""
    if not isinstance(raw, str) or not _MODEL_ID.match(raw.strip()):
        _reject("credential_malformed", field_name)
    return raw.strip()


def validate_slot_protocols(raw: Any) -> str:
    """JSON ``{slot: "openai"|"anthropic"}``; written by the server only."""
    try:
        parsed: Dict[str, str] = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (TypeError, ValueError):
        _reject("credential_malformed", "slot_protocols")
    if not isinstance(parsed, dict):
        _reject("credential_malformed", "slot_protocols")
    for slot, protocol in parsed.items():
        if slot not in LLM_SLOTS or protocol not in PROTOCOLS:
            _reject("credential_malformed", "slot_protocols")
    return json.dumps(parsed, sort_keys=True, separators=(",", ":"))


VERIFY_OUTCOMES = frozenset({"ok", "invalid_credentials", "unreachable", "upstream_error", "unverifiable"})
_REVISION = re.compile(r"^[0-9a-f]{8,32}$")


def validate_last_verified(raw: Any) -> str:
    """JSON ``{ok, outcome, at, revision}`` written by the server only (no secrets)."""
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (TypeError, ValueError):
        _reject("credential_malformed", "last_verified")
    if not isinstance(parsed, dict):
        _reject("credential_malformed", "last_verified")
    at, revision = parsed.get("at"), parsed.get("revision")
    if (parsed.get("outcome") not in VERIFY_OUTCOMES or not isinstance(parsed.get("ok"), bool)
            or isinstance(at, bool) or not isinstance(at, int) or at <= 0
            or not isinstance(revision, str) or not _REVISION.match(revision)):
        _reject("credential_malformed", "last_verified")
    clean = {"ok": parsed["ok"], "outcome": parsed["outcome"], "at": at, "revision": revision}
    return json.dumps(clean, sort_keys=True, separators=(",", ":"))


def validate_text_field(field_name: str, raw: Any) -> str:
    """Dispatch for the ``text`` fields of the skillrouter row."""
    if field_name == "base_url":
        return validate_base_url(raw)
    if field_name == "manual_capabilities":
        return validate_manual_capabilities(raw)
    if field_name == "slot_protocols":
        return validate_slot_protocols(raw)
    if field_name == "last_verified":
        return validate_last_verified(raw)
    return validate_model_id(raw, field_name)
