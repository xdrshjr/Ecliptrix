"""Stable "credential not configured" error (setup-wizard-full-capability-coverage §3.4).

Routers call :func:`require_configured` BEFORE touching a service, because some
services answer a missing key with ``None`` / an empty result that the UI would
render as "no search results". The app-level handler in ``main.py`` turns the
exception into the shared ``ErrorResponse`` envelope with the stable code
``credential_not_configured`` and ``error_details.integration_id`` so the
frontend can offer a "go configure it" button instead of parsing English text.
"""

from __future__ import annotations

from app.services.integration_credentials_service import integration_credentials
from app.services.integration_credentials_service import IntegrationLoadFailed
from app.services.ark_video_profiles import InvalidModelConfiguration, validate_model_configuration

CREDENTIAL_NOT_CONFIGURED = "credential_not_configured"
NOT_CONFIGURED_STATUS = 409

_MESSAGES = {
    "volcano_tts": "Speech synthesis is not configured.",
    "volcano_asr": "Speech recognition (subtitles) is not configured.",
    "volcano_voice_clone": "Voice cloning is not configured.",
    "ark_image": "AI 图片生成（Seedream）尚未配置。",
    "ark_video": "AI 视频生成（Seedance）尚未配置。",
    "pexels": "The Pexels video library is not configured.",
    "unsplash": "The Unsplash image library is not configured.",
    "freesound": "The Freesound sound library is not configured.",
    "skillrouter": "AI 能力中转站尚未配置 API Key。",
}


class CredentialNotConfigured(Exception):
    """A feature was requested whose required credentials are missing."""

    def __init__(self, integration_id: str) -> None:
        self.integration_id = integration_id
        where = ("Settings -> Capability source" if integration_id == "skillrouter"
                 else "Settings -> Services & asset libraries")
        self.message = (
            f"{_MESSAGES.get(integration_id, 'This service is not configured.')} "
            f"Open {where} to set it up."
        )
        super().__init__(self.message)


def _is_routed_integration(integration_id: str) -> bool:
    from app.services.skillrouter.config import is_routed
    from app.services.skillrouter.constants import INTEGRATION_TO_CAPABILITY

    capability = INTEGRATION_TO_CAPABILITY.get(integration_id)
    return bool(capability) and is_routed(capability)


def _require_router_or_continue(integration_id: str) -> None:
    """Raise ``CredentialNotConfigured('skillrouter')`` when routed without a key."""
    if not _is_routed_integration(integration_id):
        return
    from app.services.skillrouter.config import get_snapshot

    if not get_snapshot().has_key:
        raise CredentialNotConfigured("skillrouter")


def require_configured(integration_id: str) -> None:
    """Raise :class:`CredentialNotConfigured` unless the integration is usable.

    Raises:
        CredentialNotConfigured: a required field has no usable value.
        UnknownIntegrationError: ``integration_id`` is not in the registry.

    When the matching capability is routed through SkillRouter the gate checks
    the gateway key instead (spec §3.6). Integrations without a routable
    capability (asr / voice clone) and capabilities the user pinned to manual
    always take the original manual check.
    """
    _require_router_or_continue(integration_id)
    if _is_routed_integration(integration_id):
        return
    integration_credentials.require_loaded(integration_id)
    if integration_id == "ark_video":
        resolved = integration_credentials.resolve(integration_id)
        if not resolved.field("api_key").configured:
            raise CredentialNotConfigured(integration_id)
        validate_model_configuration({item.name: item.value for item in resolved.fields})
        return
    if not integration_credentials.is_usable(integration_id):
        raise CredentialNotConfigured(integration_id)


class VideoError(Exception):
    """视频链路的受控错误；details 必须由调用方构造白名单字段。"""

    def __init__(self, code: str, status_code: int = 422, **details) -> None:
        self.code = code
        self.status_code = status_code
        self.details = details
        super().__init__(code)


def video_error_response(error: VideoError):
    """不输出异常文本或供应商原始正文。"""
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=error.status_code, content={
        "success": False, "message": error.code, "error_code": error.code,
        "error_details": {"retryable": False, **error.details},
    })


def generation_error_response(error, capability):
    """生成提交的受控错误信封；供应商正文及签名地址不返回模型。

    A ``RouterError`` is re-raised untouched so the application-level handler in
    ``main.py`` renders its structured envelope (code, Retry-After, resets_at)
    instead of it being flattened into ``generation_submission_unknown``.
    """
    classified = classify_generation_error(error, capability)
    if not isinstance(classified, VideoError):
        raise classified
    return video_error_response(classified)


def classify_generation_error(error: Exception, capability: str) -> VideoError:
    """统一路由和后台任务的提交错误分类，仅保留受控公开字段。"""
    import re
    from json import JSONDecodeError
    from uuid import uuid4
    import httpx

    from app.services.skillrouter.errors import RouterError

    if isinstance(error, (VideoError, RouterError)):
        return error  # RouterError keeps its own structured code (spec §5.3)
    if isinstance(error, IntegrationLoadFailed):
        return VideoError("integration_load_failed", 503,
                          integration_id=error.integration_id)
    if isinstance(error, InvalidModelConfiguration):
        return VideoError("invalid_model_configuration", 422,
                          field=error.field_name, integration_id="ark_video")

    upstream = error.response if isinstance(error, httpx.HTTPStatusError) else None
    status = upstream.status_code if upstream is not None else None
    code, category = "generation_submission_unknown", "transient"
    provider_request_id = ""
    if upstream is not None:
        try:
            payload = upstream.json()
            provider_error = payload.get("error", {})
            message = str(provider_error.get("message", "")).lower()
            provider_code = str(provider_error.get("code", "")).lower()
            provider_request_id = str(provider_error.get("request_id", payload.get("request_id", "")))
        except (ValueError, AttributeError):
            message, provider_code = "", ""
        if ("endpoint" in message and
                ("currently closed" in message or "temporarily unavailable" in message)):
            code, category = "provider_unavailable", "configuration"
        elif provider_code in {"endpointnotfound", "endpointdisabled", "modelnotfound", "modelnotopen", "modelnotenabled"}:
            code, category = "provider_unavailable", "configuration"
        elif status in {401, 403}:
            code, category = "provider_authentication", "configuration"
        elif status == 429:
            code = "provider_rate_limited"
        elif "model" in message and any(term in message for term in ("not found", "not open", "not enabled", "not available", "not exist")):
            code, category = "provider_unavailable", "configuration"
        elif status in {400, 404, 422}:
            code, category = "provider_validation", "validation"
        else:
            code = "provider_error"
    elif isinstance(error, JSONDecodeError) or (
            isinstance(error, ValueError) and
            any(marker in str(error) for marker in
                ("response missing task ID", "returned no image data"))):
        category = "internal"
    elif isinstance(error, ValueError):
        code, category = "provider_validation", "validation"
    local_status = 400 if category == "validation" and upstream is None else 502
    details = {"failure_class": category, "retryable": False,
               "sticky": category != "validation", "request_id": str(uuid4()),
               "capability": capability, "local_status": local_status}
    if upstream is not None:
        details["upstream_status"] = status
        identifier = (upstream.headers.get("x-request-id") or
                      upstream.headers.get("x-tt-logid") or provider_request_id)
        if re.fullmatch(r"[\w.-]{1,128}", identifier):
            details["provider_request_id"] = identifier
        retry_after = upstream.headers.get("retry-after", "")
        if retry_after.isdigit():
            details["retry_after_seconds"] = min(int(retry_after), 86400)
        elif retry_after:
            from datetime import datetime, timezone
            from email.utils import parsedate_to_datetime
            try:
                retry_at = parsedate_to_datetime(retry_after)
                wait = (retry_at - datetime.now(timezone.utc)).total_seconds()
                details["retry_after_seconds"] = min(
                    max(0, int(wait) + 1), 86400)
            except (ValueError, TypeError, OverflowError):
                pass
    return VideoError(code, status_code=local_status, **details)
