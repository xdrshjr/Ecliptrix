"""
Configuration management for the Basic Service application.
"""

import os
import yaml
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class BatchTTSRetryConfig(BaseModel):
    """Batch TTS retry configuration."""

    max_attempts: int = 3
    delay_seconds: int = 1
    backoff_factor: int = 2


class BatchTTSLoggingConfig(BaseModel):
    """Batch TTS logging configuration."""

    enable_detailed_logs: bool = True
    log_progress_interval: int = 1
    log_level: str = "INFO"


class BatchTTSLimitsConfig(BaseModel):
    """Batch TTS limits configuration."""

    max_segments_per_batch: int = 50
    max_text_length_per_segment: int = 5000
    max_total_text_length: int = 100000


class BatchTTSConfig(BaseModel):
    """Batch TTS configuration."""

    concurrent_threads: int = 3
    max_concurrent_threads: int = 10
    request_timeout: int = 30
    batch_timeout: int = 300
    retry: BatchTTSRetryConfig = BatchTTSRetryConfig()
    logging: BatchTTSLoggingConfig = BatchTTSLoggingConfig()
    limits: BatchTTSLimitsConfig = BatchTTSLimitsConfig()


class YoutubeDownloadConfig(BaseModel):
    """YouTube download configuration."""

    max_concurrent_downloads: int = 20
    download_timeout: int = 300
    max_retries: int = 3
    retry_delay: int = 5


class YoutubeUploadConfig(BaseModel):
    """YouTube upload configuration."""

    upload_timeout: int = 600
    max_retries: int = 3
    retry_delay: int = 10


class YoutubeQualityConfig(BaseModel):
    """YouTube quality configuration."""

    default_video_quality: str = "720p"
    default_audio_quality: str = "best"
    default_format: str = "mp4"


class YoutubeFileManagementConfig(BaseModel):
    """YouTube file management configuration."""

    auto_cleanup: bool = True
    temp_file_retention_hours: int = 24
    generate_thumbnail: bool = True


class YoutubeLoggingConfig(BaseModel):
    """YouTube logging configuration."""

    enable_detailed_logging: bool = True
    log_download_progress: bool = True
    progress_log_interval: int = 10


class YoutubeConfig(BaseModel):
    """YouTube configuration."""

    download: YoutubeDownloadConfig = YoutubeDownloadConfig()
    upload: YoutubeUploadConfig = YoutubeUploadConfig()
    quality: YoutubeQualityConfig = YoutubeQualityConfig()
    file_management: YoutubeFileManagementConfig = YoutubeFileManagementConfig()
    logging: YoutubeLoggingConfig = YoutubeLoggingConfig()


class WatermarkRemovalLoggingConfig(BaseModel):
    """Watermark removal logging configuration."""

    enable_detailed_logs: bool = True
    log_progress_interval: int = 100
    log_level: str = "INFO"
    enable_thread_logging: bool = True


class WatermarkRemovalConfig(BaseModel):
    """Watermark removal configuration."""

    concurrent_threads: int = 5
    max_concurrent_threads: int = 10
    batch_size: int = 50
    batch_timeout: int = 60
    logging: WatermarkRemovalLoggingConfig = WatermarkRemovalLoggingConfig()


class ConcurrentUploadConfig(BaseModel):
    """Concurrent upload configuration."""

    max_concurrent_uploads: int = 3
    max_queue_size: int = 0
    upload_timeout: int = 300
    enable_queue: bool = True


class FileSizeLimitsConfig(BaseModel):
    """File size limits configuration."""

    max_video_size_mb: int = 500
    max_audio_size_mb: int = 100
    max_image_size_mb: int = 50


class UploadRetryConfig(BaseModel):
    """Upload retry configuration."""

    max_retries: int = 3
    retry_delay: int = 5
    exponential_backoff: bool = True


class ThumbnailConfig(BaseModel):
    """Thumbnail configuration."""

    auto_generate_video_thumbnail: bool = True
    thumbnail_quality: int = 2
    thumbnail_max_width: int = 320
    thumbnail_max_height: int = 180


class TempFileManagementConfig(BaseModel):
    """Temporary file management configuration."""

    auto_cleanup: bool = True
    temp_file_retention_hours: int = 24
    temp_file_directory: str = "temp"


class UploadLoggingConfig(BaseModel):
    """Upload logging configuration."""

    enable_detailed_logging: bool = True
    log_upload_progress: bool = True
    progress_log_interval: int = 10
    log_upload_statistics: bool = True


class UploadConfig(BaseModel):
    """Upload configuration."""

    concurrent_upload: ConcurrentUploadConfig = ConcurrentUploadConfig()
    file_size_limits: FileSizeLimitsConfig = FileSizeLimitsConfig()
    retry: UploadRetryConfig = UploadRetryConfig()
    thumbnail: ThumbnailConfig = ThumbnailConfig()
    temp_file_management: TempFileManagementConfig = TempFileManagementConfig()
    logging: UploadLoggingConfig = UploadLoggingConfig()


class StoryboardVideoGenerationConfig(BaseModel):
    """Storyboard video generation queue configuration."""

    max_concurrent: int = Field(default=3, ge=1, le=64, description="Max concurrent video generation jobs")
    timeout_seconds: int = Field(default=600, ge=10, description="Per-job hard timeout in seconds")
    poll_interval_seconds: int = Field(default=5, ge=1, description="ARK status poll interval")
    job_retention_seconds: int = Field(default=3600, ge=60, description="Terminal-job retention before cleanup")


class StoryboardGenerationConfig(BaseModel):
    """Global concurrency control for chained 2x2 storyboard image generation."""

    max_concurrent: int = Field(
        default=3,
        ge=1,
        le=32,
        description=(
            "Maximum number of concurrent /storyboard/generate pipelines. "
            "Protects ARK Seedream rate limits when many users kick off "
            "multi-batch generations simultaneously."
        ),
    )


class StoryboardConfig(BaseModel):
    """Storyboard configuration (video generation and future storyboard-wide knobs)."""

    video_generation: StoryboardVideoGenerationConfig = Field(
        default_factory=StoryboardVideoGenerationConfig
    )
    generation: StoryboardGenerationConfig = Field(
        default_factory=StoryboardGenerationConfig
    )


class StorageConfig(BaseModel):
    """Local storage configuration."""

    root: str = Field(default="static/uploads", description="Storage root directory")
    max_file_size: int = Field(
        default=524288000,  # 500MB
        description="Maximum file size in bytes",
    )
    allowed_video_types: List[str] = Field(
        default=["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"],
        description="Allowed video MIME types",
    )
    allowed_audio_types: List[str] = Field(
        default=["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/flac", "audio/x-flac"],
        description="Allowed audio MIME types",
    )
    allowed_image_types: List[str] = Field(
        default=["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
        description="Allowed image MIME types",
    )


class OSSConfig(BaseModel):
    """Alibaba Cloud OSS configuration."""

    enabled: bool = Field(default=False, description="Enable OSS storage")
    access_key_id: str = Field(default="", description="OSS Access Key ID")
    access_key_secret: str = Field(default="", description="OSS Access Key Secret")
    endpoint: str = Field(
        default="oss-cn-hangzhou.aliyuncs.com", description="OSS endpoint"
    )
    bucket_name: str = Field(default="", description="OSS bucket name")
    cdn_domain: str = Field(
        default="", description="Optional CDN domain, e.g. https://cdn.example.com"
    )
    key_prefix: str = Field(
        default="", description="Optional key prefix, e.g. ecliptrix/"
    )


class DatabaseConfig(BaseModel):
    """Database configuration."""

    url: str = Field(
        default="postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix",
        description="Database connection URL",
    )
    pool_size: int = Field(default=10, description="Connection pool size")
    max_overflow: int = Field(default=20, description="Max overflow connections")
    pool_timeout: int = Field(default=30, description="Connection timeout in seconds")
    pool_recycle: int = Field(
        default=1800, description="Connection recycle time in seconds"
    )


class AuthConfig(BaseModel):
    """Authentication configuration."""

    admin_username: str = Field(
        default="admin", description="Admin username (deprecated, use root_username)"
    )
    admin_password: str = Field(
        default="admin", description="Admin password (deprecated, use root_password)"
    )
    root_username: str = Field(
        default="admin", description="Root user username (falls back to admin_username)"
    )
    root_password: str = Field(
        default="", description="Root user password (falls back to admin_password)"
    )
    invite_code: str = Field(
        default="",
        description="Invite code for self-registration (empty = registration closed)",
    )


class Settings(BaseModel):
    """Application settings configuration."""

    # LLM Configuration
    llm_api_key: str = Field(..., description="LLM API key")
    llm_api_url: str = Field(..., description="LLM API base URL")
    llm_model: str = Field(default="deepseek-v3", description="LLM model name")
    llm_api_type: str = Field(
        default="openai",
        description="LLM API protocol: 'openai' (default) or 'anthropic'",
    )

    # Video Cut LLM Configuration (for AI mixed editing)
    video_cut_llm_api_key: str = Field(
        default="", description="Video Cut LLM API key for AI mixed editing"
    )
    video_cut_llm_api_url: str = Field(
        default="", description="Video Cut LLM API base URL for AI mixed editing"
    )
    video_cut_llm_model: str = Field(
        default="claude-sonnet-4-20250514", description="Video Cut LLM model name"
    )
    video_cut_llm_api_type: str = Field(
        default="openai",
        description="Video Cut LLM API protocol: 'openai' (default) or 'anthropic'",
    )

    # Fast LLM Configuration (for quick ops: translation, intent detection, search query gen)
    fast_llm_api_key: str = Field(
        default="", description="Fast LLM API key for low-latency utility calls"
    )
    fast_llm_api_url: str = Field(
        default="", description="Fast LLM API base URL"
    )
    fast_llm_model: str = Field(
        default="qwen3-next-80b-a3b-instruct", description="Fast LLM model name"
    )
    fast_llm_api_type: str = Field(
        default="openai",
        description="Fast LLM API protocol: 'openai' (default) or 'anthropic'",
    )

    # VL LLM Configuration (for video analysis)
    vl_llm_api_key: str = Field(
        default="", description="VL LLM API key for video analysis"
    )
    vl_llm_api_url: str = Field(
        default="", description="VL LLM API base URL for video analysis"
    )
    vl_llm_model: str = Field(default="qwen-vl-plus", description="VL LLM model name")
    vl_llm_api_type: str = Field(
        default="openai",
        description="VL LLM API protocol: 'openai' (default) or 'anthropic'",
    )

    # PEXELS API Configuration
    pexels_api_keys: List[str] = Field(
        default=[], description="PEXELS API keys (comma-separated)"
    )

    # Volcano TTS Configuration
    #
    # The synthesis call moved to the V3 大模型语音合成 API on 2026-05-15
    # (endpoint /api/v3/tts/unidirectional). V3 uses a single X-Api-Key header
    # + an X-Api-Resource-Id picker — there is no per-call appid/token/cluster
    # in the request body anymore. The legacy V1 (`appid`/`access_token`/
    # `secret_key`) fields are preserved because the ASR / voice-clone routers
    # still chain-fall back to them; do NOT remove without auditing those.
    volcano_tts_api_key: str = Field(
        default="",
        description=(
            "Volcano TTS V3 API Key (from the new console). Drives "
            "X-Api-Key on /api/v3/tts/unidirectional. Required for V3."
        ),
    )
    volcano_tts_resource_id: str = Field(
        default="seed-tts-2.0",
        description=(
            "Volcano TTS V3 resource id — picks the product/billing tier. "
            "Common values: 'seed-tts-2.0' (character-billed 2.0 voices, "
            "*_uranus_bigtts / saturn_*_tob, default), 'seed-tts-1.0' "
            "(character-billed 1.0 voices, *_moon_bigtts / *_streaming), "
            "'seed-tts-1.0-concurr' (concurrency-billed 1.0)."
        ),
    )
    volcano_tts_appid: str = Field(default="", description="Volcano TTS App ID (LEGACY V1 — still used by ASR/voice-clone fallback chains)")
    volcano_tts_access_token: str = Field(
        default="", description="Volcano TTS Access Token (LEGACY V1)"
    )
    volcano_tts_secret_key: str = Field(
        default="", description="Volcano TTS Secret Key (LEGACY V1)"
    )

    # Volcano ASR (Recording File Recognition / vc) Configuration
    # Falls back to VOLCANO_TTS_* if not provided so older deployments keep working.
    # NOTE: a Volcano APPID's TTS authorization is independent from its ASR
    # authorization — when the same APPID does not have ASR enabled, transcription
    # will fail. In that case set VOLCANO_ASR_* explicitly to an ASR-enabled APPID.
    volcano_asr_appid: str = Field(default="", description="Volcano ASR App ID (LEGACY V1, used only by voice-clone or legacy code paths)")
    volcano_asr_access_token: str = Field(
        default="", description="Volcano ASR Access Token (LEGACY V1)"
    )
    volcano_asr_secret_key: str = Field(
        default="", description="Volcano ASR Secret Key (LEGACY V1)"
    )

    # ASR streaming (大模型流式语音识别 WebSocket). Migrated 2026-05-15 — the
    # previous V3 file-submit path required a publicly fetchable audio URL,
    # which production cannot guarantee. The streaming endpoint authenticates
    # with the legacy-console headers (X-Api-App-Key + X-Api-Access-Key) we
    # already provision via VOLCANO_ASR_APPID / ***REMOVED***.
    # `volcano_asr_api_key` is retained for forward compatibility with the
    # new-console single-key handshake; it is **not** required for the
    # WebSocket path.
    volcano_asr_api_key: str = Field(
        default="",
        description=(
            "Volcano ASR new-console API Key (single X-Api-Key handshake). "
            "Not required by the WebSocket streaming path — kept for the "
            "future migration to the new-console UUID key."
        ),
    )
    volcano_asr_resource_id: str = Field(
        default="volc.bigasr.sauc.duration",
        description=(
            "Volcano ASR streaming resource id (X-Api-Resource-Id header). "
            "Choose the variant that matches the billing tier enabled on the "
            "Volcano console: "
            "'volc.bigasr.sauc.duration' (豆包流式语音识别 1.0, 小时版, default), "
            "'volc.bigasr.sauc.concurrent' (豆包流式语音识别 1.0, 并发版), "
            "'volc.seedasr.sauc.duration' (2.0 小时版), "
            "'volc.seedasr.sauc.concurrent' (2.0 并发版)."
        ),
    )
    asr_max_clip_seconds: int = Field(
        default=300,
        description=(
            "Hard cap on per-clip audio duration before the ASR service "
            "rejects the request with ASR_CLIP_TOO_LONG. The streaming "
            "nostream endpoint's practical upload budget is ~300 s; longer "
            "clips should be split client-side."
        ),
    )

    # Public-facing base URL for this deployment. Retained for legacy callers
    # (V3 file-submit, voice-clone audio fetch links). The new ASR WebSocket
    # path streams bytes directly and does **not** read this value.
    public_base_url: str = Field(
        default="",
        description=(
            "Public HTTPS base URL of this deployment (no trailing slash). "
            "Optional — no longer required by the ASR path. "
            "Example: https://ecliptrix.com"
        ),
    )

    # Volcano Voice Clone Configuration
    volcano_voice_clone_app_key: str = Field(
        default="", description="Volcano Voice Clone App Key (X-Api-App-Key)"
    )
    volcano_voice_clone_access_key: str = Field(
        default="", description="Volcano Voice Clone Access Key (X-Api-Access-Key)"
    )
    volcano_voice_clone_speaker_id_prefix: str = Field(
        default="S_", description="Prefix for auto-generated speaker IDs"
    )
    volcano_voice_clone_tts_resource_id: str = Field(
        default="seed-icl-1.0",
        description="Volcano voice clone X-Api-Resource-Id for TTS synthesis (seed-icl-1.0 | seed-icl-1.0-concurr)",
    )

    # Ark API Configuration (Seedance video generation)
    ark_api_key: str = Field(
        default="", description="ARK API key for Seedance video generation"
    )

    # YouTube Proxy Configuration
    youtube_proxy: str = Field(
        default="",
        description="Proxy URL for YouTube access (e.g. socks5://127.0.0.1:1080 or http://127.0.0.1:7890)",
    )

    # Database Configuration
    database: DatabaseConfig = Field(
        default_factory=DatabaseConfig, description="Database configuration"
    )

    # Authentication Configuration
    auth: AuthConfig = Field(
        default_factory=AuthConfig, description="Authentication configuration"
    )

    # Batch TTS Configuration
    batch_tts: BatchTTSConfig = BatchTTSConfig()

    # YouTube Configuration
    youtube: YoutubeConfig = YoutubeConfig()

    # Watermark Removal Configuration
    watermark_removal: WatermarkRemovalConfig = WatermarkRemovalConfig()

    # Upload Configuration
    upload: UploadConfig = UploadConfig()

    # Storage Configuration
    storage: StorageConfig = Field(default_factory=StorageConfig)

    # Storyboard Configuration (video-generation queue)
    storyboard: StoryboardConfig = Field(default_factory=StoryboardConfig)

    # OSS Configuration
    oss: OSSConfig = Field(default_factory=OSSConfig)

    # Media Proxy Configuration (spec 05)
    media_proxy: "MediaProxyConfig" = Field(
        default_factory=lambda: MediaProxyConfig(),
        description="Same-origin proxy for remote video/image CDNs (spec 05).",
    )

    # Preview Proxy Configuration (spec 06 / phase-3)
    preview_proxy: "PreviewProxyConfig" = Field(
        default_factory=lambda: PreviewProxyConfig(),
        description="FFmpeg low-bitrate transcode pipeline for hi-bitrate assets (spec 06).",
    )

    # Logging Configuration
    log_level: str = Field(default="INFO", description="Logging level")

    # Server Configuration
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=8000, description="Server port")
    debug: bool = Field(default=False, description="Debug mode")

    # File Storage Configuration
    temp_dir: str = Field(default="temp", description="Temporary files directory")

    # Application Configuration
    app_name: str = Field(default="Basic Service API", description="Application name")
    app_version: str = Field(default="1.0.0", description="Application version")

    # Security: URL guard dev escape hatch (spec 03 §7). When True the
    # private-IP / loopback / link-local check in
    # ``app.security.url_guard.validate_external_url`` is bypassed so
    # developers can point yt-dlp / FFmpeg at local mock servers. MUST be
    # left False (the default) in production.
    url_guard_allow_private: bool = Field(
        default=False,
        description=(
            "Dev-only: bypass the private-IP block in validate_external_url. "
            "Set URL_GUARD_ALLOW_PRIVATE=1 in .env to enable. Never enable in prod."
        ),
    )

    # Deployment environment marker (spec 02 V02-A). Drives CORS allowlist
    # behaviour, HSTS emission, and (future) misc env-aware switches.
    # Read from ENV or APP_ENV; default "production" (safe-by-default).
    env: str = Field(
        default="production",
        description=(
            "Deployment environment: 'production' (default), 'development', "
            "'dev', or 'staging'. Set via ENV or APP_ENV env var."
        ),
    )

    # CORS configuration (spec 02 V02-A — replaces `allow_origins=['*']`).
    # `cors_allowed_origins` is a list parsed from CORS_ALLOWED_ORIGINS env
    # (comma-separated). EMPTY in production = deny all cross-origin
    # (safe-by-default). In dev, localhost:3000/3010/127.0.0.1:3000/3010
    # are merged in automatically by main.py.
    cors_allowed_origins: List[str] = Field(
        default_factory=list,
        description=(
            "Comma-separated list of origins allowed for cross-origin "
            "requests (spec 02 V02-A). Empty in prod = block all cross-origin."
        ),
    )
    cors_allow_credentials: bool = Field(
        default=True,
        description=(
            "Whether browsers may send credentials (cookies, Authorization "
            "header) on cross-origin requests. Only meaningful for origins "
            "in `cors_allowed_origins`."
        ),
    )
    cors_legacy_wildcard: bool = Field(
        default=False,
        description=(
            "EMERGENCY ROLLBACK: when True, restore `allow_origins=['*']` + "
            "`allow_credentials=True`. This is a KNOWN VULNERABILITY (V02-A). "
            "Set CORS_LEGACY_WILDCARD=1 in .env only during incident response."
        ),
    )

    # Playback v2 (Phase 4) — telemetry aggregation + admin observability.
    playback_v2_telemetry_agg_window_min: int = Field(
        default=15,
        description="Rolling window (minutes) used by PlaybackMetricsAggregator.",
    )
    playback_v2_telemetry_agg_retention_hours: int = Field(
        default=24,
        description=(
            "How many hours of 1-minute counter buckets the playback metrics "
            "aggregator retains in memory."
        ),
    )
    playback_v2_aggregator_requires_single_worker: bool = Field(
        default=True,
        description=(
            "When true, /api/admin/playback-metrics flags responses as "
            "degraded if more than one gunicorn/uvicorn worker is detected. "
            "Spec Phase 4 §3.2.7 / R-P1-3."
        ),
    )

    model_config = ConfigDict(env_file=".env", case_sensitive=False)


class MediaProxyConfig(BaseModel):
    """Same-origin remote-asset proxy (spec 05 §五).

    Field defaults match the values in
    ``backend-services/basic-service/config/media-proxy-config.yaml``; the
    YAML loader in :func:`get_settings` overrides them at startup, and a
    handful of env vars (``MEDIA_PROXY_MAX_SIZE_MB`` etc.) take final
    precedence per CLAUDE.md "Priority: new env > YAML > default".
    """

    allowed_domains: List[str] = Field(default_factory=list)
    signed_url_domains: List[str] = Field(default_factory=list)
    fetch_timeout_seconds: int = 30
    upstream_connect_timeout_seconds: int = 5
    max_size_mb: int = 1024
    concurrent_downloads: int = 16
    hot_cache_dir: str = "static/uploads/cached_materials"
    enable_http: bool = False
    per_ip_rate_limit_per_min: int = 100
    stream_chunk_size: int = 65536
    oss_bucket_subprefix: str = "media-proxy-cache/"


class PreviewProxyConfig(BaseModel):
    """FFmpeg low-bitrate transcode pipeline (spec 06 §五 / phase-3 §3.2.7).

    Field defaults match
    ``backend-services/basic-service/config/preview-proxy-config.yaml``; the
    YAML loader in :func:`get_settings` overrides them at startup, and a
    handful of env vars take final precedence per CLAUDE.md "Priority: new
    env > YAML > default".
    """

    enabled: bool = True
    max_concurrent_transcode: int = 2
    timeout_seconds: int = 600
    progress_write_interval_ms: int = 1000
    retry_attempts: int = 1
    output_dir: str = "static/uploads/preview-proxies"
    oss_bucket_subprefix: str = "preview-proxies/"


def load_yaml_config(config_path: str) -> Dict[str, Any]:
    """Load YAML configuration file."""
    try:
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as file:
                return yaml.safe_load(file) or {}
    except Exception as e:
        print(f"Warning: Failed to load YAML config from {config_path}: {e}")
    return {}


def get_settings() -> Settings:
    """Get application settings from environment variables."""
    # Parse PEXELS API keys from comma-separated string
    pexels_api_key_str = os.getenv("PEXELS_API_KEY", "")
    pexels_api_keys = [
        key.strip() for key in pexels_api_key_str.split(",") if key.strip()
    ]

    # Load YAML configuration
    config_dir = os.path.join(os.path.dirname(__file__), "..", "config")
    batch_tts_config_path = os.path.join(config_dir, "batch_tts_config.yaml")
    youtube_config_path = os.path.join(config_dir, "youtube.yaml")
    watermark_removal_config_path = os.path.join(
        config_dir, "watermark_removal_config.yaml"
    )
    upload_config_path = os.path.join(config_dir, "upload-config.yaml")
    storyboard_config_path = os.path.join(config_dir, "storyboard-config.yaml")
    media_proxy_config_path = os.path.join(config_dir, "media-proxy-config.yaml")
    preview_proxy_config_path = os.path.join(config_dir, "preview-proxy-config.yaml")

    batch_tts_yaml_config = load_yaml_config(batch_tts_config_path)
    youtube_yaml_config = load_yaml_config(youtube_config_path)
    watermark_removal_yaml_config = load_yaml_config(watermark_removal_config_path)
    upload_yaml_config = load_yaml_config(upload_config_path)
    storyboard_yaml_config = load_yaml_config(storyboard_config_path)
    media_proxy_yaml_config = load_yaml_config(media_proxy_config_path)
    preview_proxy_yaml_config = load_yaml_config(preview_proxy_config_path)

    # Create batch TTS config from YAML
    batch_tts_config = BatchTTSConfig()
    if "batch_tts" in batch_tts_yaml_config:
        batch_tts_data = batch_tts_yaml_config["batch_tts"]
        batch_tts_config = BatchTTSConfig(
            concurrent_threads=batch_tts_data.get("concurrent_threads", 3),
            max_concurrent_threads=batch_tts_data.get("max_concurrent_threads", 10),
            request_timeout=batch_tts_data.get("request_timeout", 30),
            batch_timeout=batch_tts_data.get("batch_timeout", 300),
            retry=BatchTTSRetryConfig(**batch_tts_data.get("retry", {})),
            logging=BatchTTSLoggingConfig(**batch_tts_data.get("logging", {})),
            limits=BatchTTSLimitsConfig(**batch_tts_data.get("limits", {})),
        )

    # Create YouTube config from YAML
    youtube_config = YoutubeConfig()
    if youtube_yaml_config:
        download_data = youtube_yaml_config.get("download", {})
        upload_data = youtube_yaml_config.get("upload", {})
        quality_data = youtube_yaml_config.get("quality", {})
        file_management_data = youtube_yaml_config.get("file_management", {})
        logging_data = youtube_yaml_config.get("logging", {})

        youtube_config = YoutubeConfig(
            download=YoutubeDownloadConfig(**download_data),
            upload=YoutubeUploadConfig(**upload_data),
            quality=YoutubeQualityConfig(**quality_data),
            file_management=YoutubeFileManagementConfig(**file_management_data),
            logging=YoutubeLoggingConfig(**logging_data),
        )

    # Create Watermark Removal config from YAML
    watermark_removal_config = WatermarkRemovalConfig()
    if (
        watermark_removal_yaml_config
        and "watermark_removal" in watermark_removal_yaml_config
    ):
        watermark_data = watermark_removal_yaml_config["watermark_removal"]
        watermark_removal_config = WatermarkRemovalConfig(
            concurrent_threads=watermark_data.get("concurrent_threads", 5),
            max_concurrent_threads=watermark_data.get("max_concurrent_threads", 10),
            batch_size=watermark_data.get("batch_size", 50),
            batch_timeout=watermark_data.get("batch_timeout", 60),
            logging=WatermarkRemovalLoggingConfig(**watermark_data.get("logging", {})),
        )

    # Create Upload config from YAML
    upload_config = UploadConfig()
    if upload_yaml_config:
        concurrent_upload_data = upload_yaml_config.get("concurrent_upload", {})
        file_size_limits_data = upload_yaml_config.get("file_size_limits", {})
        retry_data = upload_yaml_config.get("retry", {})
        thumbnail_data = upload_yaml_config.get("thumbnail", {})
        temp_file_management_data = upload_yaml_config.get("temp_file_management", {})
        logging_data = upload_yaml_config.get("logging", {})

        upload_config = UploadConfig(
            concurrent_upload=ConcurrentUploadConfig(**concurrent_upload_data),
            file_size_limits=FileSizeLimitsConfig(**file_size_limits_data),
            retry=UploadRetryConfig(**retry_data),
            thumbnail=ThumbnailConfig(**thumbnail_data),
            temp_file_management=TempFileManagementConfig(**temp_file_management_data),
            logging=UploadLoggingConfig(**logging_data),
        )

    # Create Database configuration
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix",
    )
    database_config = DatabaseConfig(
        url=database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800")),
    )

    # Create Storyboard configuration
    # Priority for each field: new env > legacy env > YAML > default
    sb_yaml_vg = (storyboard_yaml_config.get("video_generation", {}) or {})

    def _int_env(name: str, fallback: Optional[int] = None) -> Optional[int]:
        raw = os.getenv(name)
        if raw is None or raw == "":
            return fallback
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback

    sb_max_concurrent = (
        _int_env("STORYBOARD_VIDEO_MAX_CONCURRENT")
        or _int_env("STORYBOARD_MAX_CONCURRENT_VIDEO")
        or sb_yaml_vg.get("max_concurrent", 3)
    )
    sb_timeout_seconds = (
        _int_env("STORYBOARD_VIDEO_TIMEOUT_SECONDS")
        or sb_yaml_vg.get("timeout_seconds", 600)
    )
    sb_poll_interval = (
        _int_env("STORYBOARD_VIDEO_POLL_INTERVAL_SECONDS")
        or sb_yaml_vg.get("poll_interval_seconds", 5)
    )
    sb_job_retention = (
        _int_env("STORYBOARD_VIDEO_JOB_RETENTION_SECONDS")
        or sb_yaml_vg.get("job_retention_seconds", 3600)
    )
    sb_yaml_gen = (storyboard_yaml_config.get("generation", {}) or {})
    sb_gen_max_concurrent = (
        _int_env("STORYBOARD_MAX_CONCURRENT_GENERATE")
        or sb_yaml_gen.get("max_concurrent", 3)
    )
    storyboard_config = StoryboardConfig(
        video_generation=StoryboardVideoGenerationConfig(
            max_concurrent=int(sb_max_concurrent),
            timeout_seconds=int(sb_timeout_seconds),
            poll_interval_seconds=int(sb_poll_interval),
            job_retention_seconds=int(sb_job_retention),
        ),
        generation=StoryboardGenerationConfig(
            max_concurrent=int(sb_gen_max_concurrent),
        ),
    )

    # Create Storage configuration
    storage_config = StorageConfig(
        root=os.getenv("STORAGE_ROOT", "static/uploads"),
        max_file_size=int(os.getenv("STORAGE_MAX_FILE_SIZE", "524288000")),
    )

    # Create Authentication configuration
    # ROOT_* takes priority over ADMIN_* for backward compatibility
    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin")
    root_username = os.getenv("ROOT_USERNAME", "") or admin_username
    root_password = os.getenv("ROOT_PASSWORD", "") or admin_password
    invite_code = os.getenv("INVITE_CODE", "")

    auth_config = AuthConfig(
        admin_username=admin_username,
        admin_password=admin_password,
        root_username=root_username,
        root_password=root_password,
        invite_code=invite_code,
    )

    # Create Media Proxy configuration (spec 05 §五)
    mp_yaml = (media_proxy_yaml_config.get("proxy", {}) or {})
    mp_oss_yaml = (media_proxy_yaml_config.get("oss", {}) or {})
    media_proxy_config = MediaProxyConfig(
        allowed_domains=list(mp_yaml.get("allowed_domains") or []),
        signed_url_domains=list(mp_yaml.get("signed_url_domains") or []),
        fetch_timeout_seconds=int(mp_yaml.get("fetch_timeout_seconds", 30)),
        upstream_connect_timeout_seconds=int(
            mp_yaml.get("upstream_connect_timeout_seconds", 5)
        ),
        max_size_mb=int(
            os.getenv("MEDIA_PROXY_MAX_SIZE_MB") or mp_yaml.get("max_size_mb", 1024)
        ),
        concurrent_downloads=int(
            os.getenv("MEDIA_PROXY_CONCURRENT_DOWNLOADS")
            or mp_yaml.get("concurrent_downloads", 16)
        ),
        hot_cache_dir=str(
            mp_yaml.get("hot_cache_dir", "static/uploads/cached_materials")
        ),
        enable_http=bool(mp_yaml.get("enable_http", False)),
        per_ip_rate_limit_per_min=int(mp_yaml.get("per_ip_rate_limit_per_min", 100)),
        stream_chunk_size=int(mp_yaml.get("stream_chunk_size", 65536)),
        oss_bucket_subprefix=str(
            mp_oss_yaml.get("bucket_subprefix", "media-proxy-cache/")
        ),
    )

    # Create Preview Proxy configuration (spec 06 / phase-3 §3.2.7)
    pp_yaml = (preview_proxy_yaml_config.get("preview_proxy", {}) or {})
    pp_oss_yaml = (preview_proxy_yaml_config.get("oss", {}) or {})
    pp_enabled_env = os.getenv("PREVIEW_PROXY_ENABLED")
    if pp_enabled_env is not None and pp_enabled_env != "":
        pp_enabled = pp_enabled_env.lower() == "true"
    else:
        pp_enabled = bool(pp_yaml.get("enabled", True))
    preview_proxy_config = PreviewProxyConfig(
        enabled=pp_enabled,
        max_concurrent_transcode=int(
            os.getenv("PREVIEW_PROXY_MAX_CONCURRENT")
            or pp_yaml.get("max_concurrent_transcode", 2)
        ),
        timeout_seconds=int(
            os.getenv("PREVIEW_PROXY_TIMEOUT_SECONDS")
            or pp_yaml.get("timeout_seconds", 600)
        ),
        progress_write_interval_ms=int(
            pp_yaml.get("progress_write_interval_ms", 1000)
        ),
        retry_attempts=int(pp_yaml.get("retry_attempts", 1)),
        output_dir=str(
            os.getenv("PREVIEW_PROXY_OUTPUT_DIR")
            or pp_yaml.get("output_dir", "static/uploads/preview-proxies")
        ),
        oss_bucket_subprefix=str(
            pp_oss_yaml.get("bucket_subprefix", "preview-proxies/")
        ),
    )

    # Create OSS configuration
    oss_config = OSSConfig(
        enabled=os.getenv("OSS_ENABLED", "false").lower() == "true",
        access_key_id=os.getenv("OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.getenv("OSS_ACCESS_KEY_SECRET", ""),
        endpoint=os.getenv("OSS_ENDPOINT", "oss-cn-hangzhou.aliyuncs.com"),
        bucket_name=os.getenv("OSS_BUCKET_NAME", ""),
        cdn_domain=os.getenv("OSS_CDN_DOMAIN", ""),
        key_prefix=os.getenv("OSS_KEY_PREFIX", ""),
    )

    # Playback v2 Phase 4 settings.
    pv2_window = int(
        os.getenv("PLAYBACK_V2_TELEMETRY_AGG_WINDOW_MIN") or 15
    )
    pv2_retention = int(
        os.getenv("PLAYBACK_V2_TELEMETRY_AGG_RETENTION_HOURS") or 24
    )
    pv2_single_worker = (
        os.getenv("PLAYBACK_V2_AGGREGATOR_REQUIRES_SINGLE_WORKER", "true").lower()
        != "false"
    )

    return Settings(
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_api_url=os.getenv("LLM_API_URL", ""),
        llm_model=os.getenv("LLM_MODEL", "deepseek-v3"),
        llm_api_type=os.getenv("LLM_API_TYPE", "openai"),
        video_cut_llm_api_key=os.getenv("VIDEO_CUT_LLM_API_KEY", ""),
        video_cut_llm_api_url=os.getenv("VIDEO_CUT_LLM_API_URL", ""),
        video_cut_llm_model=os.getenv(
            "VIDEO_CUT_LLM_MODEL", "claude-sonnet-4-20250514"
        ),
        video_cut_llm_api_type=os.getenv("VIDEO_CUT_LLM_API_TYPE", "openai"),
        fast_llm_api_key=os.getenv("FAST_LLM_API_KEY", ""),
        fast_llm_api_url=os.getenv("FAST_LLM_API_URL", ""),
        fast_llm_model=os.getenv(
            "FAST_LLM_MODEL", "qwen3-next-80b-a3b-instruct"
        ),
        fast_llm_api_type=os.getenv("FAST_LLM_API_TYPE", "openai"),
        vl_llm_api_key=os.getenv("VL_LLM_API_KEY", ""),
        vl_llm_api_url=os.getenv("VL_LLM_API_URL", ""),
        vl_llm_model=os.getenv("VL_LLM_MODEL", "qwen-vl-plus"),
        vl_llm_api_type=os.getenv("VL_LLM_API_TYPE", "openai"),
        pexels_api_keys=pexels_api_keys,
        volcano_tts_api_key=os.getenv("VOLCANO_TTS_API_KEY", ""),
        volcano_tts_resource_id=os.getenv("VOLCANO_TTS_RESOURCE_ID", "seed-tts-2.0"),
        volcano_tts_appid=os.getenv("VOLCANO_TTS_APPID", ""),
        volcano_tts_access_token=os.getenv("VOLCANO_TTS_ACCESS_TOKEN", ""),
        volcano_tts_secret_key=os.getenv("VOLCANO_TTS_SECRET_KEY", ""),
        volcano_asr_appid=os.getenv(
            "VOLCANO_ASR_APPID", os.getenv("VOLCANO_TTS_APPID", "")
        ),
        volcano_asr_access_token=os.getenv(
            "***REMOVED***", os.getenv("VOLCANO_TTS_ACCESS_TOKEN", "")
        ),
        volcano_asr_secret_key=os.getenv(
            "VOLCANO_ASR_SECRET_KEY", os.getenv("VOLCANO_TTS_SECRET_KEY", "")
        ),
        volcano_asr_api_key=os.getenv(
            "VOLCANO_ASR_API_KEY", os.getenv("VOLCANO_TTS_API_KEY", "")
        ),
        volcano_asr_resource_id=os.getenv(
            "VOLCANO_ASR_RESOURCE_ID", "volc.bigasr.sauc.duration"
        ),
        asr_max_clip_seconds=int(os.getenv("ASR_MAX_CLIP_SECONDS", "300")),
        public_base_url=os.getenv("PUBLIC_BASE_URL", ""),
        volcano_voice_clone_app_key=os.getenv(
            "VOLCANO_VOICE_CLONE_APP_KEY", os.getenv("VOLCANO_TTS_APPID", "")
        ),
        volcano_voice_clone_access_key=os.getenv(
            "VOLCANO_VOICE_CLONE_ACCESS_KEY", os.getenv("VOLCANO_TTS_ACCESS_TOKEN", "")
        ),
        volcano_voice_clone_speaker_id_prefix=os.getenv(
            "VOLCANO_VOICE_CLONE_SPEAKER_ID_PREFIX", "S_"
        ),
        volcano_voice_clone_tts_resource_id=os.getenv(
            "VOLCANO_VOICE_CLONE_TTS_RESOURCE_ID", "seed-icl-1.0"
        ),
        ark_api_key=os.getenv("ARK_API_KEY", ""),
        youtube_proxy=os.getenv("YOUTUBE_PROXY", ""),
        database=database_config,
        auth=auth_config,
        batch_tts=batch_tts_config,
        youtube=youtube_config,
        watermark_removal=watermark_removal_config,
        upload=upload_config,
        storage=storage_config,
        storyboard=storyboard_config,
        oss=oss_config,
        media_proxy=media_proxy_config,
        preview_proxy=preview_proxy_config,
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() == "true",
        temp_dir=os.getenv("TEMP_DIR", "temp"),
        playback_v2_telemetry_agg_window_min=pv2_window,
        playback_v2_telemetry_agg_retention_hours=pv2_retention,
        playback_v2_aggregator_requires_single_worker=pv2_single_worker,
        url_guard_allow_private=(
            os.getenv("URL_GUARD_ALLOW_PRIVATE", "false").lower()
            in {"1", "true", "yes", "on"}
        ),
        env=(os.getenv("ENV") or os.getenv("APP_ENV") or "production").strip() or "production",
        cors_allowed_origins=[
            o.strip()
            for o in (os.getenv("CORS_ALLOWED_ORIGINS") or "").split(",")
            if o.strip()
        ],
        cors_allow_credentials=(
            os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower()
            in {"1", "true", "yes", "on"}
        ),
        cors_legacy_wildcard=(
            os.getenv("CORS_LEGACY_WILDCARD", "false").lower()
            in {"1", "true", "yes", "on"}
        ),
    )


# Global settings instance
settings = get_settings()

# Startup validation: ROOT_PASSWORD (or ADMIN_PASSWORD fallback) must be explicitly set
if not ***REMOVED***:
    raise RuntimeError(
        "ROOT_PASSWORD (or ADMIN_PASSWORD) is not set. "
        "Please set ROOT_PASSWORD in your .env file. The application cannot start without it."
    )
