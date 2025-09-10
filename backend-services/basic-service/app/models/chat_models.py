"""
Chat models for video editing AI assistant.
"""

from pydantic import BaseModel, Field
from typing import Optional


class VideoChatRequest(BaseModel):
    """Request model for video editing chat."""
    
    message: str = Field(..., description="User message content", min_length=1)
    currentContent: str = Field(default="", description="Current project content in Markdown format")
    taskId: str = Field(..., description="Unique task identifier", min_length=1)

    model_config = {"extra": "forbid"}


class VideoChatErrorResponse(BaseModel):
    """Error response model for video editing chat."""
    
    error: str = Field(..., description="Error message")
    details: Optional[str] = Field(default=None, description="Additional error details")
    taskId: Optional[str] = Field(default=None, description="Task ID if available")

    model_config = {"extra": "forbid"}