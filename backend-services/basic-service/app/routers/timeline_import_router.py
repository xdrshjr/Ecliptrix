"""
Timeline Import related API routes for the Basic Service application.
"""

from fastapi import APIRouter, HTTPException, status
from typing import Union

from app.models.timeline_import_models import (
    TimelineImportRequest,
    TimelineImportResponse,
    ImportFileUploadRequest,
    TimelineImportErrorResponse
)
from app.services.timeline_import_service import TimelineImportService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/timeline", tags=["Timeline Import"])
logger = get_logger(__name__)

# Initialize service
timeline_import_service = TimelineImportService()


@router.post("/import", response_model=TimelineImportResponse)
async def import_timeline(request: TimelineImportRequest) -> Union[TimelineImportResponse, TimelineImportErrorResponse]:
    """
    导入时间轴数据从JSON格式
    
    This endpoint allows users to import timeline editing data including tracks, materials,
    and all editing information from a JSON file that was previously exported.
    
    Args:
        request (TimelineImportRequest): Timeline import parameters including timeline data and import options
    
    Returns:
        TimelineImportResponse: Import result containing processed timeline data and statistics
    
    Raises:
        HTTPException: When import fails due to validation errors or processing issues
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
            
            # 返回错误响应
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "message": result.message,
                    "validation_result": result.validation_result.dict() if result.validation_result else None,
                    "details": result.details
                }
            )
        
        logger.info("时间轴导入成功", {
            "task_id": request.task_id,
            "track_count": len(result.imported_data.timeline_state.tracks) if result.imported_data else 0,
            "material_count": len(result.imported_data.materials) if result.imported_data else 0,
            "id_mappings_count": len(result.imported_data.id_mappings) if result.imported_data else 0,
            "statistics": result.statistics
        })
        
        return result

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("时间轴导入处理异常", {
            "task_id": request.task_id if request else "unknown",
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": f"服务器内部错误: {str(e)}",
                "error_type": type(e).__name__
            }
        )


@router.post("/import/upload", response_model=TimelineImportResponse)
async def import_timeline_from_file(request: ImportFileUploadRequest) -> Union[TimelineImportResponse, TimelineImportErrorResponse]:
    """
    从上传的JSON文件导入时间轴数据
    
    This endpoint allows users to upload a JSON file containing timeline data
    and import it directly into their current editing session.
    
    Args:
        request (ImportFileUploadRequest): File upload request with JSON content and import options
    
    Returns:
        TimelineImportResponse: Import result containing processed timeline data and statistics
    
    Raises:
        HTTPException: When import fails due to file format errors or processing issues
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
            
            # 返回错误响应
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "message": result.message,
                    "validation_result": result.validation_result.dict() if result.validation_result else None,
                    "details": result.details
                }
            )
        
        logger.info("文件上传导入成功", {
            "task_id": request.task_id,
            "file_name": request.file_name,
            "track_count": len(result.imported_data.timeline_state.tracks) if result.imported_data else 0,
            "material_count": len(result.imported_data.materials) if result.imported_data else 0,
            "statistics": result.statistics
        })
        
        return result

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("文件上传导入处理异常", {
            "task_id": request.task_id if request else "unknown",
            "file_name": request.file_name if request else "unknown",
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": f"服务器内部错误: {str(e)}",
                "error_type": type(e).__name__
            }
        )


@router.post("/validate", response_model=dict)
async def validate_import_file(request: ImportFileUploadRequest) -> dict:
    """
    验证导入文件的格式和内容
    
    This endpoint allows users to validate a JSON file before importing it,
    providing detailed information about any issues or warnings.
    
    Args:
        request (ImportFileUploadRequest): File validation request with JSON content
    
    Returns:
        dict: Validation result with errors, warnings, and file statistics
    
    Raises:
        HTTPException: When validation fails due to processing issues
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
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "message": f"验证过程中发生异常: {str(e)}",
                "error_type": type(e).__name__
            }
        )