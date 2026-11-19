"""LLM configuration overlay (spec §3.4).

``resolve`` is called FIRST by ``ModelSettingsService``. It returns ``None``
whenever the manual path must run (not router mode, slot overridden to manual,
or no key), so ``manual`` behaviour stays byte-identical.

The hot path never touches the network: the protocol comes from the saved
``slot_protocols`` and the model from the saved ``model_<slot>``. The catalogue
is consulted only for a slot that has no saved model yet.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from app.models.model_settings_models import ModelFunctionType, ResolvedConfigResponse
from app.services.skillrouter import catalog
from app.services.skillrouter.config import RouterSnapshot, get_snapshot, is_enabled
from app.services.skillrouter.constants import LLM_SLOTS
from app.services.skillrouter.errors import RouterError

SOURCE = "skillrouter"
PROVIDER_NAME = "SkillRouter"

_HEURISTICS: Dict[str, re.Pattern] = {
    "fast": re.compile(r"haiku|flash|mini|lite|turbo|air|small", re.I),
    "vision": re.compile(r"vl|vision|omni|gemini|4o|sonnet|opus", re.I),
    "general": re.compile(r"sonnet|opus|gpt|deepseek|qwen|glm|kimi|claude", re.I),
}


def slot_for(function_type: ModelFunctionType) -> str:
    """Map a function type to its router slot (``coding`` folds into ``chat``)."""
    value = function_type.value
    return "chat" if value == "coding" else value


def pick_default_model(slot: str, models: List[Dict], saved: Optional[str] = None) -> Optional[str]:
    """Deterministic default model for ``slot`` (spec §3.4 step 3).

    Priority: saved-and-listed > operator convention ``ecliptrix-<slot>`` >
    name heuristic > first entry. Returns ``None`` for an empty catalogue.
    """
    # The vision call sites use the OpenAI SDK (VL-07): never default the
    # vision slot to an anthropic-protocol model while an alternative exists.
    pool = models
    if slot == "vision":
        pool = [m for m in models if m.get("protocol") != "anthropic"] or models
    ids = [m["id"] for m in pool]
    if saved and saved in [m["id"] for m in models]:
        return saved
    convention = f"ecliptrix-{slot}"
    if convention in ids:
        return convention
    pattern = _HEURISTICS.get(slot, _HEURISTICS["general"])
    for model_id in ids:
        if pattern.search(model_id):
            return model_id
    return ids[0] if ids else None


def protocol_of(models: List[Dict], model_id: str) -> str:
    """Protocol of ``model_id`` in the catalogue (``openai`` when unknown/route)."""
    for model in models:
        if model["id"] == model_id:
            return model.get("protocol", "openai")
    return "openai"


def endpoint_for(snapshot: RouterSnapshot, protocol: str) -> str:
    """``api_url`` such that the existing clients append the right path.

    openai    -> {base}/api/v1  (+ /chat/completions)
    anthropic -> {base}/api     (+ /v1/messages)
    """
    if protocol == "anthropic":
        return f"{snapshot.base_url}/api"
    return f"{snapshot.base_url}/api/v1"


def overlay_applies(snapshot: RouterSnapshot, slot: str) -> bool:
    return (is_enabled() and snapshot.mode == "router" and snapshot.has_key
            and slot not in snapshot.manual_capabilities)


async def _model_for(snapshot: RouterSnapshot, slot: str):
    """(model, protocol) - saved values first, catalogue only for an unsaved slot."""
    saved = snapshot.slot_models.get(slot)
    if saved:
        return saved, snapshot.slot_protocols.get(slot, "openai")
    models = (await catalog.get_models()).data
    chosen = pick_default_model(slot, models)
    if not chosen:
        raise RouterError("models_unavailable", 503,
                          "The gateway has no models available. Contact the gateway "
                          "operator or switch this capability to manual configuration.")
    return chosen, protocol_of(models, chosen)


async def resolve(
    function_type: ModelFunctionType, *, temperature: float = 0.7, max_tokens: int = 128000,
) -> Optional[ResolvedConfigResponse]:
    """Overlay config for one function type, or ``None`` to use the manual path."""
    snapshot = get_snapshot()
    slot = slot_for(function_type)
    if slot not in LLM_SLOTS or not overlay_applies(snapshot, slot):
        return None
    model, protocol = await _model_for(snapshot, slot)
    return ResolvedConfigResponse(
        success=True, source=SOURCE, api_url=endpoint_for(snapshot, protocol),
        api_key=snapshot.api_key, model_name=model, temperature=temperature,
        max_tokens=max_tokens, provider_type=SOURCE, api_type=protocol,
    )
