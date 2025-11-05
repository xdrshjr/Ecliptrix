"""
Workflow preferences management router for Video Editing task.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime

from app.models.workflow_preferences_models import (
    WorkflowPreferencesSaveRequest,
    WorkflowPreferencesLoadRequest,
    WorkflowPreferencesResponse,
    WorkflowPreferencesSaveResponse
)
from app.services.workflow_preferences_service import WorkflowPreferencesService
from app.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/workflow-preferences", tags=["workflow-preferences"])

# Initialize workflow preferences service
workflow_preferences_service = WorkflowPreferencesService()


@router.post("/save", response_model=WorkflowPreferencesSaveResponse)
async def save_workflow_preferences(
    request: WorkflowPreferencesSaveRequest
) -> WorkflowPreferencesSaveResponse:
    """
    保存用户的工作流偏好设置（展开/折叠状态）
    
    Args:
        request: 包含用户ID和偏好设置的请求
        
    Returns:
        WorkflowPreferencesSaveResponse: 保存结果响应
        
    Raises:
        HTTPException: 当保存失败时
    """
    logger.info("收到保存工作流偏好设置请求", {
        "user_id": request.user_id,
        "preferences_count": len(request.preferences),
        "endpoint": "/workflow-preferences/save",
        "method": "POST",
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await workflow_preferences_service.save_preferences(
            user_id=request.user_id,
            preferences=request.preferences
        )
        
        if not result["success"]:
            logger.warning("工作流偏好设置保存失败", {
                "user_id": request.user_id,
                "error": result.get("message", "Unknown error")
            })
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "保存工作流偏好设置失败")
            )
        
        logger.info("工作流偏好设置保存成功", {
            "user_id": request.user_id,
            "saved_count": result["saved_count"]
        })
        
        return WorkflowPreferencesSaveResponse(
            success=True,
            message=result["message"],
            timestamp=datetime.now(),
            saved_count=result["saved_count"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("保存工作流偏好设置异常", {
            "user_id": request.user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.post("/load", response_model=WorkflowPreferencesResponse)
async def load_workflow_preferences(
    request: WorkflowPreferencesLoadRequest
) -> WorkflowPreferencesResponse:
    """
    加载用户的工作流偏好设置（展开/折叠状态）
    
    Args:
        request: 包含用户ID的请求
        
    Returns:
        WorkflowPreferencesResponse: 偏好设置响应
        
    Raises:
        HTTPException: 当加载失败时
    """
    logger.info("收到加载工作流偏好设置请求", {
        "user_id": request.user_id,
        "endpoint": "/workflow-preferences/load",
        "method": "POST",
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await workflow_preferences_service.load_preferences(
            user_id=request.user_id
        )
        
        if not result["success"]:
            logger.warning("工作流偏好设置加载失败", {
                "user_id": request.user_id,
                "error": result.get("message", "Unknown error")
            })
            raise HTTPException(
                status_code=500,
                detail=result.get("message", "加载工作流偏好设置失败")
            )
        
        logger.info("工作流偏好设置加载成功", {
            "user_id": request.user_id,
            "preferences_count": len(result["preferences"])
        })
        
        return WorkflowPreferencesResponse(
            success=True,
            message=result["message"],
            timestamp=datetime.now(),
            preferences=result["preferences"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("加载工作流偏好设置异常", {
            "user_id": request.user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")


@router.delete("/clear")
async def clear_workflow_preferences(user_id: str):
    """
    清除用户的工作流偏好设置
    
    Args:
        user_id: 用户ID
        
    Returns:
        Dict: 清除结果
        
    Raises:
        HTTPException: 当清除失败时
    """
    logger.info("收到清除工作流偏好设置请求", {
        "user_id": user_id,
        "endpoint": "/workflow-preferences/clear",
        "method": "DELETE",
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        result = await workflow_preferences_service.clear_preferences(user_id)
        
        if not result["success"]:
            logger.warning("工作流偏好设置清除失败", {
                "user_id": user_id,
                "error": result.get("message", "Unknown error")
            })
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "清除工作流偏好设置失败")
            )
        
        logger.info("工作流偏好设置清除成功", {"user_id": user_id})
        
        return {
            "success": True,
            "message": result["message"],
            "timestamp": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error("清除工作流偏好设置异常", {
            "user_id": user_id,
            "error": str(e),
            "error_type": type(e).__name__
        })
        raise HTTPException(status_code=500, detail="服务器内部错误")

