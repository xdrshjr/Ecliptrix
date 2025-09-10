"""
AI Mixed Editing models for automatic video editing.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class MaterialItemModel(BaseModel):
    """Material item model for AI mixed editing."""
    
    id: str = Field(..., description="Material unique identifier")
    name: str = Field(..., description="Material name")
    type: str = Field(..., description="Material type (video, audio, image)")
    format: str = Field(..., description="File format")
    size: int = Field(..., description="File size in bytes")
    duration: Optional[float] = Field(default=None, description="Duration in seconds for video/audio")
    width: Optional[int] = Field(default=None, description="Width in pixels for video/image")
    height: Optional[int] = Field(default=None, description="Height in pixels for video/image")
    url: str = Field(..., description="Material URL")
    serverUrl: Optional[str] = Field(default=None, description="Server URL for the material")
    thumbnailUrl: Optional[str] = Field(default=None, description="Thumbnail URL")
    description: Optional[str] = Field(default=None, description="Material description")
    tags: Optional[List[str]] = Field(default=None, description="Material tags")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")
    createdAt: str = Field(..., description="Creation timestamp")

    model_config = {"extra": "allow"}


class AIMixedEditingRequest(BaseModel):
    """Request model for AI mixed editing."""
    
    taskId: str = Field(..., description="Unique task identifier", min_length=1)
    materials: List[MaterialItemModel] = Field(..., description="List of materials to use for mixed editing", min_items=1)

    model_config = {"extra": "forbid"}


class AIMixedEditingResponse(BaseModel):
    """Response model for AI mixed editing."""
    
    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    timelineData: Optional[Dict[str, Any]] = Field(default=None, description="Generated timeline JSON data")
    taskId: str = Field(..., description="Task identifier")

    model_config = {"extra": "forbid"}


class AIMixedEditingErrorResponse(BaseModel):
    """Error response model for AI mixed editing."""
    
    error: str = Field(..., description="Error message")
    details: Optional[str] = Field(default=None, description="Additional error details")
    taskId: Optional[str] = Field(default=None, description="Task ID if available")

    model_config = {"extra": "forbid"}