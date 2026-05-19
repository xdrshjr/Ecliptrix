"""
Intent Detection Router
用户意图检测API路由
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.models.intent_detection_models import (
    IntentDetectionRequest,
    IntentDetectionResponse
)
from app.services.intent_detection_service import intent_detection_service
from app.dependencies.auth import get_current_user

# 配置日志
logger = logging.getLogger(__name__)

# 创建路由器 — V01-A: enforce auth on every endpoint. This router is mounted
# at root (no /api prefix) in main.py so middleware prefix-matching cannot
# be relied on; we add an explicit router-level Depends.
router = APIRouter(
    prefix="/api/intent-detection",
    tags=["Intent Detection"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/detect", response_model=IntentDetectionResponse)
async def detect_user_intent(request: IntentDetectionRequest):
    """
    检测用户意图，判断是否需要调用工作流
    使用Fast LLM进行快速意图分析
    
    Args:
        request: 意图检测请求，包含用户消息和启用的工作流列表
        
    Returns:
        IntentDetectionResponse: 意图检测结果
        
    Raises:
        HTTPException: 当检测失败时
    """
    try:
        logger.info(
            f"[IntentDetectionRouter] 收到Fast LLM意图检测请求 - "
            f"消息: {request.user_message[:100]}..., "
            f"启用工作流数: {len(request.enabled_workflows)}, "
            f"工作流列表: {[wf.workflow_name for wf in request.enabled_workflows]}"
        )
        
        # 调用意图检测服务（使用Fast LLM）
        response = await intent_detection_service.detect_intent(request)
        
        if not response.success:
            logger.error(
                f"[IntentDetectionRouter] Fast LLM意图检测失败 - "
                f"错误: {response.error}"
            )
            # 不抛出异常，而是返回失败响应，让上层决定如何处理
            return response
        
        logger.info(
            f"[IntentDetectionRouter] Fast LLM意图检测成功 - "
            f"需要调用工作流: {response.data.should_call_workflow if response.data else False}, "
            f"工作流名称: {response.data.workflow_name if response.data and response.data.workflow_name else 'N/A'}, "
            f"置信度: {response.data.confidence if response.data else 0.0:.2f}"
        )
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[IntentDetectionRouter] Fast LLM意图检测异常: {e}")
        # 返回失败响应而不是抛出异常
        return IntentDetectionResponse(
            success=False,
            message="Intent detection error",
            error=str(e)
        )

