"""
Audio search data models for Freesound API integration.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict, validator
from enum import Enum

from .base_models import BaseResponse


class AudioSearchRequest(BaseModel):
    """Audio search request model."""
    
    query: str = Field(description="Search query for audio", min_length=1, max_length=200)
    max_audios: int = Field(default=20, description="Maximum number of audio files to return", ge=1, le=50)
    duration_min: Optional[float] = Field(default=None, description="Minimum duration in seconds", ge=0)
    duration_max: Optional[float] = Field(default=None, description="Maximum duration in seconds", ge=0)
    audio_type: str = Field(default="all", description="Audio type filter", pattern="^(all|music|sound-effect|speech|ambient|nature)$")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "ambient music",
                "max_audios": 20,
                "duration_min": 5.0,
                "duration_max": 60.0,
                "audio_type": "music"
            }
        }
    )

    @validator('duration_max')
    def validate_duration_range(cls, v, values):
        if v is not None and 'duration_min' in values and values['duration_min'] is not None:
            if v <= values['duration_min']:
                raise ValueError('duration_max must be greater than duration_min')
        return v


class AudioInfo(BaseModel):
    """Individual audio information model."""
    
    id: int = Field(description="Audio ID from Freesound")
    name: str = Field(description="Audio name/title")
    description: str = Field(default="", description="Audio description")
    username: str = Field(description="Audio uploader username")
    duration: float = Field(description="Audio duration in seconds")
    download_url: str = Field(description="Direct audio download URL")
    preview_url: str = Field(description="Audio preview URL (usually lower quality)")
    waveform_url: Optional[str] = Field(default=None, description="Waveform visualization URL")
    license: str = Field(description="Audio license (e.g., CC0, CC BY)")
    tags: List[str] = Field(default_factory=list, description="Audio tags")
    filesize: Optional[int] = Field(default=None, description="File size in bytes")
    type: Optional[str] = Field(default=None, description="Audio file type (mp3, wav, etc.)")
    channels: Optional[int] = Field(default=None, description="Number of audio channels")
    bitrate: Optional[int] = Field(default=None, description="Audio bitrate")
    samplerate: Optional[int] = Field(default=None, description="Audio sample rate")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 12345,
                "name": "Ambient Forest Sounds",
                "description": "Peaceful forest ambience with birds chirping",
                "username": "naturelover",
                "duration": 45.2,
                "download_url": "https://freesound.org/data/previews/123/12345_456789-hq.mp3",
                "preview_url": "https://freesound.org/data/previews/123/12345_456789-lq.mp3",
                "waveform_url": "https://freesound.org/data/displays/123/12345_456789_wave_M.png",
                "license": "CC0",
                "tags": ["ambient", "nature", "forest", "birds"],
                "filesize": 1024000,
                "type": "mp3",
                "channels": 2,
                "bitrate": 128,
                "samplerate": 44100
            }
        }
    )


class AudioSearchResponse(BaseResponse):
    """Audio search response model."""
    
    audios: List[AudioInfo] = Field(default_factory=list, description="List of found audio files")
    total_found: int = Field(default=0, description="Total number of audio files found")
    query: str = Field(description="Original search query")
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "success": True,
                "message": "Audio search completed successfully",
                "audios": [
                    {
                        "id": 12345,
                        "name": "Ambient Forest Sounds",
                        "description": "Peaceful forest ambience",
                        "username": "naturelover",
                        "duration": 45.2,
                        "download_url": "https://freesound.org/data/previews/123/12345_456789-hq.mp3",
                        "preview_url": "https://freesound.org/data/previews/123/12345_456789-lq.mp3",
                        "license": "CC0",
                        "tags": ["ambient", "nature"],
                        "type": "mp3"
                    }
                ],
                "total_found": 150,
                "query": "ambient music"
            }
        }
    ) 