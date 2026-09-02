"""
API routes for model settings management.

Two-layer architecture:
  - Provider CRUD: manage provider credentials
  - Assignment CRUD: assign models to features
  - Config resolution: get effective config (DB or env fallback)
"""

from fastapi import APIRouter, HTTPException

from app.models.model_settings_models import (
    ModelFunctionType,
    ModelProviderCreate,
    ModelProviderUpdate,
    ModelProviderListResponse,
    ModelAssignmentRequest,
    ModelAssignmentListResponse,
    ProvidersResponse,
    TestConnectionRequest,
    TestConnectionResponse,
    ResolvedConfigResponse,
    FetchModelsRequest,
    FetchModelsResponse,
)
from app.services.model_settings_service import model_settings_service
from app.logger import get_logger

# This router configures provider API keys and model assignments. In the
# desktop build it is reachable only from the local renderer over a loopback
# socket and there is exactly one owner, so it carries no authorization gate —
# see `docs/plans/desktop-only-refactor/spec.md` (D1). Model settings are
# process-global, not per-user, so nothing about the stored shape changed.
router = APIRouter(
    prefix="/model-settings",
    tags=["Model Settings"],
)
logger = get_logger(__name__)


# ── Provider Management ──

@router.get("/providers/known", response_model=ProvidersResponse)
async def get_known_providers():
    """Get the list of known provider types with default API URLs (static reference)."""
    providers = model_settings_service.get_providers()
    return ProvidersResponse(
        success=True,
        message=f"Retrieved {len(providers)} known providers",
        providers=providers,
    )


@router.get("/providers/saved", response_model=ModelProviderListResponse)
async def get_saved_providers():
    """Get all saved provider credentials (API keys masked)."""
    try:
        providers = await model_settings_service.get_all_providers()
        return ModelProviderListResponse(
            success=True,
            message=f"Retrieved {len(providers)} saved providers",
            providers=providers,
        )
    except Exception as e:
        logger.error(f"Error getting saved providers: {type(e).__name__}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")


@router.post("/providers")
async def create_provider(request: ModelProviderCreate):
    """Create a new provider credential."""
    try:
        provider = await model_settings_service.create_provider(request)
        return {"success": True, "message": "Provider created", "provider": provider}
    except Exception as e:
        logger.error(f"Error creating provider: {e}")
        err_str = str(e).lower()
        if "unique" in err_str or "duplicate key" in err_str:
            raise HTTPException(status_code=400, detail="A provider with this name already exists")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: str, request: ModelProviderUpdate):
    """Update a provider credential. Use '__KEEP__' for api_key to preserve existing."""
    try:
        provider = await model_settings_service.update_provider(provider_id, request)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        return {"success": True, "message": "Provider updated", "provider": provider}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating provider: {e}")
        err_str = str(e).lower()
        if "unique" in err_str or "duplicate key" in err_str:
            raise HTTPException(status_code=400, detail="A provider with this name already exists")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str):
    """Delete a provider and cascade-delete its feature assignments."""
    try:
        deleted = await model_settings_service.delete_provider(provider_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Provider not found")
        return {"success": True, "message": "Provider deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting provider: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Model Fetching ──

@router.post("/providers/{provider_id}/fetch-models", response_model=FetchModelsResponse)
async def fetch_models_for_provider(provider_id: str):
    """Fetch available models using a saved provider's credentials."""
    try:
        result = await model_settings_service.fetch_models_for_provider(provider_id)
        return result
    except Exception as e:
        logger.error(f"Error fetching models for provider {provider_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-models", response_model=FetchModelsResponse)
async def fetch_models(request: FetchModelsRequest):
    """Fetch available models with ad-hoc or provider-referenced credentials."""
    try:
        result = await model_settings_service.fetch_models(request)
        return result
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Feature Assignments ──

@router.get("/assignments", response_model=ModelAssignmentListResponse)
async def get_all_assignments():
    """Get all feature model assignments."""
    try:
        assignments = await model_settings_service.get_all_assignments()
        return ModelAssignmentListResponse(
            success=True,
            message=f"Retrieved {len(assignments)} assignments",
            assignments=assignments,
        )
    except Exception as e:
        logger.error(f"Error getting assignments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/assignments")
async def save_assignment(request: ModelAssignmentRequest):
    """Save or update a feature model assignment."""
    try:
        result = await model_settings_service.save_assignment(request)
        if not result:
            raise HTTPException(status_code=400, detail="Provider not found")
        return {"success": True, "message": "Assignment saved", "assignment": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving assignment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/assignments/{function_type}")
async def delete_assignment(function_type: ModelFunctionType):
    """Delete a feature assignment (revert to environment variable defaults)."""
    try:
        deleted = await model_settings_service.delete_assignment(function_type)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"No assignment for {function_type.value}")
        return {"success": True, "message": f"Assignment for {function_type.value} deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting assignment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Config Resolution (UNCHANGED — critical integration point) ──

@router.get("/resolve/{function_type}", response_model=ResolvedConfigResponse)
async def resolve_config(function_type: ModelFunctionType):
    """Get the effective configuration for a function type (DB assignment or env fallback)."""
    try:
        config = await model_settings_service.get_effective_config(function_type)
        return config
    except Exception as e:
        logger.error(f"Error resolving config for {function_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Connection Testing (UNCHANGED) ──

@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(request: TestConnectionRequest):
    """Test a model connection."""
    try:
        result = await model_settings_service.test_connection(request)
        return result
    except Exception as e:
        logger.error(f"Error testing connection: {e}")
        raise HTTPException(status_code=500, detail=str(e))
