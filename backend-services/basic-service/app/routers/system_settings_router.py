"""
API routes for system settings management.

All endpoints require admin authentication (is_admin=True or is_root=True).
The authenticated user's username is recorded in audit logs.

Prefix: /api/system-settings (registered in main.py with prefix="/api")
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.auth import require_admin
from app.database import get_db_session
from app.models.db_models import User, SettingsAuditLog
from app.models.system_settings_models import (
    SettingsCategoryInfo,
    SystemSettingResponse,
    CategorySettingsResponse,
    CategoriesListResponse,
    UpdateSettingRequest,
    BatchUpdateSettingsRequest,
    AuditLogEntry,
    AuditLogResponse,
    validate_setting_payload,
)
from app.services.system_settings_service import system_settings_service
from app.logger import get_logger

router = APIRouter(prefix="/system-settings", tags=["System Settings"])
logger = get_logger(__name__)


# ── Static category metadata ──
# This list defines the known categories and their human-readable labels.
# It must stay in sync with the YAML_TO_DB_MAPPING in system_settings_service.py.

CATEGORY_METADATA: list[SettingsCategoryInfo] = [
    SettingsCategoryInfo(
        name="tts",
        label="TTS 语音合成",
        description="批量TTS并发、重试、声音列表配置",
    ),
    SettingsCategoryInfo(
        name="youtube",
        label="YouTube",
        description="下载/上传/质量配置",
    ),
    SettingsCategoryInfo(
        name="upload",
        label="文件上传",
        description="上传并发、大小限制、缩略图配置",
    ),
    SettingsCategoryInfo(
        name="watermark",
        label="水印移除",
        description="水印移除并发和日志配置",
    ),
    SettingsCategoryInfo(
        name="video_analysis",
        label="视频分析",
        description="队列、VLM、帧提取配置",
    ),
]

# Quick lookup set for validating category names in path params
_VALID_CATEGORIES = {c.name for c in CATEGORY_METADATA}


def _validate_category(category: str) -> None:
    """Raise 404 if the category name is not recognized."""
    if category not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown settings category: {category}. "
                   f"Valid categories: {', '.join(sorted(_VALID_CATEGORIES))}",
        )


def _service_response_to_api(resp) -> SystemSettingResponse:
    """Convert a SystemSettingInternal from the service layer to the API Pydantic model.

    The service layer has its own SystemSettingInternal (with extra fields like id, category).
    The API model is a slimmed-down version exposing only key-level data.
    """
    return SystemSettingResponse(
        key=resp.key,
        value=resp.value,
        default_value=resp.default_value,
        value_type=resp.value_type,
        description=resp.description,
        updated_at=resp.updated_at,
        updated_by=resp.updated_by,
    )


# ── Endpoints ──


@router.get("/categories", response_model=CategoriesListResponse)
async def list_categories(
    admin_user: User = Depends(require_admin),
):
    """List all available settings categories with labels and descriptions."""
    return CategoriesListResponse(
        success=True,
        categories=CATEGORY_METADATA,
    )


@router.get("/audit-log", response_model=AuditLogResponse)
async def get_audit_log(
    category: Optional[str] = Query(None, description="Filter by category"),
    limit: int = Query(50, ge=1, le=500, description="Max entries to return"),
    offset: int = Query(0, ge=0, description="Number of entries to skip"),
    admin_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
):
    """Query the settings audit log with optional category filter and pagination."""
    try:
        # Build count query
        count_stmt = select(func.count(SettingsAuditLog.id))
        if category:
            count_stmt = count_stmt.where(SettingsAuditLog.category == category)
        count_result = await db.execute(count_stmt)
        total = count_result.scalar() or 0

        # Build data query
        data_stmt = (
            select(SettingsAuditLog)
            .order_by(SettingsAuditLog.changed_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if category:
            data_stmt = data_stmt.where(SettingsAuditLog.category == category)

        result = await db.execute(data_stmt)
        rows = result.scalars().all()

        logs = [
            AuditLogEntry(
                id=str(row.id),
                setting_type=row.setting_type,
                category=row.category,
                key=row.key,
                action=row.action,
                changed_by=row.changed_by,
                changed_at=row.changed_at.isoformat() if row.changed_at else "",
            )
            for row in rows
        ]

        return AuditLogResponse(success=True, logs=logs, total=total)

    except Exception as e:
        logger.error(f"Error querying audit log: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{category}", response_model=CategorySettingsResponse)
async def get_category_settings(
    category: str,
    admin_user: User = Depends(require_admin),
):
    """Get all settings within a category (with values, defaults, and metadata)."""
    _validate_category(category)
    try:
        service_responses = await system_settings_service.get_settings_by_category(category)
        settings = [_service_response_to_api(r) for r in service_responses]
        return CategorySettingsResponse(
            success=True,
            category=category,
            settings=settings,
        )
    except Exception as e:
        logger.error(f"Error getting settings for category '{category}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{category}/{key}")
async def update_setting(
    category: str,
    key: str,
    request: UpdateSettingRequest,
    admin_user: User = Depends(require_admin),
):
    """Update a single setting value. The authenticated user is recorded for audit."""
    _validate_category(category)
    try:
        validate_setting_payload(category, key, request.value)
    except ValidationError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'key': key,
                'errors': ve.errors(),
            },
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'key': key,
                'errors': [{'msg': str(ve)}],
            },
        )
    try:
        result = await system_settings_service.update_setting(
            category=category,
            key=key,
            value=request.value,
            updated_by=admin_user.username,
        )
        return {
            "success": True,
            "message": "Setting updated",
            "setting": _service_response_to_api(result),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating setting {category}.{key}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{category}")
async def batch_update_settings(
    category: str,
    request: BatchUpdateSettingsRequest,
    admin_user: User = Depends(require_admin),
):
    """Batch-update multiple settings within a category."""
    _validate_category(category)
    try:
        for key, value in request.settings.items():
            validate_setting_payload(category, key, value)
    except ValidationError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'errors': ve.errors(),
            },
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'errors': [{'msg': str(ve)}],
            },
        )
    try:
        results = await system_settings_service.update_category(
            category=category,
            settings=request.settings,
            updated_by=admin_user.username,
        )
        return {
            "success": True,
            "message": f"Updated {len(results)} settings in {category}",
            "settings": [_service_response_to_api(r) for r in results],
        }
    except Exception as e:
        logger.error(f"Error batch-updating category '{category}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{category}/reset")
async def reset_category(
    category: str,
    admin_user: User = Depends(require_admin),
):
    """Reset all settings in a category to their factory default values."""
    _validate_category(category)
    try:
        results = await system_settings_service.reset_to_defaults(
            category=category,
            updated_by=admin_user.username,
        )
        return {
            "success": True,
            "message": f"Category {category} reset to defaults",
            "settings": [_service_response_to_api(r) for r in results],
        }
    except Exception as e:
        logger.error(f"Error resetting category '{category}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset-all")
async def reset_all(
    admin_user: User = Depends(require_admin),
):
    """Reset ALL settings across all categories to their factory default values."""
    try:
        await system_settings_service.reset_all_to_defaults(
            updated_by=admin_user.username,
        )
        return {
            "success": True,
            "message": "All settings reset to defaults",
        }
    except Exception as e:
        logger.error(f"Error resetting all settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
