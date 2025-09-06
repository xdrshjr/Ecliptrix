"""
RunningHub API models for FLUX text-to-image generation.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum


class TaskStatus(str, Enum):
    """Task status enumeration."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class NodeInfo(BaseModel):
    """Node information for workflow parameters."""
    nodeId: str = Field(..., description="Node ID in the workflow")
    fieldName: str = Field(..., description="Field name to set")
    fieldValue: str = Field(..., description="Field value to set")
    description: str = Field(..., description="Description of the field")


class FluxGenerationRequest(BaseModel):
    """Request model for FLUX text-to-image generation."""
    positive_prompt: str = Field(..., description="Positive prompt for image generation", min_length=1, max_length=5000)
    aspect_ratio: str = Field(default="3:4 (Golden Ratio)", description="Image aspect ratio")
    task_id: Optional[str] = Field(default=None, description="Task ID for tracking")
    
    class Config:
        json_schema_extra = {
            "example": {
                "positive_prompt": "可爱的动漫女孩，有着巨大的蓬松耳廓狐耳朵和一条蓬松的大尾巴",
                "aspect_ratio": "3:4 (Golden Ratio)",
                "task_id": "task_123"
            }
        }


class RunningHubCreateTaskRequest(BaseModel):
    """Request model for RunningHub create task API."""
    workflowId: str = Field(..., description="Workflow ID")
    apiKey: str = Field(..., description="API key for authentication")
    nodeInfoList: List[NodeInfo] = Field(..., description="List of node parameters")


class RunningHubCreateTaskResponse(BaseModel):
    """Response model for RunningHub create task API."""
    code: int = Field(..., description="Response code")
    msg: str = Field(..., description="Response message")
    data: Dict[str, Any] = Field(..., description="Response data containing task info")


class RunningHubStatusRequest(BaseModel):
    """Request model for RunningHub status check API."""
    apiKey: str = Field(..., description="API key for authentication")
    taskId: str = Field(..., description="Task ID to check")


class RunningHubStatusResponse(BaseModel):
    """Response model for RunningHub status check API."""
    code: int = Field(..., description="Response code")
    msg: str = Field(..., description="Response message")
    data: str = Field(..., description="Task status")


class RunningHubResultsRequest(BaseModel):
    """Request model for RunningHub results API."""
    apiKey: str = Field(..., description="API key for authentication")
    taskId: str = Field(..., description="Task ID to get results for")


class RunningHubResultFile(BaseModel):
    """Result file information."""
    fileUrl: str = Field(..., description="URL of the generated file")
    fileType: str = Field(..., description="File type (e.g., png, jpg)")
    taskCostTime: str = Field(..., description="Task execution time in seconds")
    nodeId: str = Field(..., description="Node ID that generated this file")


class RunningHubResultsResponse(BaseModel):
    """Response model for RunningHub results API."""
    code: int = Field(..., description="Response code")
    msg: str = Field(..., description="Response message")
    data: List[RunningHubResultFile] = Field(..., description="List of result files")


class FluxGenerationResponse(BaseModel):
    """Response model for FLUX generation initiation."""
    success: bool = Field(..., description="Whether the request was successful")
    task_id: str = Field(..., description="Task ID for tracking")
    runninghub_task_id: str = Field(..., description="RunningHub task ID")
    status: TaskStatus = Field(..., description="Initial task status")
    message: str = Field(..., description="Response message")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "task_id": "task_123",
                "runninghub_task_id": "1964366821157683201",
                "status": "RUNNING",
                "message": "FLUX generation task created successfully"
            }
        }


class FluxGenerationStatusResponse(BaseModel):
    """Response model for FLUX generation status."""
    success: bool = Field(..., description="Whether the request was successful")
    task_id: str = Field(..., description="Task ID")
    runninghub_task_id: str = Field(..., description="RunningHub task ID")
    status: TaskStatus = Field(..., description="Current task status")
    message: str = Field(..., description="Status message")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "task_id": "task_123",
                "runninghub_task_id": "1964366821157683201",
                "status": "RUNNING",
                "message": "Task is still running"
            }
        }


class FluxGenerationResultResponse(BaseModel):
    """Response model for FLUX generation results."""
    success: bool = Field(..., description="Whether the request was successful")
    task_id: str = Field(..., description="Task ID")
    runninghub_task_id: str = Field(..., description="RunningHub task ID")
    status: TaskStatus = Field(..., description="Final task status")
    results: List[RunningHubResultFile] = Field(default=[], description="Generated images")
    message: str = Field(..., description="Result message")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "task_id": "task_123",
                "runninghub_task_id": "1964366821157683201",
                "status": "COMPLETED",
                "results": [
                    {
                        "fileUrl": "https://rh-images.xiaoyaoyou.com/output/ComfyUI_00001.png",
                        "fileType": "png",
                        "taskCostTime": "85",
                        "nodeId": "9"
                    }
                ],
                "message": "Generation completed successfully"
            }
        }


class FluxGenerationErrorResponse(BaseModel):
    """Error response model for FLUX generation."""
    success: bool = Field(default=False, description="Always false for errors")
    error: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(default=None, description="Error code")
    task_id: Optional[str] = Field(default=None, description="Task ID if available")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "error": "Invalid prompt: prompt cannot be empty",
                "error_code": "INVALID_PROMPT",
                "task_id": "task_123"
            }
        }