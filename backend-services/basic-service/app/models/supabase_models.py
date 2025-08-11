"""
Supabase-related models for file upload and management.
"""

from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class SupabaseUploadRequest(BaseModel):
    """Request model for uploading file to Supabase."""
    file_path: str = Field(..., description="Local file path to upload")
    bucket_path: Optional[str] = Field(None, description="Target path in Supabase bucket")
    content_type: Optional[str] = Field(None, description="MIME type of the file")


class SupabaseUploadResponse(BaseModel):
    """Response model for Supabase file upload."""
    success: bool = Field(..., description="Whether the upload was successful")
    message: str = Field(..., description="Response message")
    file_url: Optional[str] = Field(None, description="Public URL of the uploaded file")
    file_path: Optional[str] = Field(None, description="Path in Supabase bucket")
    file_size: Optional[int] = Field(None, description="Size of the uploaded file in bytes")
    upload_time: Optional[datetime] = Field(None, description="Time when the file was uploaded")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class SupabaseUploadErrorResponse(BaseModel):
    """Error response model for Supabase upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class AudioUploadRequest(BaseModel):
    """Request model for audio file upload to Supabase."""
    audio_file_path: str = Field(..., description="Local path to the audio file")
    segment_id: Optional[str] = Field(None, description="Segment ID associated with the audio")
    task_id: Optional[str] = Field(None, description="Task ID associated with the audio")
    voice_type: Optional[str] = Field(None, description="Voice type used for TTS")
    custom_filename: Optional[str] = Field(None, description="Custom filename for the uploaded file")


class AudioUploadResponse(BaseModel):
    """Response model for audio file upload."""
    success: bool = Field(..., description="Whether the upload was successful")
    message: str = Field(..., description="Response message")
    audio_url: str = Field(..., description="Public URL of the uploaded audio file")
    file_path: str = Field(..., description="Path in Supabase bucket")
    file_size: int = Field(..., description="Size of the audio file in bytes")
    duration: Optional[float] = Field(None, description="Duration of the audio in seconds")
    segment_id: Optional[str] = Field(None, description="Segment ID")
    task_id: Optional[str] = Field(None, description="Task ID")
    upload_time: datetime = Field(..., description="Upload timestamp")


class BatchAudioUploadRequest(BaseModel):
    """Request model for batch audio upload."""
    audio_files: list[AudioUploadRequest] = Field(..., description="List of audio files to upload")
    task_id: Optional[str] = Field(None, description="Task ID for the batch")


class BatchAudioUploadResponse(BaseModel):
    """Response model for batch audio upload."""
    success: bool = Field(..., description="Whether the batch upload was successful")
    message: str = Field(..., description="Response message")
    total_files: int = Field(..., description="Total number of files processed")
    successful_uploads: int = Field(..., description="Number of successful uploads")
    failed_uploads: int = Field(..., description="Number of failed uploads")
    results: list[AudioUploadResponse] = Field(..., description="Individual upload results")
    task_id: Optional[str] = Field(None, description="Task ID")
    total_processing_time: float = Field(..., description="Total processing time in seconds")


class VideoUploadRequest(BaseModel):
    """Request model for video file upload to Supabase."""
    task_id: Optional[str] = Field(None, description="Task ID associated with the video")
    custom_filename: Optional[str] = Field(None, description="Custom filename for the uploaded file")
    generate_thumbnail: Optional[bool] = Field(True, description="Whether to generate thumbnail for video")


class VideoUploadResponse(BaseModel):
    """Response model for video file upload."""
    success: bool = Field(..., description="Whether the upload was successful")
    message: str = Field(..., description="Response message")
    video_url: str = Field(..., description="Public URL of the uploaded video file")
    file_path: str = Field(..., description="Path in Supabase bucket")
    file_size: int = Field(..., description="Size of the video file in bytes")
    duration: Optional[float] = Field(None, description="Duration of the video in seconds")
    width: Optional[int] = Field(None, description="Video width in pixels")
    height: Optional[int] = Field(None, description="Video height in pixels")
    thumbnail_url: Optional[str] = Field(None, description="URL of the generated thumbnail")
    task_id: Optional[str] = Field(None, description="Task ID")
    upload_time: datetime = Field(..., description="Upload timestamp")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional video metadata")


class VideoUploadErrorResponse(BaseModel):
    """Error response model for video upload failures."""
    success: bool = Field(False, description="Always false for error responses")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details") 