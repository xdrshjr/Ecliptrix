"""Use-cases behind ``/api/skillrouter`` (spec §5.1). The router stays thin.

Every public result is zero-secret: the key only ever appears as ``keyHint``.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from app.models.model_settings_models import ModelFunctionType, TestConnectionRequest
from app.models.skillrouter_models import (
    SkillRouterStatus, SkillRouterUpdateRequest, SkillRouterVerifyRequest,
)
from app.services.integration_credentials_service import (
    CredentialValidationError, integration_credentials,
)
from app.services.skillrouter import catalog
from app.services.skillrouter.client import AsyncRouterClient
from app.services.skillrouter.config import (
    RouterSnapshot, get_snapshot, is_enabled,
)
from app.services.skillrouter.constants import (
    INTEGRATION_ID, LLM_SLOTS, MANUAL_ONLY, PROTOCOLS, ROUTED, ROUTER_CAPABILITY_MAP,
)
from app.services.skillrouter.errors import RouterError
from app.services.skillrouter.llm_overlay import (
    pick_default_model, protocol_of, resolve as resolve_overlay,
)
from app.services.skillrouter.validation import validate_api_key, validate_base_url

VERIFY_MIN_INTERVAL_SECONDS = 2.0
_last_verify_at = 0.0


def reset() -> None:
    global _last_verify_at
    _last_verify_at = 0.0
    catalog.reset()


def _defaults(snapshot: RouterSnapshot) -> Dict[str, str]:
    models = catalog.cached_models_snapshot()
    result: Dict[str, str] = {}
    for slot in LLM_SLOTS:
        chosen = pick_default_model(slot, models, snapshot.slot_models.get(slot))
        if chosen:
            result[slot] = chosen
    return result


def build_status() -> SkillRouterStatus:
    """Public state of the routing configuration (no secrets)."""
    snapshot = get_snapshot()
    return SkillRouterStatus(
        mode=snapshot.mode, modeState=snapshot.mode_state, baseUrl=snapshot.base_url,
        keyConfigured=snapshot.has_key, keyHint=snapshot.key_hint, enabled=is_enabled(),
        manualCapabilities=list(snapshot.manual_capabilities),
        slotModels=dict(snapshot.slot_models), defaults=_defaults(snapshot),
        lastVerified=catalog.last_verified(), revision=snapshot.revision,
    )


def _slot_patch(request: SkillRouterUpdateRequest, current: RouterSnapshot,
                models: List[Dict[str, Any]]) -> Dict[str, Any]:
    """``model_<slot>`` fields plus the server-written ``slot_protocols``."""
    patch: Dict[str, Any] = {}
    protocols = dict(current.slot_protocols)
    for slot, model in (request.slot_models or {}).items():
        if slot not in LLM_SLOTS:
            raise CredentialValidationError("unknown_slot", "slot_models")
        patch[f"model_{slot}"] = model or None
        if not model:
            protocols.pop(slot, None)
            continue
        hint = (request.slot_protocols or {}).get(slot)
        known = next((m for m in models if m["id"] == model), None)
        protocols[slot] = known["protocol"] if known else (hint or "openai")
    if patch:
        patch["slot_protocols"] = json.dumps(protocols) if protocols else None
    return patch


def _base_patch(request: SkillRouterUpdateRequest) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    if request.mode is not None:
        patch["mode"] = request.mode
    if request.api_key is not None:
        patch["api_key"] = request.api_key
    if request.base_url is not None:
        patch["base_url"] = request.base_url
    if request.manual_capabilities is not None:
        patch["manual_capabilities"] = ",".join(request.manual_capabilities)
    return patch


async def _default_slot_patch(models: List[Dict[str, Any]], current: RouterSnapshot,
                              patch: Dict[str, Any]) -> Dict[str, Any]:
    """On entering router mode, pre-fill unsaved slots from the catalogue (best effort)."""
    if not models:
        return {}
    protocols = dict(current.slot_protocols)
    fill: Dict[str, Any] = {}
    for slot in LLM_SLOTS:
        if current.slot_models.get(slot) or f"model_{slot}" in patch:
            continue
        chosen = pick_default_model(slot, models)
        if chosen:
            fill[f"model_{slot}"] = chosen
            protocols[slot] = protocol_of(models, chosen)
    if fill:
        fill["slot_protocols"] = json.dumps(protocols)
    return fill


async def apply_update(request: SkillRouterUpdateRequest) -> SkillRouterStatus:
    """Validate and persist a patch; resets the catalogue when key/URL change.

    Raises:
        CredentialValidationError: a field was rejected (nothing written).
        IntegrationSaveFailed: the database write failed.
    """
    current = get_snapshot()
    patch = _base_patch(request)
    credentials_changed = any(name in patch for name in ("api_key", "base_url"))
    models = catalog.cached_models_snapshot()
    patch.update(_slot_patch(request, current, models))
    if request.mode == "router":
        await integration_credentials.save(INTEGRATION_ID, patch)  # key rule enforced here
        if credentials_changed:
            catalog.reset()
        fresh = get_snapshot()
        fetched = (await catalog.get_models(wait=5.0)).data
        extra = await _default_slot_patch(fetched, fresh, patch)
        if extra:
            await integration_credentials.save(INTEGRATION_ID, extra)
        return build_status()
    if patch:
        await integration_credentials.save(INTEGRATION_ID, patch)
    if credentials_changed:
        catalog.reset()
    return build_status()


async def clear_key() -> SkillRouterStatus:
    """Remove the key and fall back to manual; every other field is kept."""
    await integration_credentials.save(INTEGRATION_ID, {"api_key": None, "mode": "manual"})
    catalog.reset()
    return build_status()


def _verify_snapshot(request: SkillRouterVerifyRequest) -> Optional[RouterSnapshot]:
    """Snapshot to verify: submitted credentials (never stored) or the saved ones."""
    saved = get_snapshot()
    key = validate_api_key(request.api_key) if request.api_key else saved.api_key
    base = validate_base_url(request.base_url) if request.base_url else saved.base_url
    if not key:
        return None
    return RouterSnapshot(mode=saved.mode, mode_state=saved.mode_state, base_url=base,
                          api_key=key, revision="verify")


def _classify(error: RouterError) -> str:
    if error.code == "authentication_error":
        return "invalid_credentials"
    if error.code in ("router_unreachable", "upstream_timeout"):
        return "unreachable"
    return "upstream_error"


def _quota_view(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    quota = entry.get("quota")
    return quota if isinstance(quota, dict) else None


async def verify(request: SkillRouterVerifyRequest) -> Dict[str, Any]:
    """Zero-cost verification via ``GET /capabilities``.

    Raises:
        CredentialValidationError: submitted key/base URL malformed.
        RouterError: throttled (``probe_throttled``) or no key at all.
    """
    global _last_verify_at
    now = time.monotonic()
    if now - _last_verify_at < VERIFY_MIN_INTERVAL_SECONDS:
        raise RouterError("probe_throttled", 429, "Verify again in a moment.", retry_after=2)
    _last_verify_at = now
    snapshot = _verify_snapshot(request)
    if snapshot is None:
        raise RouterError("router_key_missing", 409, "No SkillRouter key to verify.")
    saved_check = not request.api_key and not request.base_url
    started = time.monotonic()
    outcome, entries = "ok", []
    try:
        raw = await AsyncRouterClient(snapshot).get("capabilities", retry=False)
        entries = [c for c in raw if isinstance(c, dict)] if isinstance(raw, list) else []
    except RouterError as error:
        outcome = _classify(error)
    latency = int((time.monotonic() - started) * 1000)
    if saved_check:
        catalog.record_verification(outcome)
    return {
        "outcome": outcome, "latencyMs": latency,
        "capabilities": [
            {"id": e.get("id"), "available": bool(e.get("available")),
             "unavailableReason": e.get("unavailableReason"), "quota": _quota_view(e)}
            for e in entries if e.get("id") in set(ROUTER_CAPABILITY_MAP.values())
        ],
        "coverage": {"routed": sorted(ROUTED), "manualOnly": sorted(MANUAL_ONLY)},
    }


async def catalog_view(refresh: bool) -> Dict[str, Any]:
    """Models + capabilities + per-slot defaults (cache, optionally forced)."""
    models = await catalog.get_models(force=refresh)
    caps = await catalog.get_capabilities(force=refresh)
    snapshot = get_snapshot()
    return {
        "models": models.data, "capabilities": caps.data, "defaults": _defaults(snapshot),
        "stale": models.stale or caps.stale, "fetchedAt": caps.fetched_at or models.fetched_at,
        "error": models.error or caps.error,
    }


async def usage_view() -> Dict[str, Any]:
    """Thin per-capability quota view derived from the capability cache."""
    caps = await catalog.get_capabilities()
    return {"capabilities": {
        c["id"]: _quota_view(c) for c in caps.data if isinstance(c.get("id"), str)
    }, "stale": caps.stale}


async def test_slot(slot: str) -> Dict[str, Any]:
    """Send a minimal chat request for one LLM slot through the gateway."""
    from app.services.model_settings_service import model_settings_service

    if slot not in LLM_SLOTS:
        raise CredentialValidationError("unknown_slot", "slot")
    config = await resolve_overlay(ModelFunctionType(slot))
    if config is None:
        raise RouterError("router_key_missing", 409, "Router mode is not active for this slot.")
    result = await model_settings_service.test_connection(TestConnectionRequest(
        api_url=config.api_url, api_key=config.api_key, model_name=config.model_name,
        api_format=config.api_type if config.api_type in PROTOCOLS else None,
    ))
    return {"ok": result.success, "message": result.message[:200],
            "latencyMs": result.latency_ms, "model": config.model_name}
