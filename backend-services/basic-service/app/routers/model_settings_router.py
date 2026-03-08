"""
API routes for model settings management.
"""

from fastapi import APIRouter, HTTPException, status

from app.models.model_settings_models import (
    ModelFunctionType,
    ModelSettingRequest,
    ModelSettingResponse,
    ModelSettingsListResponse,
    PresetModelsResponse,
    TestConnectionRequest,
    TestConnectionResponse,
    ResolvedConfigResponse,
)
from app.services.model_settings_service import model_settings_service
from app.logger import get_logger

router = APIRouter(prefix="/model-settings", tags=["Model Settings"])
logger = get_logger(__name__)


@router.get("/", response_model=ModelSettingsListResponse)
async def get_all_settings():
    """Get all saved model settings."""
    try:
        settings = await model_settings_service.get_all_settings()
        return ModelSettingsListResponse(
            success=True,
            message=f"Retrieved {len(settings)} model settings",
            settings=settings,
        )
    except Exception as e:
        logger.error(f"Error getting model settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/presets", response_model=PresetModelsResponse)
async def get_preset_models():
    """Get the list of preset models."""
    presets = model_settings_service.get_preset_models()
    return PresetModelsResponse(
        success=True,
        message=f"Retrieved {len(presets)} preset models",
        presets=presets,
    )


@router.get("/resolve/{function_type}", response_model=ResolvedConfigResponse)
async def resolve_config(function_type: ModelFunctionType):
    """Get the effective configuration for a function type (DB or env fallback)."""
    try:
        config = await model_settings_service.get_effective_config(function_type)
        return config
    except Exception as e:
        logger.error(f"Error resolving config for {function_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{function_type}", response_model=ModelSettingResponse)
async def get_setting(function_type: ModelFunctionType):
    """Get a single model setting by function type."""
    try:
        setting = await model_settings_service.get_setting(function_type)
        if not setting:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No setting found for {function_type.value}",
            )
        return setting
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting setting for {function_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/", response_model=ModelSettingResponse)
async def save_setting(request: ModelSettingRequest):
    """Save or update a model setting."""
    try:
        result = await model_settings_service.save_setting(request)
        return result
    except Exception as e:
        logger.error(f"Error saving model setting: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{function_type}")
async def delete_setting(function_type: ModelFunctionType):
    """Delete a model setting (revert to environment variable defaults)."""
    try:
        deleted = await model_settings_service.delete_setting(function_type)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No setting found for {function_type.value}",
            )
        return {"success": True, "message": f"Setting for {function_type.value} deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting setting for {function_type}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(request: TestConnectionRequest):
    """Test a model connection."""
    try:
        result = await model_settings_service.test_connection(request)
        return result
    except Exception as e:
        logger.error(f"Error testing connection: {e}")
        raise HTTPException(status_code=500, detail=str(e))
