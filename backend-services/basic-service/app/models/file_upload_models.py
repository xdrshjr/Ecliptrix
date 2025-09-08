"""
File upload related data models for the Basic Service application.
"""

from typing import Optional, Any
from pydantic import BaseModel, Field
from app.models import BaseResponse


class FileUploadRequest(BaseModel):
    """
    Request model for file upload.
    """
    task_id: Optional[str] = Field(None, description="Optional task identifier for tracking")


class FileUploadResponse(BaseResponse):
    """
    Response model for file upload.
    """
    data: dict = Field(..., description="Upload result data including filename and URL")


class FileUploadData(BaseModel):
    """
    Model for file upload response data.
    """
    filename: str = Field(..., description="Name of the uploaded file")
    file_url: Optional[str] = Field(None, description="URL of the uploaded file")
    file_size: Optional[int] = Field(None, description="Size of the uploaded file in bytes")
    content_type: Optional[str] = Field(None, description="MIME type of the uploaded file")
    upload_id: Optional[str] = Field(None, description="Unique identifier for the upload")