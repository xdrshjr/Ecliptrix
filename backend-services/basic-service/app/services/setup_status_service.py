"""First-run capability readiness (first-run-setup-wizard spec §3.1).

Every verdict is delegated to the resolvers the runtime itself uses, so the
wizard can never say "configured" while the feature would still fail. The
output carries no secrets: only ids, states, sources and display names.
"""

from __future__ import annotations

import re
from typing import Awaitable, Callable, List, Optional

from app.logger import get_logger
from app.models.model_settings_models import ModelFunctionType
from app.models.setup_status_models import (
    CapabilityId,
    CapabilityStatusData,
    CapabilityStatusItem,
)
from app.models.web_research_models import WebResearchError
from app.services.model_settings_service import model_settings_service
from app.services.system_settings_service import system_settings_service
from app.services.web_research.web_search_service import get_web_search_service

logger = get_logger(__name__)

# Mirrors the desktop env.template placeholder convention (your_*_here) so a
# template value copied verbatim into a .env still reads as "unconfigured".
PLACEHOLDER_PATTERN = re.compile(r"^your_.*_here$", re.IGNORECASE)

_STAGE_CAPABILITY = {
    ModelFunctionType.VISION: "vision",
    ModelFunctionType.RESEARCH: "research",
    ModelFunctionType.CHAT: "chat",
    ModelFunctionType.FAST: "fast",
}

_VISION_STAGES = [
    (ModelFunctionType.VISION, "vl_llm"),
    (ModelFunctionType.CHAT, "llm"),
    (ModelFunctionType.FAST, "fast_llm"),
]
_RESEARCH_STAGES = [
    (ModelFunctionType.RESEARCH, "research_llm"),
    (ModelFunctionType.FAST, "fast_llm"),
    (ModelFunctionType.CHAT, "llm"),
]


def is_usable_secret(value: Optional[str]) -> bool:
    """True for a non-empty value that is not a template placeholder."""
    stripped = (value or "").strip()
    return bool(stripped) and not PLACEHOLDER_PATTERN.match(stripped)


def _provider_display_name(provider_type: Optional[str]) -> Optional[str]:
    for known in model_settings_service.get_providers():
        if known.id == provider_type:
            return known.name
    return None


def _item_from_config(
    capability: CapabilityId, tier: str, config
) -> CapabilityStatusItem:
    """Direct (non-inheriting) slot: ready only when the group is complete."""
    complete = (
        is_usable_secret(config.api_key)
        and is_usable_secret(config.api_url)
        and is_usable_secret(config.model_name)
    )
    if not complete:
        return CapabilityStatusItem(id=capability, tier=tier, state="missing")
    return CapabilityStatusItem(
        id=capability,
        tier=tier,
        state="ready",
        source=config.source,
        provider_name=_provider_display_name(config.provider_type),
        model_name=config.model_name,
    )


async def _direct_slot(
    capability: CapabilityId, function_type: ModelFunctionType
) -> CapabilityStatusItem:
    config = await model_settings_service.get_effective_config(function_type)
    return _item_from_config(capability, "core", config)


async def _staged_slot(
    capability: CapabilityId, tier: str, stages
) -> CapabilityStatusItem:
    try:
        origin, config = await model_settings_service.resolve_stage_origin(stages)
    except WebResearchError as error:
        state = "invalid" if error.error_code == "configuration_invalid" else "missing"
        return CapabilityStatusItem(id=capability, tier=tier, state=state)
    if not is_usable_secret(config.api_key):
        return CapabilityStatusItem(id=capability, tier=tier, state="missing")
    own = _STAGE_CAPABILITY[origin] == capability
    return CapabilityStatusItem(
        id=capability,
        tier=tier,
        state="ready" if own else "inherited",
        source=config.source if own else "inherited",
        provider_name=_provider_display_name(getattr(config, "provider_type", None)),
        model_name=config.model_name,
        inherited_from=None if own else _STAGE_CAPABILITY[origin],
    )


async def _web_search_slot() -> CapabilityStatusItem:
    keys = [
        key
        for key in get_web_search_service().usable_keys()
        if is_usable_secret(key)
    ]
    if not keys:
        return CapabilityStatusItem(id="web_search", tier="extended", state="missing")
    # A stored list (even a user-edited one) wins; null means "inherit env".
    stored = system_settings_service.get("web_research", "tavily_api_keys")
    return CapabilityStatusItem(
        id="web_search",
        tier="extended",
        state="ready",
        source="database" if isinstance(stored, list) else "environment",
    )


_REGISTRY: List[tuple] = [
    ("chat", lambda: _direct_slot("chat", ModelFunctionType.CHAT)),
    ("fast", lambda: _direct_slot("fast", ModelFunctionType.FAST)),
    ("video_cut", lambda: _direct_slot("video_cut", ModelFunctionType.VIDEO_CUT)),
    ("vision", lambda: _staged_slot("vision", "core", _VISION_STAGES)),
    ("research", lambda: _staged_slot("research", "extended", _RESEARCH_STAGES)),
    ("web_search", _web_search_slot),
]
_TIERS = {"web_search": "extended", "research": "extended"}


async def _safe_probe(
    capability: str, probe: Callable[[], Awaitable[CapabilityStatusItem]]
) -> CapabilityStatusItem:
    try:
        return await probe()
    except Exception:
        logger.exception("capability probe failed: %s", capability)
        return CapabilityStatusItem(
            id=capability,
            tier=_TIERS.get(capability, "core"),
            state="indeterminate",
        )


async def compute_capability_status() -> CapabilityStatusData:
    """Probe every registered capability; a probe fault only taints its row."""
    items = [await _safe_probe(name, probe) for name, probe in _REGISTRY]
    missing_core = [
        item.id
        for item in items
        if item.tier == "core" and item.state in ("missing", "invalid")
    ]
    return CapabilityStatusData(capabilities=items, missing_core=missing_core)
