"""
Queue management models for request queuing system.
"""

from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    """Task status enumeration."""
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class QueueTask(BaseModel):
    """Queue task model."""
    task_id: str = Field(..., description="Unique task identifier")
    queue_name: str = Field(..., description="Queue name")
    status: TaskStatus = Field(TaskStatus.QUEUED, description="Task status")
    created_at: datetime = Field(default_factory=datetime.now, description="Task creation time")
    started_at: Optional[datetime] = Field(None, description="Task start time")
    completed_at: Optional[datetime] = Field(None, description="Task completion time")
    position_in_queue: Optional[int] = Field(None, description="Position in queue (for queued tasks)")
    estimated_wait_time: Optional[float] = Field(None, description="Estimated wait time in seconds")
    processing_time: Optional[float] = Field(None, description="Actual processing time in seconds")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional task metadata")


class QueueInfo(BaseModel):
    """Queue information model."""
    queue_name: str = Field(..., description="Queue name")
    max_concurrent: int = Field(..., description="Maximum concurrent tasks")
    current_processing: int = Field(..., description="Currently processing tasks")
    queued_count: int = Field(..., description="Number of tasks in queue")
    total_processed: int = Field(..., description="Total processed tasks")
    average_processing_time: Optional[float] = Field(None, description="Average processing time in seconds")


class QueueStatusResponse(BaseModel):
    """Queue status response model."""
    success: bool = Field(True, description="Response success status")
    queue_info: QueueInfo = Field(..., description="Queue information")
    tasks: Optional[list[QueueTask]] = Field(None, description="Recent tasks (optional)")


class TaskStatusResponse(BaseModel):
    """Task status response model."""
    success: bool = Field(True, description="Response success status")
    task: QueueTask = Field(..., description="Task information")


class QueueErrorResponse(BaseModel):
    """Queue error response model."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: str = Field(..., description="Error code")
    details: Optional[str] = Field(None, description="Additional error details") 