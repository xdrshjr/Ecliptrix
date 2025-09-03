"""
Request models for the ComfyUI API Service.
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator


class ImageGenerationRequest(BaseModel):
    """Request model for image generation."""
    
    positive_prompt: str = Field(..., description="Positive prompt for image generation")
    negative_prompt: str = Field(default="low quality, blurry, distorted", description="Negative prompt")
    width: int = Field(default=1024, ge=64, le=2048, description="Image width")
    height: int = Field(default=1024, ge=64, le=2048, description="Image height")
    steps: int = Field(default=20, ge=1, le=100, description="Sampling steps")
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    cfg: float = Field(default=1.0, ge=0.1, le=20.0, description="CFG scale")
    guidance: float = Field(default=3.5, ge=0.1, le=20.0, description="Guidance scale")
    checkpoint: str = Field(default="flux1-dev-fp8.safetensors", description="Model checkpoint")
    
    @field_validator('positive_prompt')
    @classmethod
    def validate_positive_prompt(cls, v):
        """Validate positive prompt is not empty."""
        if not v or not v.strip():
            raise ValueError("Positive prompt cannot be empty")
        if len(v) > 5000:
            raise ValueError("Positive prompt too long (max 5000 characters)")
        return v.strip()
    
    @field_validator('negative_prompt')
    @classmethod
    def validate_negative_prompt(cls, v):
        """Validate negative prompt length."""
        if len(v) > 2000:
            raise ValueError("Negative prompt too long (max 2000 characters)")
        return v.strip()
    
    @field_validator('width', 'height')
    @classmethod
    def validate_dimensions(cls, v):
        """Validate dimensions are multiples of 8."""
        if v % 8 != 0:
            raise ValueError("Width and height must be multiples of 8")
        return v


class DigitalHumanGenerationRequest(BaseModel):
    """Request model for digital human video generation."""
    
    positive_prompt: str = Field(..., description="Positive prompt for digital human video generation")
    negative_prompt: str = Field(
        default="bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards",
        description="Negative prompt"
    )
    width: int = Field(default=832, ge=64, le=2048, description="Video width")
    height: int = Field(default=480, ge=64, le=2048, description="Video height")
    steps: int = Field(default=4, ge=1, le=100, description="Sampling steps")
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    cfg: float = Field(default=1.0, ge=0.1, le=20.0, description="CFG scale")
    shift: float = Field(default=8.0, ge=0.1, le=20.0, description="Shift scale")
    reference_video_filename: str = Field(..., description="Reference video filename")
    audio_filename: str = Field(..., description="Audio filename for lip sync")
    
    @field_validator('positive_prompt')
    @classmethod
    def validate_positive_prompt(cls, v):
        """Validate positive prompt is not empty."""
        if not v or not v.strip():
            raise ValueError("Positive prompt cannot be empty")
        if len(v) > 5000:
            raise ValueError("Positive prompt too long (max 5000 characters)")
        return v.strip()
    
    @field_validator('negative_prompt')
    @classmethod
    def validate_negative_prompt(cls, v):
        """Validate negative prompt length."""
        if len(v) > 2000:
            raise ValueError("Negative prompt too long (max 2000 characters)")
        return v.strip()
    
    @field_validator('width', 'height')
    @classmethod
    def validate_dimensions(cls, v):
        """Validate dimensions are multiples of 8."""
        if v % 8 != 0:
            raise ValueError("Width and height must be multiples of 8")
        return v
    
    @field_validator('reference_video_filename', 'audio_filename')
    @classmethod
    def validate_filenames(cls, v):
        """Validate filenames are not empty."""
        if not v or not v.strip():
            raise ValueError("Filename cannot be empty")
        return v.strip() 