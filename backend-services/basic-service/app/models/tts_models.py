"""
Text-to-Speech (TTS) models for Volcano TTS API integration.
"""

from typing import Optional, Dict, Any, List
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


class BatchTTSSegmentRequest(BaseModel):
    """Single segment request for batch TTS conversion."""
    
    segment_id: str = Field(..., description="Unique segment identifier")
    text: str = Field(..., description="Text to convert to speech", max_length=5000)
    title: Optional[str] = Field(None, description="Segment title for reference")


class BatchTTSRequest(BaseModel):
    """Request model for batch text-to-speech conversion."""
    
    segments: List[BatchTTSSegmentRequest] = Field(
        ..., 
        description="List of text segments to convert",
        min_items=1,
        max_items=50
    )
    voice_type: VoiceType = Field(
        default=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
        description="Voice type for speech synthesis"
    )
    speed_ratio: float = Field(default=1.0, description="Speech speed ratio", ge=0.5, le=2.0)
    task_id: Optional[str] = Field(None, description="Task ID for reference")
    concurrent_threads: Optional[int] = Field(
        None, 
        description="Number of concurrent threads (overrides config)",
        ge=1,
        le=10
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "segments": [
                    {
                        "segment_id": "segment-1",
                        "text": "大家好，欢迎来到今天的视频教程。",
                        "title": "开场介绍"
                    },
                    {
                        "segment_id": "segment-2", 
                        "text": "今天我们要学习如何使用这个强大的视频编辑工具。",
                        "title": "功能演示"
                    }
                ],
                "voice_type": "zh_female_wanqudashu_moon_bigtts",
                "speed_ratio": 1.0,
                "task_id": "task_123",
                "concurrent_threads": 3
            }
        }


class BatchTTSSegmentResult(BaseModel):
    """Result for a single segment in batch TTS conversion."""
    
    segment_id: str = Field(..., description="Segment identifier")
    success: bool = Field(..., description="Conversion success status for this segment")
    audio_url: Optional[str] = Field(None, description="Generated audio file URL")
    duration: Optional[float] = Field(None, description="Audio duration in seconds")
    file_size: Optional[int] = Field(None, description="Audio file size in bytes")
    error: Optional[str] = Field(None, description="Error message if conversion failed")
    processing_time: Optional[float] = Field(None, description="Processing time in seconds")


class BatchTTSResponse(BaseModel):
    """Response model for batch text-to-speech conversion."""
    
    success: bool = Field(..., description="Overall batch success status")
    message: str = Field(..., description="Response message")
    total_segments: int = Field(..., description="Total number of segments processed")
    successful_segments: int = Field(..., description="Number of successfully processed segments")
    failed_segments: int = Field(..., description="Number of failed segments")
    total_processing_time: float = Field(..., description="Total processing time in seconds")
    results: List[BatchTTSSegmentResult] = Field(..., description="Individual segment results")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "批量语音转换完成",
                "total_segments": 2,
                "successful_segments": 2,
                "failed_segments": 0,
                "total_processing_time": 12.5,
                "results": [
                    {
                        "segment_id": "segment-1",
                        "success": True,
                        "audio_url": "/api/audio/generated/tts_segment-1_20240101_abc123.mp3",
                        "duration": 5.2,
                        "file_size": 83456,
                        "processing_time": 6.1
                    },
                    {
                        "segment_id": "segment-2",
                        "success": True,
                        "audio_url": "/api/audio/generated/tts_segment-2_20240101_def456.mp3",
                        "duration": 7.8,
                        "file_size": 124928,
                        "processing_time": 6.4
                    }
                ]
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
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "message": "语音转换失败：文本内容过长",
                "error_code": "TEXT_TOO_LONG"
            }
        }


class VoiceTypeInfo(BaseModel):
    """Information about a specific voice type."""
    
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