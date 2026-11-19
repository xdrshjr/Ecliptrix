"""Router-aware readiness for the first-run status endpoint (spec §4.7).

Reads the catalogue CACHE only; ``prime`` kicks one bounded refresh per status
request so a slow or dead gateway never makes the endpoint slow. Anything we
cannot judge is ``indeterminate`` (fail-open: never pop the wizard on a network
blip).
"""

from __future__ import annotations

from typing import Optional

from app.models.setup_status_models import CapabilityStatusItem
from app.services.skillrouter import catalog
from app.services.skillrouter.config import get_snapshot, is_routed
from app.services.skillrouter.constants import LLM_SLOTS, ROUTER_CAPABILITY_MAP
from app.services.skillrouter.llm_overlay import PROVIDER_NAME

PRIME_WAIT_SECONDS = 2.0


async def prime() -> None:
    """Refresh the capability cache once (bounded); a no-op outside router mode."""
    from app.services.skillrouter.config import is_router_mode

    if is_router_mode() and get_snapshot().has_key:
        await catalog.get_capabilities(wait=PRIME_WAIT_SECONDS)


def _item(capability: str, tier: str, state: str, **extra) -> CapabilityStatusItem:
    return CapabilityStatusItem(id=capability, tier=tier, state=state, **extra)


def _ready(capability: str, tier: str, model: Optional[str] = None) -> CapabilityStatusItem:
    return _item(capability, tier, "ready", source="router",
                 provider_name=PROVIDER_NAME, model_name=model)


async def routed_item(capability: str, tier: str) -> Optional[CapabilityStatusItem]:
    """Status of a routed capability, or ``None`` when the manual probe applies."""
    if not is_routed(capability):
        return None
    snapshot = get_snapshot()
    if not snapshot.has_key:
        return _item(capability, tier, "missing")
    cached = catalog.cached_capabilities()
    if cached.error == "authentication_error":
        return _item(capability, tier, "invalid")
    if capability in LLM_SLOTS:
        return _ready(capability, tier, snapshot.slot_models.get(capability))
    return _media_item(capability, tier, cached)


def _media_item(capability: str, tier: str, cached) -> CapabilityStatusItem:
    if not cached.data:
        return _item(capability, tier, "indeterminate")
    entry = catalog.capability_entry(ROUTER_CAPABILITY_MAP[capability])
    if entry is None:
        return _item(capability, tier, "indeterminate")
    if entry.get("available") is False or entry.get("enabled") is False:
        return _item(capability, tier, "unavailable", source="router",
                     provider_name=PROVIDER_NAME)
    return _ready(capability, tier)
