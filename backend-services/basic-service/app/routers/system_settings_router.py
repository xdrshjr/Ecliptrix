"""
API routes for system settings management.

All endpoints require admin authentication (is_admin=True or is_root=True).
The authenticated user's username is recorded in audit logs.

Prefix: /api/system-settings (registered in main.py with prefix="/api")
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import LOCAL_OWNER_NAME
from app.database import get_db_session
from app.models.db_models import SettingsAuditLog
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
        name="agent_vision",
        label="视觉审阅",
        description="图像来源、视觉模型出口、成品探测、缓存与限额",
    ),
    SettingsCategoryInfo(
        name="agent_toolkit",
        label="Agent 能力",
        description="工作区、文档、计算分析、长期记忆",
    ),
    SettingsCategoryInfo(name="web_research", label="网络与研究", description="搜索、浏览、下载与资料整理"),
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
    value, default_value = resp.value, resp.default_value
    if getattr(resp, "category", None) == "web_research" and resp.key == "tavily_api_keys":
        from app.services.web_research.web_search_service import get_web_search_service
        keys = get_web_search_service()._api_keys()
        value = {"configured": bool(keys), "key_count": len(keys)}
        default_value = None
    return SystemSettingResponse(
        key=resp.key,
        value=value,
        default_value=default_value,
        value_type=resp.value_type,
        description=resp.description,
        updated_at=resp.updated_at,
        updated_by=resp.updated_by,
    )


# ── Endpoints ──


@router.get("/categories", response_model=CategoriesListResponse)
async def list_categories(
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
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")


@router.get("/{category}", response_model=CategorySettingsResponse)
async def get_category_settings(
    category: str,
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
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")


@router.put("/{category}/{key}")
async def update_setting(
    category: str,
    key: str,
    request: UpdateSettingRequest,
    http_request: Request,
):
    """Update a single setting value. The authenticated user is recorded for audit."""
    _validate_category(category)
    if category == "web_research":
        from .research_run_router import validate_ui_origin
        validate_ui_origin(http_request, write=True)
        if key == "tavily_api_keys":
            raise HTTPException(status_code=400, detail="use_credentials_endpoint")
    try:
        validate_setting_payload(category, key, request.value)
    except ValidationError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'key': key,
                'errors': ve.errors(include_input=False, include_context=False),
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
            updated_by=LOCAL_OWNER_NAME,
        )
        return {
            "success": True,
            "message": "Setting updated",
            "setting": _service_response_to_api(result),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")


@router.put("/{category}")
async def batch_update_settings(
    category: str,
    request: BatchUpdateSettingsRequest,
    http_request: Request,
):
    """Batch-update multiple settings within a category."""
    _validate_category(category)
    if category == "web_research":
        from .research_run_router import validate_ui_origin
        validate_ui_origin(http_request, write=True)
        if "tavily_api_keys" in request.settings:
            raise HTTPException(status_code=400, detail="use_credentials_endpoint")
    try:
        for key, value in request.settings.items():
            validate_setting_payload(category, key, value)
    except ValidationError as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'errors': ve.errors(include_input=False, include_context=False),
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
            updated_by=LOCAL_OWNER_NAME,
        )
        return {
            "success": True,
            "message": f"Updated {len(results)} settings in {category}",
            "settings": [_service_response_to_api(r) for r in results],
        }
    except Exception as e:
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")


@router.post("/{category}/reset")
async def reset_category(
    category: str,
    http_request: Request,
):
    """Reset all settings in a category to their factory default values."""
    _validate_category(category)
    if category == "web_research":
        from .research_run_router import validate_ui_origin
        validate_ui_origin(http_request, write=True)
    try:
        results = await system_settings_service.reset_to_defaults(
            category=category,
            updated_by=LOCAL_OWNER_NAME,
        )
        return {
            "success": True,
            "message": f"Category {category} reset to defaults",
            "settings": [_service_response_to_api(r) for r in results],
        }
    except Exception as e:
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")


@router.post("/reset-all")
async def reset_all(
    http_request: Request,
):
    """Reset ALL settings across all categories to their factory default values."""
    from .research_run_router import validate_ui_origin
    validate_ui_origin(http_request, write=True)
    try:
        await system_settings_service.reset_all_to_defaults(
            updated_by=LOCAL_OWNER_NAME,
        )
        return {
            "success": True,
            "message": "All settings reset to defaults",
        }
    except Exception as e:
        logger.error("System settings operation failed")
        raise HTTPException(status_code=500, detail="settings_operation_failed")
