"""
Video search data models for PEXELS API integration.
"""

from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class VideoSearchRequest(BaseModel):
    """Video search request model."""
    
    query: str = Field(description="Search query for videos", min_length=1, max_length=200)
    max_videos: int = Field(default=20, description="Maximum number of videos to return", ge=1, le=50)
    orientation: str = Field(default="mixed", description="Video orientation filter", pattern="^(landscape|portrait|mixed)$")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "nature landscape",
                "max_videos": 20,
                "orientation": "mixed"
            }
        }
    )


class VideoInfo(BaseModel):
    """Individual video information model."""
    
    id: int = Field(description="Video ID from PEXELS")
    title: str = Field(description="Video title")
    author: str = Field(description="Video author/creator")
    duration: Optional[int] = Field(default=None, description="Video duration in seconds")
    video_url: str = Field(description="Direct video file URL")
    thumbnail: str = Field(description="Video thumbnail URL")
    width: int = Field(description="Video width in pixels")
    height: int = Field(description="Video height in pixels")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 12345,
                "title": "Video by John Doe",
                "author": "John Doe",
                "duration": 30,
                "video_url": "https://example.com/video.mp4",
                "thumbnail": "https://example.com/thumbnail.jpg",
                "width": 1920,
                "height": 1080
            }
        }
    )


class VideoSearchResponse(BaseModel):
    """Video search response model."""
    
    success: bool = Field(description="Whether the search was successful")
    message: str = Field(description="Response message")
    videos: List[VideoInfo] = Field(default=[], description="List of found videos")
    total_found: int = Field(description="Total number of videos found")
    query: str = Field(description="Original search query")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Found 20 videos",
                "videos": [
                    {
                        "id": 12345,
                        "title": "Video by John Doe",
                        "author": "John Doe",
                        "duration": 30,
                        "video_url": "https://example.com/video.mp4",
                        "thumbnail": "https://example.com/thumbnail.jpg",
                        "width": 1920,
                        "height": 1080
                    }
                ],
                "total_found": 20,
                "query": "nature landscape"
            }
        }
    ) 