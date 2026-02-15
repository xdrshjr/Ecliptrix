"""
Storage service Pydantic models for file upload and management.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class FileUploadResponse(BaseModel):
    """File upload response model."""
    success: bool
    file_url: str = ""
    file_path: str = ""
    file_size: int = 0
    content_type: str = ""
    filename: str = ""
    message: str = ""


class VideoUploadResponse(BaseModel):
    """Video upload response model with metadata."""
    success: bool
    message: str = ""
    video_url: str = ""
    file_path: str = ""
    file_size: int = 0
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    thumbnail_url: Optional[str] = None
    task_id: Optional[str] = None
    upload_time: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None


class VideoUploadErrorResponse(BaseModel):
    """Error response model for video upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class StorageUploadResponse(BaseModel):
    """General storage upload response model."""
    success: bool = Field(..., description="Whether the upload was successful")
    message: str = Field(..., description="Response message")
    file_url: Optional[str] = Field(None, description="Public URL of the uploaded file")
    file_path: Optional[str] = Field(None, description="Path in storage")
    file_size: Optional[int] = Field(None, description="Size of the uploaded file in bytes")
    upload_time: Optional[datetime] = Field(None, description="Time when the file was uploaded")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class StorageUploadErrorResponse(BaseModel):
    """Error response model for storage upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class MaterialItem(BaseModel):
    """Material item model."""
    filename: str = ""
    file_url: str = ""
    thumbnail_url: Optional[str] = None
    file_size: int = 0
    content_type: str = ""
    material_type: str = ""
    created_at: str = ""
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None


class UserMaterialsResponse(BaseModel):
    """User materials list response model."""
    success: bool
    total: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 0
    materials: List[Dict[str, Any]] = []
    message: str = ""
