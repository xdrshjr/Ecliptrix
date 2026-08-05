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
    CameraKeyframe,
    CameraMotion,
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
    ImageToVideoErrorResponse,
    VideoCutClipRequest,
    VideoCutRequest,
    VideoCutClipResult,
    VideoCutResponse
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

from .storage_models import (
    FileUploadResponse,
    StorageUploadResponse,
    StorageUploadErrorResponse,
    MaterialItem,
    UserMaterialsResponse,
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
    VideoAnalysisStatusResponse,
    VideoAnalysisItem,
    BatchVideoAnalysisRequest,
    BatchVideoAnalysisResult,
    BatchVideoAnalysisResponse
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

from .auth_models import (
    UserLogin,
    UserInfo,
    UserLoginResponse,
    UserLoginErrorResponse,
    UserRegistration,
    UserRegistrationResponse,
    PasswordChangeRequest,
    UserUpdateRequest,
    UserUpdateResponse
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

from .queue_models import (
    QueueTask,
    QueueInfo,
    QueueStatusResponse,
    TaskStatusResponse,
    QueueErrorResponse
)

from .silence_removal_models import (
    SilenceSegment,
    SilenceDetectData,
    SilenceDetectRequest,
    SilenceDetectResponse,
    SegmentToRemove,
    SilenceRemoveRequest,
    SilenceRemoveAcceptedData,
    SilenceRemoveAccepted,
    SilenceRemoveResult,
    SilenceProgressData,
    SilenceProgressResponse,
)

__all__ = [
    "BaseResponse",
    "HealthCheckResponse", 
    "ErrorResponse",
    "VideoSearchRequest",
    "VideoInfo",
    "VideoSearchResponse",
    "VideoCompositionItem",
    "CameraKeyframe",
    "CameraMotion",
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
    "VideoCutClipRequest",
    "VideoCutRequest",
    "VideoCutClipResult",
    "VideoCutResponse",
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
    # Storage Models (new)
    "FileUploadResponse",
    "StorageUploadResponse",
    "StorageUploadErrorResponse",
    "MaterialItem",
    "UserMaterialsResponse",
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
    "VideoAnalysisItem",
    "BatchVideoAnalysisRequest",
    "BatchVideoAnalysisResult",
    "BatchVideoAnalysisResponse",
    
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
    "AIMixedEditingErrorResponse",
    
    # Queue Management Models
    "QueueTask",
    "QueueInfo",
    "QueueStatusResponse",
    "TaskStatusResponse",
    "QueueErrorResponse",
    
    # Authentication Models
    "UserLogin",
    "UserInfo",
    "UserLoginResponse",
    "UserLoginErrorResponse",
    "UserRegistration",
    "UserRegistrationResponse",
    "PasswordChangeRequest",
    "UserUpdateRequest",
    "UserUpdateResponse",

    # Silence Removal Models
    "SilenceSegment",
    "SilenceDetectData",
    "SilenceDetectRequest",
    "SilenceDetectResponse",
    "SegmentToRemove",
    "SilenceRemoveRequest",
    "SilenceRemoveAcceptedData",
    "SilenceRemoveAccepted",
    "SilenceRemoveResult",
    "SilenceProgressData",
    "SilenceProgressResponse",
] 