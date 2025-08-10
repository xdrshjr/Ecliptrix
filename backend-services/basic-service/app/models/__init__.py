"""
Data models for the Basic Service application.
"""

from .base_models import (
    BaseResponse,
    HealthCheckResponse,
    ErrorResponse
)

from .video_models import (
    VideoSearchRequest,
    VideoInfo,
    VideoSearchResponse,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem,
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoDownloadRequest,
    VideoDownloadResponse
)

from .tts_models import (
    TTSRequest,
    TTSResponse,
    VoiceType,
    TTSErrorResponse,
    VoiceTypeInfo,
    VoiceTypesResponse,
    BatchTTSRequest,
    BatchTTSResponse,
    BatchTTSSegmentRequest,
    BatchTTSSegmentResult
)

from .supabase_models import (
    SupabaseUploadRequest,
    SupabaseUploadResponse,
    SupabaseUploadErrorResponse,
    AudioUploadRequest,
    AudioUploadResponse,
    BatchAudioUploadRequest,
    BatchAudioUploadResponse
)

__all__ = [
    "BaseResponse",
    "HealthCheckResponse", 
    "ErrorResponse",
    "VideoSearchRequest",
    "VideoInfo",
    "VideoSearchResponse",
    "VideoCompositionItem",
    "AudioCompositionItem", 
    "SubtitleCompositionItem",
    "VideoCompositionRequest",
    "VideoCompositionResponse",
    "VideoDownloadRequest",
    "VideoDownloadResponse",
    "TTSRequest",
    "TTSResponse",
    "VoiceType",
    "TTSErrorResponse",
    "VoiceTypeInfo",
    "VoiceTypesResponse",
    "BatchTTSRequest",
    "BatchTTSResponse",
    "BatchTTSSegmentRequest",
    "BatchTTSSegmentResult",
    "SupabaseUploadRequest",
    "SupabaseUploadResponse",
    "SupabaseUploadErrorResponse",
    "AudioUploadRequest",
    "AudioUploadResponse",
    "BatchAudioUploadRequest",
    "BatchAudioUploadResponse"
] 