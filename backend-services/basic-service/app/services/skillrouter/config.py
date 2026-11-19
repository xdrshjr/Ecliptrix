"""Source-mode snapshot and the single routing decision (spec §3.1 D1/D4, §3.3).

``is_routed(capability)`` is the ONLY place that decides whether a seam talks to
the gateway. It is synchronous and I/O free (the credential store is an
in-memory copy-on-write cache), so synchronous services can call it too.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from app.services.integration_credentials_service import integration_credentials
from app.services.skillrouter.constants import (
    DEFAULT_BASE_URL, INTEGRATION_ID, LLM_SLOTS, MANUAL_ONLY, ROUTED,
)
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.validation import parse_capability_list

KILL_SWITCH_ENV = "SKILLROUTER_ENABLED"


@dataclass(frozen=True)
class RouterSnapshot:
    """Immutable view of the saved routing configuration. ``api_key`` is a secret."""

    mode: str
    mode_state: str  # unset | manual | router
    base_url: str
    api_key: str = field(default="", repr=False)
    manual_capabilities: Tuple[str, ...] = ()
    slot_models: Dict[str, str] = field(default_factory=dict)
    slot_protocols: Dict[str, str] = field(default_factory=dict)
    revision: str = ""

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    @property
    def key_hint(self) -> Optional[str]:
        """``ar-…****abcd`` style hint: prefix up to 3 chars + last 4. Never the key."""
        if not self.api_key:
            return None
        prefix = self.api_key[:3] if self.api_key.startswith("ar-") else ""
        return f"{prefix}…****{self.api_key[-4:]}"


def is_enabled() -> bool:
    """Emergency valve (spec §10): ``SKILLROUTER_ENABLED=0`` forces manual paths."""
    return os.environ.get(KILL_SWITCH_ENV, "1").strip().lower() not in ("0", "false", "off", "no")


def _read(name: str) -> str:
    return integration_credentials.value(INTEGRATION_ID, name)


def _parse_protocols(raw: str) -> Dict[str, str]:
    try:
        parsed = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return {k: v for k, v in parsed.items() if k in LLM_SLOTS} if isinstance(parsed, dict) else {}


def _compute_revision(mode: str, base_url: str, api_key: str, manual: Tuple[str, ...]) -> str:
    fingerprint = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12] if api_key else ""
    material = "|".join([mode, base_url, fingerprint, ",".join(manual)])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def get_snapshot() -> RouterSnapshot:
    """Read the current configuration from the credential cache (no I/O)."""
    resolved = integration_credentials.resolve(INTEGRATION_ID)
    mode_field = resolved.field("mode")
    mode = mode_field.value if mode_field and mode_field.value else "manual"
    mode_state = "unset" if (mode_field is None or mode_field.source == "default") else mode
    base_url = _read("base_url") or DEFAULT_BASE_URL
    api_key = _read("api_key")
    manual = tuple(c for c in parse_capability_list(_read("manual_capabilities")) if c in ROUTED)
    slot_models = {slot: _read(f"model_{slot}") for slot in LLM_SLOTS if _read(f"model_{slot}")}
    return RouterSnapshot(
        mode=mode, mode_state=mode_state, base_url=base_url.rstrip("/"), api_key=api_key,
        manual_capabilities=manual, slot_models=slot_models,
        slot_protocols=_parse_protocols(_read("slot_protocols")),
        revision=_compute_revision(mode, base_url, api_key, manual),
    )


def is_router_mode() -> bool:
    """True when the global mode is ``router`` (kill switch respected)."""
    return is_enabled() and get_snapshot().mode == "router"


def is_routed(capability: str) -> bool:
    """The single routing decision for ``capability`` (an Ecliptrix capability id)."""
    if capability in MANUAL_ONLY or capability not in ROUTED or not is_enabled():
        return False
    snapshot = get_snapshot()
    return snapshot.mode == "router" and capability not in snapshot.manual_capabilities


def require_ready() -> RouterSnapshot:
    """Return the snapshot or raise when router mode has no usable key.

    Raises:
        RouterError: ``router_key_missing`` (mapped to credential_not_configured).
    """
    snapshot = get_snapshot()
    if not snapshot.has_key:
        raise RouterError("router_key_missing", 409, "SkillRouter API key is not configured.")
    return snapshot
