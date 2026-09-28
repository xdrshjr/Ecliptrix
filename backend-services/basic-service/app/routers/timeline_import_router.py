"""
Timeline Import related API routes for the Basic Service application.
"""

from typing import Any, Dict, Union

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.models.base_models import ErrorResponse
from app.models.video_cover_v2_models import CoverError
from app.models.timeline_import_models import (
    TimelineImportRequest,
    TimelineImportResponse,
    ImportFileUploadRequest,
)
from app.services.timeline_import_service import TimelineImportService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/timeline", tags=["Timeline Import"])
logger = get_logger(__name__)

# Initialize service
timeline_import_service = TimelineImportService()

TIMELINE_IMPORT_INVALID = "TIMELINE_IMPORT_INVALID"
TIMELINE_IMPORT_INTERNAL = "TIMELINE_IMPORT_INTERNAL"


def _error_response(
    status_code: int,
    message: str,
    error_code: str,
    error_details: Dict[str, Any],
) -> JSONResponse:
    """
    Answer with the shared ErrorResponse body.

    ``HTTPException(detail=dict)`` made the frontend show a Python dict as
    the error text (AM2-03); a flat ``error_code`` lets it pick a localized
    message instead.
    """
    body = ErrorResponse(
        success=False,
        message=message,
        error_code=error_code,
        error_details=error_details,
    )
    return JSONResponse(
        status_code=status_code, content=body.model_dump(mode="json")
    )


def _invalid_import_response(result: TimelineImportResponse) -> JSONResponse:
    """400 for an import the service rejected, listing its validation errors."""
    errors = result.validation_result.errors if result.validation_result else []
    details: Dict[str, Any] = {"errors": list(errors)}
    if result.details:
        details["details"] = result.details
    return _error_response(
        status.HTTP_400_BAD_REQUEST,
        result.message,
        TIMELINE_IMPORT_INVALID,
        details,
    )


def _internal_error_response(message: str, error: Exception) -> JSONResponse:
    """500 without the exception text (it may contain local paths; it is logged)."""
    return _error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        message,
        TIMELINE_IMPORT_INTERNAL,
        {"error_type": type(error).__name__},
    )


@router.post("/import", response_model=TimelineImportResponse)
async def import_timeline(
    request: TimelineImportRequest,
) -> Union[TimelineImportResponse, JSONResponse]:
    """
    导入时间轴数据从JSON格式

    This endpoint allows users to import timeline editing data including tracks, materials,
    and all editing information from a JSON file that was previously exported.

    Args:
        request (TimelineImportRequest): Timeline import parameters including timeline data and import options

    Returns:
        TimelineImportResponse: Import result containing processed timeline data and statistics;
        an ErrorResponse (400 TIMELINE_IMPORT_INVALID / 500 TIMELINE_IMPORT_INTERNAL) on failure
    """
    try:
        logger.info("收到时间轴导入请求", {
            "task_id": request.task_id,
            "merge_mode": request.merge_mode,
            "preserve_ids": request.preserve_ids,
            "endpoint": "/timeline/import"
        })

        # 调用服务进行导入
        result = await timeline_import_service.import_timeline_from_json(request)

        if not result.success:
            logger.error("时间轴导入失败", {
                "task_id": request.task_id,
                "error_message": result.message,
                "validation_errors": result.validation_result.errors if result.validation_result else None
            })
            return _invalid_import_response(result)

        logger.info("时间轴导入成功", {
            "task_id": request.task_id,
            "track_count": len(result.imported_data.timeline_state.tracks) if result.imported_data else 0,
            "material_count": len(result.imported_data.materials) if result.imported_data else 0,
            "id_mappings_count": len(result.imported_data.id_mappings) if result.imported_data else 0,
            "statistics": result.statistics
        })

        return result

    except CoverError as exc:
        return _error_response(exc.status, str(exc), exc.code, exc.details)
    except Exception as e:
        logger.error("时间轴导入处理异常", {
            "task_id": request.task_id if request else "unknown",
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        return _internal_error_response("时间轴导入时服务器内部错误", e)


@router.post("/import/upload", response_model=TimelineImportResponse)
async def import_timeline_from_file(
    request: ImportFileUploadRequest,
) -> Union[TimelineImportResponse, JSONResponse]:
    """
    从上传的JSON文件导入时间轴数据

    This endpoint allows users to upload a JSON file containing timeline data
    and import it directly into their current editing session.

    Args:
        request (ImportFileUploadRequest): File upload request with JSON content and import options

    Returns:
        TimelineImportResponse: Import result containing processed timeline data and statistics;
        an ErrorResponse (400 TIMELINE_IMPORT_INVALID / 500 TIMELINE_IMPORT_INTERNAL) on failure
    """
    try:
        logger.info("收到文件上传导入请求", {
            "task_id": request.task_id,
            "file_name": request.file_name,
            "file_size": len(request.file_content),
            "merge_mode": request.merge_mode,
            "preserve_ids": request.preserve_ids,
            "endpoint": "/timeline/import/upload"
        })

        # 调用服务处理文件上传导入
        result = await timeline_import_service.process_file_upload(request)

        if not result.success:
            logger.error("文件上传导入失败", {
                "task_id": request.task_id,
                "file_name": request.file_name,
                "error_message": result.message,
                "validation_errors": result.validation_result.errors if result.validation_result else None
            })
            return _invalid_import_response(result)

        logger.info("文件上传导入成功", {
            "task_id": request.task_id,
            "file_name": request.file_name,
            "track_count": len(result.imported_data.timeline_state.tracks) if result.imported_data else 0,
            "material_count": len(result.imported_data.materials) if result.imported_data else 0,
            "statistics": result.statistics
        })

        return result

    except CoverError as exc:
        return _error_response(exc.status, str(exc), exc.code, exc.details)
    except Exception as e:
        logger.error("文件上传导入处理异常", {
            "task_id": request.task_id if request else "unknown",
            "file_name": request.file_name if request else "unknown",
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        return _internal_error_response("时间轴文件导入时服务器内部错误", e)


@router.post("/validate", response_model=dict)
async def validate_import_file(
    request: ImportFileUploadRequest,
) -> Union[dict, JSONResponse]:
    """
    验证导入文件的格式和内容

    This endpoint allows users to validate a JSON file before importing it,
    providing detailed information about any issues or warnings.

    Args:
        request (ImportFileUploadRequest): File validation request with JSON content

    Returns:
        dict: Validation result with errors, warnings, and file statistics;
        an ErrorResponse (500 TIMELINE_IMPORT_INTERNAL) when validation itself crashes
    """
    try:
        logger.info("收到文件验证请求", {
            "task_id": request.task_id,
            "file_name": request.file_name,
            "file_size": len(request.file_content),
            "endpoint": "/timeline/validate"
        })

        # 调用服务进行文件验证
        validation_result = await timeline_import_service.validate_import_file(
            request.file_content,
            request.task_id
        )

        logger.info("文件验证完成", {
            "task_id": request.task_id,
            "file_name": request.file_name,
            "is_valid": validation_result.is_valid,
            "error_count": len(validation_result.errors),
            "warning_count": len(validation_result.warnings)
        })

        return {
            "success": True,
            "message": "文件验证完成",
            "validation_result": validation_result.dict()
        }

    except Exception as e:
        logger.error("文件验证处理异常", {
            "task_id": request.task_id if request else "unknown",
            "file_name": request.file_name if request else "unknown",
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        return _internal_error_response("验证导入文件时服务器内部错误", e)
