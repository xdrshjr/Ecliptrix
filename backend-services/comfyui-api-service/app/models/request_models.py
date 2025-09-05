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


class AIVideoGenerationRequest(BaseModel):
    """Request model for AI video generation using WanVideo workflow."""
    
    positive_prompt: str = Field(..., description="Positive prompt for AI video generation")
    negative_prompt: str = Field(
        default="色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
        description="Negative prompt"
    )
    width: int = Field(default=600, ge=64, le=2048, description="Video width")
    height: int = Field(default=800, ge=64, le=2048, description="Video height")
    duration_seconds: int = Field(default=5, ge=1, le=30, description="Video duration in seconds")
    steps: int = Field(default=8, ge=1, le=100, description="Sampling steps")
    seed: Optional[int] = Field(default=None, description="Random seed for reproducibility")
    enable_lora: bool = Field(default=True, description="Whether to enable LoRA for enhanced quality")
    aspect_ratio: Optional[str] = Field(
        default=None, 
        description="Common aspect ratios (16:9, 9:16, 1:1, 4:3). Overrides width/height if specified"
    )
    
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
    
    @field_validator('aspect_ratio')
    @classmethod
    def validate_aspect_ratio(cls, v):
        """Validate aspect ratio format."""
        if v is None:
            return v
        
        valid_ratios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]
        if v not in valid_ratios:
            raise ValueError(f"Invalid aspect ratio. Supported: {valid_ratios}")
        return v
    
    def get_dimensions_from_aspect_ratio(self) -> tuple[int, int]:
        """Calculate width and height from aspect ratio."""
        if not self.aspect_ratio:
            return self.width, self.height
        
        # Common resolutions for different aspect ratios
        ratio_map = {
            "16:9": (800, 448),   # Wide format
            "9:16": (448, 800),   # Vertical/portrait
            "1:1": (640, 640),    # Square
            "4:3": (640, 480),    # Traditional 4:3
            "3:4": (480, 640),    # Portrait 4:3
            "21:9": (896, 384),   # Ultra-wide
        }
        
        base_width, base_height = ratio_map.get(self.aspect_ratio, (self.width, self.height))
        
        # Ensure dimensions are multiples of 64 for better compatibility
        width = ((base_width + 31) // 64) * 64
        height = ((base_height + 31) // 64) * 64
        
        return width, height 