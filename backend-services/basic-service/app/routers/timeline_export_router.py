"""
Timeline Export related API routes for the Basic Service application.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pathlib import Path
from typing import Union

from app.models import (
    TimelineExportRequest,
    TimelineExportResponse,
    TimelineExportErrorResponse
)
from app.services import TimelineExportService
from app.logger import get_logger

# Initialize router and logger
router = APIRouter(prefix="/timeline", tags=["Timeline Export"])
logger = get_logger(__name__)

# Initialize service
timeline_export_service = TimelineExportService()


@router.post("/export", response_model=TimelineExportResponse)
async def export_timeline(request: TimelineExportRequest) -> Union[TimelineExportResponse, TimelineExportErrorResponse]:
    """
    导出时间轴数据为JSON文件
    
    This endpoint allows users to export their timeline editing data including tracks, materials,
    and all editing information to a JSON file for backup or sharing purposes.
    
    Args:
        request (TimelineExportRequest): Timeline export parameters including timeline state and materials
    
    Returns:
        TimelineExportResponse: Export result containing download URL and file information
    
    Raises:
        HTTPException: When export fails due to validation errors or processing issues
    """
    try:
        logger.info("收到时间轴导出请求", {
            "task_id": request.task_id,
            "track_count": len(request.timeline_state.tracks) if request.timeline_state else 0,
            "material_count": len(request.materials),
            "endpoint": "/timeline/export"
        })

        # 调用服务进行导出
        result = await timeline_export_service.export_timeline_to_json(request)
        
        if not result.success:
            logger.error("时间轴导出失败", {
                "task_id": request.task_id,
                "error_message": result.message,
                "details": result.details
            })
            
            # 返回错误响应
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "success": False,
                    "message": result.message,
                    "details": result.details
                }
            )
        
        logger.info("时间轴导出成功", {
            "task_id": request.task_id,
            "file_name": result.file_name,
            "download_url": result.download_url,
            "file_details": result.details
        })
        
        return result

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("时间轴导出处理异常", {
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


@router.get("/export/download/{file_name}")
async def download_timeline_export(file_name: str) -> FileResponse:
    """
    下载导出的时间轴JSON文件
    
    This endpoint provides direct file download for exported timeline JSON files.
    
    Args:
        file_name (str): Name of the exported file to download
    
    Returns:
        FileResponse: The requested JSON file
    
    Raises:
        HTTPException: When file is not found or access is denied
    """
    try:
        logger.info("收到文件下载请求", {
            "file_name": file_name,
            "endpoint": "/timeline/export/download"
        })

        # 验证文件名格式（安全检查）
        if not file_name.endswith('.json') or not file_name.startswith('timeline_export_'):
            logger.error("无效的文件名格式", {
                "file_name": file_name,
                "expected_prefix": "timeline_export_",
                "expected_suffix": ".json"
            })
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无效的文件名格式"
            )

        # 构建文件路径
        export_dir = Path("static/timeline_exports")
        file_path = export_dir / file_name
        
        # 检查文件是否存在
        if not file_path.exists():
            logger.error("请求的文件不存在", {
                "file_name": file_name,
                "file_path": str(file_path)
            })
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="请求的文件不存在"
            )
        
        # 检查文件是否在允许的目录内（安全检查）
        if not file_path.resolve().is_relative_to(export_dir.resolve()):
            logger.error("文件路径安全检查失败", {
                "file_name": file_name,
                "file_path": str(file_path),
                "export_dir": str(export_dir)
            })
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="文件访问被拒绝"
            )

        logger.info("开始文件下载", {
            "file_name": file_name,
            "file_path": str(file_path),
            "file_size": file_path.stat().st_size
        })
        
        return FileResponse(
            path=str(file_path),
            filename=file_name,
            media_type='application/json'
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("文件下载处理异常", {
            "file_name": file_name,
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"服务器内部错误: {str(e)}"
        )


@router.delete("/export/cleanup")
async def cleanup_old_exports(max_age_hours: int = 24) -> dict:
    """
    清理过期的导出文件
    
    This endpoint allows cleanup of old exported timeline files to manage storage space.
    
    Args:
        max_age_hours (int): Maximum age in hours for files to keep (default: 24)
    
    Returns:
        dict: Cleanup result with count of cleaned files
    
    Raises:
        HTTPException: When cleanup operation fails
    """
    try:
        logger.info("收到文件清理请求", {
            "max_age_hours": max_age_hours,
            "endpoint": "/timeline/export/cleanup"
        })

        # 验证参数
        if max_age_hours < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="最大保留时间必须大于0小时"
            )

        # 执行清理
        cleaned_count = timeline_export_service.cleanup_old_exports(max_age_hours)
        
        logger.info("文件清理完成", {
            "cleaned_count": cleaned_count,
            "max_age_hours": max_age_hours
        })
        
        return {
            "success": True,
            "message": f"成功清理了 {cleaned_count} 个过期文件",
            "cleaned_count": cleaned_count,
            "max_age_hours": max_age_hours
        }

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error("文件清理处理异常", {
            "max_age_hours": max_age_hours,
            "error": str(e),
            "error_type": type(e).__name__
        }, exc_info=True)
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"服务器内部错误: {str(e)}"
        )