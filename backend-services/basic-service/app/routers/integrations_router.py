"""External-service credentials API (setup-wizard-full-capability-coverage §3.5, §5).

    GET    /api/integrations            public state of every integration
    PUT    /api/integrations/{id}       save / partially update (patch semantics)
    DELETE /api/integrations/{id}       clear the app-level value (falls back to .env)
    POST   /api/integrations/{id}/test  probe the SAVED credentials

No response, log line or audit row ever contains a credential value: secret
fields only report ``configured`` (and ``count`` for lists); ``value`` is
filled for text/choice fields only.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.logger import get_logger
from app.models import ErrorResponse
from app.models.integration_models import (
    IntegrationFieldPublic,
    IntegrationListData,
    IntegrationListResponse,
    IntegrationPublic,
    IntegrationResponse,
    IntegrationSaveRequest,
    IntegrationTestData,
    IntegrationTestResponse,
)
from app.services.credential_errors import require_configured
from app.services.integration_credentials_service import (
    CredentialValidationError,
    IntegrationSaveFailed,
    ResolvedField,
    ResolvedIntegration,
    UnknownIntegrationError,
    integration_credentials,
)
from app.services.integration_probes import run_probe
from app.services.integration_registry import REGISTRY, get_spec

router = APIRouter(prefix="/integrations", tags=["Integrations"])
logger = get_logger(__name__)

_VALIDATION_STATUS = 422


def _error(
    status_code: int, code: str, message: str, details: Optional[dict] = None
) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=ErrorResponse(
        success=False, message=message, error_code=code, error_details=details,
    ).model_dump(mode="json"))


def _check_origin(request: Request) -> Optional[JSONResponse]:
    """Same UI-origin gate as the other settings writes (lazy import: see
    ``agent_vision_router`` - avoids router-to-router import cycles)."""
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import validate_ui_origin

    try:
        validate_ui_origin(request, write=True)
    except WebResearchError as error:
        return _error(error.status_code, error.error_code, error.message)
    return None


def _public_field(item: ResolvedField, max_items: int) -> IntegrationFieldPublic:
    base = dict(
        name=item.name, kind=item.kind, required=item.required,
        configured=item.configured, source=item.source,
    )
    if item.kind == "choice":
        return IntegrationFieldPublic(
            **base, value=item.value, choices=list(item.choices)
        )
    if item.kind == "text":
        return IntegrationFieldPublic(**base, value=item.value or None)
    if item.kind == "secret_list":
        return IntegrationFieldPublic(**base, count=item.count, max_items=max_items)
    return IntegrationFieldPublic(**base)


def to_public(resolved: ResolvedIntegration) -> IntegrationPublic:
    """Convert a resolver result into the zero-secret wire shape."""
    spec = get_spec(resolved.id)
    limits = {item.name: item.max_items for item in spec.fields}
    return IntegrationPublic(
        id=resolved.id,
        capabilities=list(spec.capabilities),
        verify_level=spec.verify_level,
        usable=resolved.usable,
        source=resolved.source,
        fields=[_public_field(item, limits[item.name]) for item in resolved.fields],
    )


def _unknown(error: UnknownIntegrationError) -> JSONResponse:
    return _error(404, "unknown_integration", "Unknown integration.",
                  {"integration_id": error.integration_id})


@router.get("", response_model=IntegrationListResponse)
async def list_integrations() -> IntegrationListResponse:
    """Public state of every integration (no secrets)."""
    items = [to_public(integration_credentials.resolve(spec.id)) for spec in REGISTRY]
    return IntegrationListResponse(success=True, data=IntegrationListData(
        integrations=items, load_failed=integration_credentials.load_failed,
    ))


@router.put("/{integration_id}", response_model=IntegrationResponse)
async def save_integration(
    integration_id: str, body: IntegrationSaveRequest, request: Request
):
    """Validate and store a partial update; the new value is live immediately."""
    rejected = _check_origin(request)
    if rejected is not None:
        return rejected
    try:
        resolved = await integration_credentials.save(integration_id, body.fields)
    except UnknownIntegrationError as error:
        return _unknown(error)
    except CredentialValidationError as error:
        return _error(
            _VALIDATION_STATUS, error.code,
            "The credential was rejected.", {"field": error.field_name},
        )
    except IntegrationSaveFailed:
        return _error(500, "integration_save_failed",
                      "Could not save the credential. Please try again.")
    return IntegrationResponse(success=True, data=to_public(resolved))


@router.delete("/{integration_id}", response_model=IntegrationResponse)
async def clear_integration(integration_id: str, request: Request):
    """Remove the app-level value; the environment baseline applies again."""
    rejected = _check_origin(request)
    if rejected is not None:
        return rejected
    try:
        resolved = await integration_credentials.clear(integration_id)
    except UnknownIntegrationError as error:
        return _unknown(error)
    except IntegrationSaveFailed:
        return _error(500, "integration_save_failed",
                      "Could not clear the credential. Please try again.")
    return IntegrationResponse(success=True, data=to_public(resolved))


@router.post("/{integration_id}/test", response_model=IntegrationTestResponse)
async def test_integration(integration_id: str, request: Request):
    """Probe the saved credentials. ``success`` means the probe ran, not that
    the credentials are valid - read ``data.outcome`` for that."""
    rejected = _check_origin(request)
    if rejected is not None:
        return rejected
    try:
        require_configured(integration_id)
        report = await run_probe(integration_id)
    except UnknownIntegrationError as error:
        return _unknown(error)
    return IntegrationTestResponse(success=True, data=IntegrationTestData(
        outcome=report.outcome, verify_level=report.verify_level,
        elapsed_ms=report.elapsed_ms,
    ))
