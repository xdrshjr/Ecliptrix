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

CREDENTIAL_NOT_CONFIGURED = "credential_not_configured"
NOT_CONFIGURED_STATUS = 409

_MESSAGES = {
    "volcano_tts": "Speech synthesis is not configured.",
    "volcano_asr": "Speech recognition (subtitles) is not configured.",
    "volcano_voice_clone": "Voice cloning is not configured.",
    "ark": "AI image/video generation (Volcano Ark) is not configured.",
    "pexels": "The Pexels video library is not configured.",
    "unsplash": "The Unsplash image library is not configured.",
    "freesound": "The Freesound sound library is not configured.",
}


class CredentialNotConfigured(Exception):
    """A feature was requested whose required credentials are missing."""

    def __init__(self, integration_id: str) -> None:
        self.integration_id = integration_id
        self.message = (
            f"{_MESSAGES.get(integration_id, 'This service is not configured.')} "
            "Open Settings -> Services & asset libraries to set it up."
        )
        super().__init__(self.message)


def require_configured(integration_id: str) -> None:
    """Raise :class:`CredentialNotConfigured` unless the integration is usable.

    Raises:
        CredentialNotConfigured: a required field has no usable value.
        UnknownIntegrationError: ``integration_id`` is not in the registry.
    """
    if not integration_credentials.is_usable(integration_id):
        raise CredentialNotConfigured(integration_id)


def generation_error_response(error, capability):
    """生成提交的受控错误信封；供应商正文及签名地址不返回模型。"""
    import re
    from json import JSONDecodeError
    from uuid import uuid4
    import httpx
    from fastapi.responses import JSONResponse

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
        elif provider_code in {"endpointnotfound", "endpointdisabled"}:
            code, category = "provider_unavailable", "configuration"
        elif status in {401, 403}:
            code, category = "provider_authentication", "configuration"
        elif status == 429:
            code = "provider_rate_limited"
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
    return JSONResponse(status_code=local_status, content={
        "success": False, "message": code, "error_code": code,
        "error_details": details,
    })
