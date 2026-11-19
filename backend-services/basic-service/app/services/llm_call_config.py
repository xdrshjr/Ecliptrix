"""Call-time LLM configuration for backend services (SkillRouter spec §4.1).

Services must NOT read ``settings.*llm*`` (guarded by
``tests/test_no_direct_llm_settings_reads.py``): in router mode those values are
irrelevant, and in manual mode the model-settings panel assignments would be
ignored. Everything resolves through ``model_settings_service`` - database
assignment first, environment fallback second, SkillRouter overlay before both -
and **at call time**, never cached in ``__init__``, so a saved change takes
effect on the next request.
"""

from __future__ import annotations

from typing import Optional

from app.logger import get_logger
from app.models.model_settings_models import ModelFunctionType, ResolvedConfigResponse
from app.models.web_research_models import WebResearchError
from app.services.llm_client import LLMCallConfig, normalize_api_type
from app.services.model_settings_service import model_settings_service

logger = get_logger(__name__)


class LLMNotConfiguredError(ValueError):
    """No usable endpoint/key for the requested function type."""


async def resolve_llm_call_config(function_type: ModelFunctionType) -> LLMCallConfig:
    """Effective config of one LLM slot as an ``LLMCallConfig``.

    Raises:
        LLMNotConfiguredError: URL or key is empty (nothing assigned, no env).
    """
    resolved = await model_settings_service.get_effective_config(function_type)
    if not resolved.api_url or not resolved.api_key:
        raise LLMNotConfiguredError(
            f"LLM API key and URL must be configured for '{function_type.value}'")
    return LLMCallConfig(
        api_url=resolved.api_url, api_key=resolved.api_key,
        model=resolved.model_name or "", api_type=normalize_api_type(resolved.api_type),
    )


async def resolve_vision_target() -> Optional[ResolvedConfigResponse]:
    """Vision-language endpoint (vision slot, then chat/fast as the panel defines).

    Returns ``None`` when no tier is configured or the configured tier is
    incomplete; the reason is logged so callers can keep their historical
    "VL not configured" behaviour without hiding why.
    """
    try:
        return await model_settings_service.resolve_vision_config()
    except WebResearchError as error:
        logger.warning("Vision LLM unavailable: %s", error.error_code)
        return None
