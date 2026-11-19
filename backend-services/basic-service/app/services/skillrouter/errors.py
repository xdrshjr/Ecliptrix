"""``RouterError`` and the gateway-code -> Ecliptrix error-code table (spec §5.3).

Error codes are API: once shipped they are never renamed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

#: gateway code -> (ecliptrix error_code, http status)
_CODE_TABLE: Dict[str, Tuple[str, int]] = {
    "authentication_error": ("router_key_invalid", 409),
    "capability_disabled": ("router_capability_denied", 403),
    "tier_denied": ("router_capability_denied", 403),
    "capability_not_configured": ("router_capability_unavailable", 503),
    "capability_unavailable": ("router_capability_unavailable", 503),
    "quota_exceeded": ("router_quota_exceeded", 429),
    "too_many_inflight": ("router_busy", 429),
    "too_many_jobs": ("router_busy", 429),
    "upstream_rate_limited": ("router_busy", 429),
    "probe_throttled": ("router_busy", 429),
    "content_rejected": ("content_rejected", 422),
    "invalid_request": ("router_invalid_request", 422),
    "text_too_long": ("router_invalid_request", 422),
    "request_too_large": ("router_invalid_request", 422),
    "unsupported_media": ("router_invalid_request", 422),
    "invalid_cursor": ("router_invalid_request", 422),
    "upstream_unavailable": ("router_upstream_error", 502),
    "invalid_provider_response": ("router_upstream_error", 502),
    "egress_unavailable": ("router_upstream_error", 502),
    "upstream_timeout": ("router_upstream_error", 504),
    "not_found": ("router_not_found", 404),
    "submission_unknown": ("generation_submission_unknown", 502),
}

#: errors raised locally (never a gateway code)
LOCAL_CODES: Dict[str, Tuple[str, int]] = {
    "router_unreachable": ("router_unreachable", 502),
    "models_unavailable": ("router_models_unavailable", 503),
    "router_key_missing": ("credential_not_configured", 409),
    "router_bad_response": ("router_upstream_error", 502),
    "router_redirect_blocked": ("router_upstream_error", 502),
    "router_asset_too_large": ("router_invalid_request", 422),
}

_ALL_CODES = {**_CODE_TABLE, **LOCAL_CODES}
_RETRYABLE = frozenset({"router_busy", "router_upstream_error", "router_unreachable"})


@dataclass
class RouterError(Exception):
    """A gateway or transport failure. ``message`` never contains a credential."""

    code: str
    http_status: int = 502
    message: str = ""
    retry_after: Optional[int] = None
    details: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(f"{self.code}: {self.message}")

    @property
    def error_code(self) -> str:
        return _ALL_CODES.get(self.code, ("router_upstream_error", 502))[0]

    @property
    def response_status(self) -> int:
        return _ALL_CODES.get(self.code, ("router_upstream_error", 502))[1]

    @property
    def is_retryable(self) -> bool:
        return self.error_code in _RETRYABLE

    def public_details(self) -> Dict[str, Any]:
        """Whitelisted details for the ErrorResponse envelope."""
        details: Dict[str, Any] = {
            "gateway_code": self.code,
            "retryable": self.is_retryable,
        }
        if self.retry_after is not None:
            details["retry_after_seconds"] = self.retry_after
        for key in ("resets_at", "capability", "suggest"):
            if key in self.details:
                details[key] = self.details[key]
        return details


def from_gateway(
    code: str, http_status: int, message: str,
    retry_after: Optional[int] = None, details: Optional[Dict[str, Any]] = None,
) -> RouterError:
    """Build a RouterError from a gateway ``{error:{code,message}}`` envelope."""
    return RouterError(code or "upstream_unavailable", http_status,
                       (message or "")[:300], retry_after, details or {})
