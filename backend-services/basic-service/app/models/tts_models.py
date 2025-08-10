"""
Text-to-Speech (TTS) models for Volcano TTS API integration.
"""

from typing import Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field


class VoiceType(str, Enum):
    """Available voice types for TTS conversion."""
    
    # Chinese Female Voices
    ZH_FEMALE_WANQUDASHU_MOON_BIGTTS = "zh_female_wanqudashu_moon_bigtts"
    ZH_FEMALE_SWEET = "zh_female_sweet"
    ZH_FEMALE_GENTLE = "zh_female_gentle"
    
    # Chinese Male Voices
    ZH_MALE_WARM = "zh_male_warm"
    ZH_MALE_POWERFUL = "zh_male_powerful"
    ZH_MALE_STEADY = "zh_male_steady"
    
    # English Voices
    EN_FEMALE_NATURAL = "en_female_natural"
    EN_MALE_NATURAL = "en_male_natural"


class TTSRequest(BaseModel):
    """Request model for text-to-speech conversion."""
    
    text: str = Field(..., description="Text to convert to speech", max_length=5000)
    voice_type: VoiceType = Field(
        default=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
        description="Voice type for speech synthesis"
    )
    speed_ratio: float = Field(default=1.0, description="Speech speed ratio", ge=0.5, le=2.0)
    segment_id: Optional[str] = Field(None, description="Script segment ID for reference")
    task_id: Optional[str] = Field(None, description="Task ID for reference")
    
    class Config:
        json_schema_extra = {
            "example": {
                "text": "这是一段需要转换为语音的文本内容。",
                "voice_type": "zh_female_wanqudashu_moon_bigtts",
                "speed_ratio": 1.0,
                "segment_id": "segment_001",
                "task_id": "task_123"
            }
        }


class TTSResponse(BaseModel):
    """Response model for successful text-to-speech conversion."""
    
    success: bool = Field(True, description="Conversion success status")
    message: str = Field(default="语音转换成功", description="Response message")
    data: Dict[str, Any] = Field(..., description="Response data")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "语音转换成功",
                "data": {
                    "audio_url": "/api/audio/generated/audio_12345.mp3",
                    "duration": 15.5,
                    "file_size": 248576,
                    "voice_type": "zh_female_wanqudashu_moon_bigtts",
                    "text_length": 45,
                    "request_id": "req_67890"
                }
            }
        }


class TTSErrorResponse(BaseModel):
    """Response model for failed text-to-speech conversion."""
    
    success: bool = Field(False, description="Conversion success status")
    message: str = Field(..., description="Error message")
    error_code: Optional[str] = Field(None, description="Error code")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "message": "语音转换失败：文本内容为空",
                "error_code": "EMPTY_TEXT",
                "details": {
                    "request_id": "req_67890",
                    "timestamp": "2024-01-15T10:30:00Z"
                }
            }
        }


class VoiceTypeInfo(BaseModel):
    """Information about available voice types."""
    
    id: str = Field(..., description="Voice type identifier")
    name: str = Field(..., description="Display name")
    language: str = Field(..., description="Language code")
    gender: str = Field(..., description="Voice gender")
    description: str = Field(..., description="Voice description")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "zh_female_wanqudashu_moon_bigtts",
                "name": "温柔女声",
                "language": "zh-CN",
                "gender": "female",
                "description": "温柔甜美的女性声音，适合讲解和叙述"
            }
        }


class VoiceTypesResponse(BaseModel):
    """Response model for voice types list."""
    
    success: bool = Field(True, description="Request success status")
    message: str = Field(default="获取音色列表成功", description="Response message")
    data: Dict[str, VoiceTypeInfo] = Field(..., description="Available voice types")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "获取音色列表成功",
                "data": {
                    "zh_female_wanqudashu_moon_bigtts": {
                        "id": "zh_female_wanqudashu_moon_bigtts",
                        "name": "温柔女声",
                        "language": "zh-CN",
                        "gender": "female",
                        "description": "温柔甜美的女性声音，适合讲解和叙述"
                    }
                }
            }
        } 