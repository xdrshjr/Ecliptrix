"""SkillRouter gateway settings API (docs/plans/skillrouter-capability-gateway §5.1).

    GET    /api/skillrouter            public state (zero secrets)
    PUT    /api/skillrouter            patch mode / key / base URL / overrides / slot models
    DELETE /api/skillrouter            clear the key and fall back to manual mode
    POST   /api/skillrouter/verify     zero-cost check against GET /capabilities
    POST   /api/skillrouter/test-slot  minimal chat request for one LLM slot
    GET    /api/skillrouter/catalog    models + capabilities (+ per-slot defaults)
    GET    /api/skillrouter/usage      quota summary (thin view of the catalogue)

No response, log line or audit row ever contains the gateway key.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.logger import get_logger
from app.models import ErrorResponse
from app.models.skillrouter_models import (
    SkillRouterCatalogData, SkillRouterCatalogResponse, SkillRouterStatusResponse,
    SkillRouterTestSlotData, SkillRouterTestSlotRequest, SkillRouterTestSlotResponse,
    SkillRouterUpdateRequest, SkillRouterUsageResponse, SkillRouterVerifyData,
    SkillRouterVerifyRequest, SkillRouterVerifyResponse,
)
from app.services.integration_credentials_service import (
    CredentialValidationError, IntegrationSaveFailed,
)
from app.services.skillrouter import settings_service
from app.services.skillrouter.errors import RouterError

router = APIRouter(prefix="/skillrouter", tags=["SkillRouter"])
logger = get_logger(__name__)

_VALIDATION_STATUS = 422


def _error(status: int, code: str, message: str, details: Optional[dict] = None,
           headers: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(status_code=status, headers=headers, content=ErrorResponse(
        success=False, message=message, error_code=code, error_details=details,
    ).model_dump(mode="json"))


def router_error_response(error: RouterError) -> JSONResponse:
    """The shared ErrorResponse envelope for a gateway failure (also used by main.py)."""
    headers = ({"Retry-After": str(error.retry_after)}
               if error.retry_after is not None else None)
    if error.error_code == "credential_not_configured":
        return _error(409, "credential_not_configured", error.message,
                      {"integration_id": "skillrouter"}, headers)
    return _error(error.response_status, error.error_code, error.message,
                  error.public_details(), headers)


def _check_origin(request: Request) -> Optional[JSONResponse]:
    """Same UI-origin gate as every other settings write."""
    from app.models.web_research_models import WebResearchError
    from app.routers.research_run_router import validate_ui_origin

    try:
        validate_ui_origin(request, write=True)
    except WebResearchError as error:
        return _error(error.status_code, error.error_code, error.message)
    return None


def _rejected(error: CredentialValidationError) -> JSONResponse:
    return _error(_VALIDATION_STATUS, error.code, "The value was rejected.",
                  {"field": error.field_name})


@router.get("", response_model=SkillRouterStatusResponse)
async def get_status() -> SkillRouterStatusResponse:
    """Public routing state (no secrets). May start a silent background
    re-verification (router mode + saved key only); the response never waits."""
    status = settings_service.build_status()
    settings_service.schedule_revalidation()
    return SkillRouterStatusResponse(success=True, data=status)


@router.put("", response_model=SkillRouterStatusResponse)
async def update_settings(body: SkillRouterUpdateRequest, request: Request):
    """Patch the routing configuration; ``mode='router'`` needs a saved or submitted key."""
    if (rejected := _check_origin(request)) is not None:
        return rejected
    try:
        status = await settings_service.apply_update(body)
    except CredentialValidationError as error:
        return _rejected(error)
    except IntegrationSaveFailed:
        return _error(500, "integration_save_failed", "Could not save. Please try again.")
    return SkillRouterStatusResponse(success=True, data=status)


@router.delete("", response_model=SkillRouterStatusResponse)
async def clear_key(request: Request):
    """Clear the key and switch to manual; other fields are kept for a quick restore."""
    if (rejected := _check_origin(request)) is not None:
        return rejected
    try:
        status = await settings_service.clear_key()
    except IntegrationSaveFailed:
        return _error(500, "integration_save_failed", "Could not clear the key. Please try again.")
    return SkillRouterStatusResponse(success=True, data=status)


@router.post("/verify", response_model=SkillRouterVerifyResponse)
async def verify(body: SkillRouterVerifyRequest, request: Request):
    """Verify the saved (or submitted, never stored) key. ``success`` means the check
    ran - read ``data.outcome`` for the verdict."""
    if (rejected := _check_origin(request)) is not None:
        return rejected
    try:
        result = await settings_service.verify(body)
    except CredentialValidationError as error:
        return _rejected(error)
    except RouterError as error:
        return router_error_response(error)
    return SkillRouterVerifyResponse(success=True, data=SkillRouterVerifyData(**result))


@router.post("/test-slot", response_model=SkillRouterTestSlotResponse)
async def test_slot(body: SkillRouterTestSlotRequest, request: Request):
    """Send a minimal chat request for one LLM slot through the gateway."""
    if (rejected := _check_origin(request)) is not None:
        return rejected
    try:
        result = await settings_service.test_slot(body.slot)
    except CredentialValidationError as error:
        return _rejected(error)
    except RouterError as error:
        return router_error_response(error)
    return SkillRouterTestSlotResponse(success=True, data=SkillRouterTestSlotData(**result))


@router.get("/catalog", response_model=SkillRouterCatalogResponse)
async def get_catalog(refresh: int = 0):
    """Gateway models and capabilities (cached 60 s; ``refresh=1`` forces a fetch)."""
    view = await settings_service.catalog_view(bool(refresh))
    return SkillRouterCatalogResponse(success=True, data=SkillRouterCatalogData(**view))


@router.get("/usage", response_model=SkillRouterUsageResponse)
async def get_usage():
    """Quota summary per gateway capability."""
    return SkillRouterUsageResponse(success=True, data=await settings_service.usage_view())
