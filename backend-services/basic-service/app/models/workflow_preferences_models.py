"""
Workflow preferences data models for Video Editing tasks.
"""

from pydantic import BaseModel, Field
from typing import Dict, Optional
from datetime import datetime


class WorkflowPreference(BaseModel):
    """单个工作流的偏好设置"""
    workflow_id: str = Field(..., description="工作流ID")
    workflow_name: str = Field(..., description="工作流名称")
    is_expanded: bool = Field(False, description="工作流是否展开（启用状态）")
    tool_description: Optional[str] = Field(None, description="工具描述")
    
    class Config:
        schema_extra = {
            "example": {
                "workflow_id": "workflow-123",
                "workflow_name": "Image Generation",
                "is_expanded": True,
                "tool_description": "Generate images using AI models"
            }
        }


class WorkflowPreferencesSaveRequest(BaseModel):
    """保存工作流偏好设置请求模型"""
    user_id: str = Field(..., description="用户ID")
    preferences: Dict[str, WorkflowPreference] = Field(..., description="工作流偏好设置字典，key为workflow_id")
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "preferences": {
                    "workflow-123": {
                        "workflow_id": "workflow-123",
                        "workflow_name": "Image Generation",
                        "is_expanded": True,
                        "tool_description": "Generate images using AI models"
                    },
                    "workflow-456": {
                        "workflow_id": "workflow-456",
                        "workflow_name": "Video Processing",
                        "is_expanded": False,
                        "tool_description": "Process videos with AI"
                    }
                }
            }
        }


class WorkflowPreferencesLoadRequest(BaseModel):
    """加载工作流偏好设置请求模型"""
    user_id: str = Field(..., description="用户ID")
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": "550e8400-e29b-41d4-a716-446655440000"
            }
        }


class WorkflowPreferencesResponse(BaseModel):
    """工作流偏好设置响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    timestamp: datetime = Field(..., description="响应时间戳")
    preferences: Dict[str, WorkflowPreference] = Field(default_factory=dict, description="工作流偏好设置字典")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "工作流偏好设置获取成功",
                "timestamp": "2023-12-01T12:00:00.000Z",
                "preferences": {
                    "workflow-123": {
                        "workflow_id": "workflow-123",
                        "workflow_name": "Image Generation",
                        "is_expanded": True,
                        "tool_description": "Generate images using AI models"
                    }
                }
            }
        }


class WorkflowPreferencesSaveResponse(BaseModel):
    """保存工作流偏好设置响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="响应消息")
    timestamp: datetime = Field(..., description="响应时间戳")
    saved_count: int = Field(..., description="保存的偏好设置数量")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "工作流偏好设置保存成功",
                "timestamp": "2023-12-01T12:00:00.000Z",
                "saved_count": 2
            }
        }

