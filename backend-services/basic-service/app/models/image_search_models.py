"""
Image search data models for Unsplash API integration.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, validator
from enum import Enum

from .base_models import BaseResponse


class ImageSearchRequest(BaseModel):
    """Image search request model."""
    
    query: str = Field(description="Search query for images", min_length=1, max_length=200)
    max_images: int = Field(default=60, description="Maximum number of images to return", ge=1, le=60)
    orientation: str = Field(default="all", description="Image orientation filter", pattern="^(all|landscape|portrait|squarish)$")
    color: str = Field(default="all", description="Image color filter", pattern="^(all|black_and_white|black|white|yellow|orange|red|purple|magenta|green|teal|blue)$")
    order_by: str = Field(default="relevant", description="Sort order for results", pattern="^(relevant|latest|popular)$")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "nature landscape",
                "max_images": 60,
                "orientation": "landscape",
                "color": "all",
                "order_by": "relevant"
            }
        }
    )


class ImageInfo(BaseModel):
    """Individual image information model."""
    
    id: str = Field(description="Image ID from Unsplash")
    description: Optional[str] = Field(default=None, description="Image description")
    alt_description: Optional[str] = Field(default=None, description="Alternative image description")
    width: int = Field(description="Image width in pixels")
    height: int = Field(description="Image height in pixels")
    color: str = Field(description="Dominant color of the image")
    blur_hash: Optional[str] = Field(default=None, description="BlurHash for image placeholder")
    
    # URLs for different image sizes
    raw_url: str = Field(description="Raw image URL (full resolution)")
    full_url: str = Field(description="Full size image URL")
    regular_url: str = Field(description="Regular size image URL (1080px)")
    small_url: str = Field(description="Small size image URL (400px)")
    thumb_url: str = Field(description="Thumbnail image URL (200px)")
    
    # User information
    user_id: str = Field(description="User ID who uploaded the image")
    user_name: str = Field(description="User display name")
    user_username: str = Field(description="User username")
    user_profile_url: str = Field(description="User profile URL")
    user_avatar_url: Optional[str] = Field(default=None, description="User avatar URL")
    
    # Image metadata
    likes: int = Field(default=0, description="Number of likes")
    downloads: int = Field(default=0, description="Number of downloads")
    created_at: str = Field(description="Image creation date")
    updated_at: str = Field(description="Image last update date")
    
    # Tags and categories
    tags: List[str] = Field(default_factory=list, description="Image tags")
    categories: List[str] = Field(default_factory=list, description="Image categories")
    
    # Links
    html_url: str = Field(description="Unsplash page URL for this image")
    download_location: str = Field(description="Download tracking URL")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "abc123def456",
                "description": "Beautiful mountain landscape at sunset",
                "alt_description": "Mountain peaks with orange sunset sky",
                "width": 4000,
                "height": 3000,
                "color": "#ff6b35",
                "blur_hash": "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
                "raw_url": "https://images.unsplash.com/photo-1234567890/raw",
                "full_url": "https://images.unsplash.com/photo-1234567890/full",
                "regular_url": "https://images.unsplash.com/photo-1234567890/regular",
                "small_url": "https://images.unsplash.com/photo-1234567890/small",
                "thumb_url": "https://images.unsplash.com/photo-1234567890/thumb",
                "user_id": "user123",
                "user_name": "John Photographer",
                "user_username": "johnphoto",
                "user_profile_url": "https://unsplash.com/@johnphoto",
                "user_avatar_url": "https://images.unsplash.com/profile-1234567890",
                "likes": 1523,
                "downloads": 45678,
                "created_at": "2023-01-15T10:30:00Z",
                "updated_at": "2023-01-15T10:30:00Z",
                "tags": ["landscape", "mountain", "sunset", "nature"],
                "categories": ["nature", "landscape"],
                "html_url": "https://unsplash.com/photos/abc123def456",
                "download_location": "https://api.unsplash.com/photos/abc123def456/download"
            }
        }
    )


class ImageSearchResponse(BaseResponse):
    """Image search response model."""
    
    images: List[ImageInfo] = Field(default_factory=list, description="List of found images")
    total_found: int = Field(default=0, description="Total number of images found")
    query: str = Field(description="Original search query")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Image search completed successfully",
                "images": [
                    {
                        "id": "abc123def456",
                        "description": "Beautiful mountain landscape",
                        "alt_description": "Mountain peaks with sunset",
                        "width": 4000,
                        "height": 3000,
                        "color": "#ff6b35",
                        "regular_url": "https://images.unsplash.com/photo-1234567890/regular",
                        "thumb_url": "https://images.unsplash.com/photo-1234567890/thumb",
                        "user_name": "John Photographer",
                        "user_username": "johnphoto",
                        "likes": 1523,
                        "tags": ["landscape", "mountain", "sunset"]
                    }
                ],
                "total_found": 10000,
                "query": "nature landscape"
            }
        }
    ) 