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
    CompositionErrorDetails,
    ImageToVideoEffect,
    ImageToVideoRequest,
    ImageToVideoResponse,
    ImageToVideoErrorResponse
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
    BatchTTSSegmentResult,
    SentenceTTSRequest,
    SentenceBatchTTSRequest,
    SentenceTTSResult,
    SentenceBatchTTSResponse
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

from .runninghub_models import (
    TaskStatus,
    NodeInfo,
    FluxGenerationRequest,
    FluxGenerationResponse,
    FluxGenerationStatusResponse,
    FluxGenerationResultResponse,
    FluxGenerationErrorResponse,
    RunningHubCreateTaskRequest,
    RunningHubCreateTaskResponse,
    RunningHubStatusRequest,
    RunningHubStatusResponse,
    RunningHubResultsRequest,
    RunningHubResultsResponse,
    RunningHubResultFile
)

from .timeline_export_models import (
    TimelineItemModel,
    TrackModel,
    TimelineStateModel,
    MaterialModel,
    ExportMetadataModel,
    TimelineExportDataModel,
    TimelineExportRequest,
    TimelineExportResponse,
    TimelineExportErrorResponse
)

from .timeline_import_models import (
    TimelineImportRequest,
    TimelineImportValidationResult,
    ProcessedImportData,
    TimelineImportResponse,
    TimelineImportErrorResponse,
    ImportFileUploadRequest
)

from .chat_models import (
    VideoChatRequest,
    VideoChatErrorResponse
)

from .ai_mixed_editing_models import (
    MaterialItemModel,
    AIMixedEditingRequest,
    AIMixedEditingResponse,
    AIMixedEditingErrorResponse
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
    "SentenceTTSRequest",
    "SentenceBatchTTSRequest",
    "SentenceTTSResult",
    "SentenceBatchTTSResponse",
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
    "VideoAnalysisStatusResponse",
    
    # RunningHub Models
    "TaskStatus",
    "NodeInfo",
    "FluxGenerationRequest",
    "FluxGenerationResponse",
    "FluxGenerationStatusResponse",
    "FluxGenerationResultResponse",
    "FluxGenerationErrorResponse",
    "RunningHubCreateTaskRequest",
    "RunningHubCreateTaskResponse",
    "RunningHubStatusRequest",
    "RunningHubStatusResponse",
    "RunningHubResultsRequest",
    "RunningHubResultsResponse",
    "RunningHubResultFile",
    
    # Timeline Export Models
    "TimelineItemModel",
    "TrackModel", 
    "TimelineStateModel",
    "MaterialModel",
    "ExportMetadataModel",
    "TimelineExportDataModel",
    "TimelineExportRequest",
    "TimelineExportResponse",
    "TimelineExportErrorResponse",
    
    # Timeline Import Models
    "TimelineImportRequest",
    "TimelineImportValidationResult",
    "ProcessedImportData",
    "TimelineImportResponse",
    "TimelineImportErrorResponse",
    "ImportFileUploadRequest",
    
    # Chat Models
    "VideoChatRequest",
    "VideoChatErrorResponse",
    
    # AI Mixed Editing Models
    "MaterialItemModel",
    "AIMixedEditingRequest",
    "AIMixedEditingResponse",
    "AIMixedEditingErrorResponse"
] 