"""
Intent Detection Models
用于检测用户意图并判断是否需要调用工作流
"""
from typing import Optional, List, Dict
from pydantic import BaseModel, Field


class WorkflowInfo(BaseModel):
    """工作流信息"""
    workflow_id: str = Field(..., description="工作流ID")
    workflow_name: str = Field(..., description="工作流名称")
    tool_description: str = Field(..., description="工作流工具描述")
    enabled: bool = Field(..., description="是否启用")


class IntentDetectionRequest(BaseModel):
    """用户意图检测请求"""
    user_message: str = Field(..., description="用户的问题或消息")
    enabled_workflows: List[WorkflowInfo] = Field(..., description="当前启用的工作流列表")
    conversation_history: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="对话历史（可选）"
    )


class WorkflowIntention(BaseModel):
    """工作流调用意图"""
    should_call_workflow: bool = Field(..., description="是否需要调用工作流")
    workflow_id: Optional[str] = Field(None, description="建议调用的工作流ID")
    workflow_name: Optional[str] = Field(None, description="建议调用的工作流名称")
    reasoning: str = Field(..., description="判断理由")
    confidence: float = Field(..., description="置信度 (0-1)")


class IntentDetectionResponse(BaseModel):
    """用户意图检测响应"""
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="响应消息")
    data: Optional[WorkflowIntention] = Field(None, description="意图检测结果")
    error: Optional[str] = Field(None, description="错误信息")

