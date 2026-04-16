"""
Voice Clone API request/response models.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class VoiceCloneTrainRequest(BaseModel):
    speaker_id: Optional[str] = Field(
        default=None, description="Unique speaker ID, auto-generated if not provided"
    )
    audio_url: str = Field(
        ..., description="URL or local path of the reference audio file"
    )
    audio_format: Optional[str] = Field(
        default=None, description="Audio format (wav, mp3, ogg, m4a, aac, pcm)"
    )
    language: int = Field(
        default=0,
        description="Language: 0=cn, 1=en, 2=ja, 3=es, 4=id, 5=pt, 6=de, 7=fr",
    )
    text: str = Field(
        ...,
        min_length=1,
        max_length=5000,
        description="Text to synthesize after cloning",
    )
    enable_audio_denoise: bool = Field(default=True, description="Enable audio denoise")


class VoiceCloneStatusRequest(BaseModel):
    speaker_id: str = Field(..., description="Speaker ID to query status for")


class VoiceCloneTrainResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class VoiceCloneStatusResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class AIAudioSynthesizeRequest(BaseModel):
    text: str = Field(
        ..., min_length=1, max_length=5000, description="Text to synthesize"
    )
    voice_type: str = Field(
        ..., description="Voice type ID (existing voice or cloned speaker_id)"
    )
    speed_ratio: float = Field(
        default=1.0, ge=0.5, le=2.0, description="Speech speed ratio"
    )
    is_cloned_voice: bool = Field(
        default=False, description="Whether voice_type is a cloned speaker_id"
    )
