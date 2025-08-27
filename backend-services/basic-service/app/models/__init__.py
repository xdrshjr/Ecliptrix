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
    ImageCompositionItem,
    ImagePosition,
    VideoCompositionRequest,
    VideoCompositionResponse,
    VideoDownloadRequest,
    VideoDownloadResponse,
    AspectRatio,
    SubtitleAddRequest,
    SubtitleAddResponse,
    VideoProcessingStage,
    VideoProcessingError,
    CompositionErrorDetails
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

from .audio_models import (
    SubtitleItem,
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
    AudioTranscriptionErrorResponse,
    AudioTranscriptionStatus,
    AudioItemRequest,
    BatchAudioTranscriptionRequest,
    AudioItemTranscription,
    BatchAudioTranscriptionResponse,
    BatchAudioTranscriptionErrorResponse
)

from .audio_search_models import (
    AudioSearchRequest,
    AudioInfo,
    AudioSearchResponse
)

from .video_analysis import (
    FrameAnalysis,
    VideoAnalysisRequest,
    VideoAnalysisResponse,
    VideoAnalysisStatusResponse
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
    "ImageCompositionItem",
    "ImagePosition",
    "VideoCompositionRequest",
    "VideoCompositionResponse",
    "VideoDownloadRequest",
    "VideoDownloadResponse",
    "AspectRatio",
    "SubtitleAddRequest",
    "SubtitleAddResponse",
    "VideoProcessingStage",
    "VideoProcessingError", 
    "CompositionErrorDetails",
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
    "BatchAudioUploadResponse",
    "SubtitleItem",
    "AudioTranscriptionRequest",
    "AudioTranscriptionResponse",
    "AudioTranscriptionErrorResponse",
    "AudioTranscriptionStatus",
    "AudioItemRequest",
    "BatchAudioTranscriptionRequest",
    "AudioItemTranscription",
    "BatchAudioTranscriptionResponse",
    "BatchAudioTranscriptionErrorResponse",
    
    # Audio Search Models
    "AudioSearchRequest",
    "AudioInfo",
    "AudioSearchResponse",
    
    # Video Analysis Models
    "FrameAnalysis",
    "VideoAnalysisRequest", 
    "VideoAnalysisResponse",
    "VideoAnalysisStatusResponse"
] 