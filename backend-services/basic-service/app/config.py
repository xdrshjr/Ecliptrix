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


class StorageConfig(BaseModel):
    """Local storage configuration."""
    root: str = Field(default="static/uploads", description="Storage root directory")
    max_file_size: int = Field(
        default=524288000,  # 500MB
        description="Maximum file size in bytes"
    )
    allowed_video_types: List[str] = Field(
        default=["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"],
        description="Allowed video MIME types"
    )
    allowed_audio_types: List[str] = Field(
        default=["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4"],
        description="Allowed audio MIME types"
    )
    allowed_image_types: List[str] = Field(
        default=["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
        description="Allowed image MIME types"
    )


class OSSConfig(BaseModel):
    """Alibaba Cloud OSS configuration."""
    enabled: bool = Field(default=False, description="Enable OSS storage")
    access_key_id: str = Field(default="", description="OSS Access Key ID")
    access_key_secret: str = Field(default="", description="OSS Access Key Secret")
    endpoint: str = Field(default="oss-cn-hangzhou.aliyuncs.com", description="OSS endpoint")
    bucket_name: str = Field(default="", description="OSS bucket name")
    cdn_domain: str = Field(default="", description="Optional CDN domain, e.g. https://cdn.example.com")
    key_prefix: str = Field(default="", description="Optional key prefix, e.g. ecliptrix/")


class DatabaseConfig(BaseModel):
    """Database configuration."""
    url: str = Field(
        default="postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix",
        description="Database connection URL"
    )
    pool_size: int = Field(default=10, description="Connection pool size")
    max_overflow: int = Field(default=20, description="Max overflow connections")
    pool_timeout: int = Field(default=30, description="Connection timeout in seconds")
    pool_recycle: int = Field(default=1800, description="Connection recycle time in seconds")


class AuthConfig(BaseModel):
    """Authentication configuration."""
    admin_username: str = Field(default="admin", description="Admin username (deprecated, use root_username)")
    admin_password: str = Field(default="admin", description="Admin password (deprecated, use root_password)")
    root_username: str = Field(default="admin", description="Root user username (falls back to admin_username)")
    root_password: str = Field(default="", description="Root user password (falls back to admin_password)")
    invite_code: str = Field(default="", description="Invite code for self-registration (empty = registration closed)")


class Settings(BaseModel):
    """Application settings configuration."""
    
    # LLM Configuration
    llm_api_key: str = Field(..., description="LLM API key")
    llm_api_url: str = Field(..., description="LLM API base URL")
    llm_model: str = Field(default="deepseek-v3", description="LLM model name")
    
    # Video Cut LLM Configuration (for AI mixed editing)
    video_cut_llm_api_key: str = Field(default="", description="Video Cut LLM API key for AI mixed editing")
    video_cut_llm_api_url: str = Field(default="", description="Video Cut LLM API base URL for AI mixed editing")
    video_cut_llm_model: str = Field(default="claude-sonnet-4-20250514", description="Video Cut LLM model name")
    
    # VL LLM Configuration (for video analysis)
    vl_llm_api_key: str = Field(default="", description="VL LLM API key for video analysis")
    vl_llm_api_url: str = Field(default="", description="VL LLM API base URL for video analysis")
    vl_llm_model: str = Field(default="qwen-vl-plus", description="VL LLM model name")
    
    # PEXELS API Configuration
    pexels_api_keys: List[str] = Field(default=[], description="PEXELS API keys (comma-separated)")
    
    # Volcano TTS Configuration
    volcano_tts_appid: str = Field(default="", description="Volcano TTS App ID")
    volcano_tts_access_token: str = Field(default="", description="Volcano TTS Access Token")
    volcano_tts_secret_key: str = Field(default="", description="Volcano TTS Secret Key")
    
    # Ark API Configuration (Seedance video generation)
    ark_api_key: str = Field(default="", description="ARK API key for Seedance video generation")

    # YouTube Proxy Configuration
    youtube_proxy: str = Field(default="", description="Proxy URL for YouTube access (e.g. socks5://127.0.0.1:1080 or http://127.0.0.1:7890)")
    
    # Database Configuration
    database: DatabaseConfig = Field(default_factory=DatabaseConfig, description="Database configuration")

    # Authentication Configuration
    auth: AuthConfig = Field(default_factory=AuthConfig, description="Authentication configuration")

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

    # OSS Configuration
    oss: OSSConfig = Field(default_factory=OSSConfig)

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
    
    model_config = ConfigDict(
        env_file=".env",
        case_sensitive=False
    )


def load_yaml_config(config_path: str) -> Dict[str, Any]:
    """Load YAML configuration file."""
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as file:
                return yaml.safe_load(file) or {}
    except Exception as e:
        print(f"Warning: Failed to load YAML config from {config_path}: {e}")
    return {}


def get_settings() -> Settings:
    """Get application settings from environment variables."""
    # Parse PEXELS API keys from comma-separated string
    pexels_api_key_str = os.getenv("PEXELS_API_KEY", "")
    pexels_api_keys = [key.strip() for key in pexels_api_key_str.split(",") if key.strip()]
    
    # Load YAML configuration
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    batch_tts_config_path = os.path.join(config_dir, 'batch_tts_config.yaml')
    youtube_config_path = os.path.join(config_dir, 'youtube.yaml')
    watermark_removal_config_path = os.path.join(config_dir, 'watermark_removal_config.yaml')
    upload_config_path = os.path.join(config_dir, 'upload-config.yaml')
    
    batch_tts_yaml_config = load_yaml_config(batch_tts_config_path)
    youtube_yaml_config = load_yaml_config(youtube_config_path)
    watermark_removal_yaml_config = load_yaml_config(watermark_removal_config_path)
    upload_yaml_config = load_yaml_config(upload_config_path)
    
    # Create batch TTS config from YAML
    batch_tts_config = BatchTTSConfig()
    if 'batch_tts' in batch_tts_yaml_config:
        batch_tts_data = batch_tts_yaml_config['batch_tts']
        batch_tts_config = BatchTTSConfig(
            concurrent_threads=batch_tts_data.get('concurrent_threads', 3),
            max_concurrent_threads=batch_tts_data.get('max_concurrent_threads', 10),
            request_timeout=batch_tts_data.get('request_timeout', 30),
            batch_timeout=batch_tts_data.get('batch_timeout', 300),
            retry=BatchTTSRetryConfig(**batch_tts_data.get('retry', {})),
            logging=BatchTTSLoggingConfig(**batch_tts_data.get('logging', {})),
            limits=BatchTTSLimitsConfig(**batch_tts_data.get('limits', {}))
        )
    
    # Create YouTube config from YAML
    youtube_config = YoutubeConfig()
    if youtube_yaml_config:
        download_data = youtube_yaml_config.get('download', {})
        upload_data = youtube_yaml_config.get('upload', {})
        quality_data = youtube_yaml_config.get('quality', {})
        file_management_data = youtube_yaml_config.get('file_management', {})
        logging_data = youtube_yaml_config.get('logging', {})
        
        youtube_config = YoutubeConfig(
            download=YoutubeDownloadConfig(**download_data),
            upload=YoutubeUploadConfig(**upload_data),
            quality=YoutubeQualityConfig(**quality_data),
            file_management=YoutubeFileManagementConfig(**file_management_data),
            logging=YoutubeLoggingConfig(**logging_data)
        )
    
    # Create Watermark Removal config from YAML
    watermark_removal_config = WatermarkRemovalConfig()
    if watermark_removal_yaml_config and 'watermark_removal' in watermark_removal_yaml_config:
        watermark_data = watermark_removal_yaml_config['watermark_removal']
        watermark_removal_config = WatermarkRemovalConfig(
            concurrent_threads=watermark_data.get('concurrent_threads', 5),
            max_concurrent_threads=watermark_data.get('max_concurrent_threads', 10),
            batch_size=watermark_data.get('batch_size', 50),
            batch_timeout=watermark_data.get('batch_timeout', 60),
            logging=WatermarkRemovalLoggingConfig(**watermark_data.get('logging', {}))
        )
    
    # Create Upload config from YAML
    upload_config = UploadConfig()
    if upload_yaml_config:
        concurrent_upload_data = upload_yaml_config.get('concurrent_upload', {})
        file_size_limits_data = upload_yaml_config.get('file_size_limits', {})
        retry_data = upload_yaml_config.get('retry', {})
        thumbnail_data = upload_yaml_config.get('thumbnail', {})
        temp_file_management_data = upload_yaml_config.get('temp_file_management', {})
        logging_data = upload_yaml_config.get('logging', {})
        
        upload_config = UploadConfig(
            concurrent_upload=ConcurrentUploadConfig(**concurrent_upload_data),
            file_size_limits=FileSizeLimitsConfig(**file_size_limits_data),
            retry=UploadRetryConfig(**retry_data),
            thumbnail=ThumbnailConfig(**thumbnail_data),
            temp_file_management=TempFileManagementConfig(**temp_file_management_data),
            logging=UploadLoggingConfig(**logging_data)
        )
    
    # Create Database configuration
    database_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix")
    database_config = DatabaseConfig(
        url=database_url,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800"))
    )

    # Create Storage configuration
    storage_config = StorageConfig(
        root=os.getenv("STORAGE_ROOT", "static/uploads"),
        max_file_size=int(os.getenv("STORAGE_MAX_FILE_SIZE", "524288000"))
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
        invite_code=invite_code
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

    return Settings(
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_api_url=os.getenv("LLM_API_URL", ""),
        llm_model=os.getenv("LLM_MODEL", "deepseek-v3"),
        video_cut_llm_api_key=os.getenv("VIDEO_CUT_LLM_API_KEY", ""),
        video_cut_llm_api_url=os.getenv("VIDEO_CUT_LLM_API_URL", ""),
        video_cut_llm_model=os.getenv("VIDEO_CUT_LLM_MODEL", "claude-sonnet-4-20250514"),
        vl_llm_api_key=os.getenv("VL_LLM_API_KEY", ""),
        vl_llm_api_url=os.getenv("VL_LLM_API_URL", ""),
        vl_llm_model=os.getenv("VL_LLM_MODEL", "qwen-vl-plus"),
        pexels_api_keys=pexels_api_keys,
        volcano_tts_appid=os.getenv("VOLCANO_TTS_APPID", ""),
        volcano_tts_access_token=os.getenv("VOLCANO_TTS_ACCESS_TOKEN", ""),
        volcano_tts_secret_key=os.getenv("VOLCANO_TTS_SECRET_KEY", ""),
        ark_api_key=os.getenv("ARK_API_KEY", ""),
        youtube_proxy=os.getenv("YOUTUBE_PROXY", ""),
        database=database_config,
        auth=auth_config,
        batch_tts=batch_tts_config,
        youtube=youtube_config,
        watermark_removal=watermark_removal_config,
        upload=upload_config,
        storage=storage_config,
        oss=oss_config,
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() == "true",
        temp_dir=os.getenv("TEMP_DIR", "temp")
    )


# Global settings instance
settings = get_settings()

# Startup validation: ROOT_PASSWORD (or ADMIN_PASSWORD fallback) must be explicitly set
if not ***REMOVED***:
    raise RuntimeError(
        "ROOT_PASSWORD (or ADMIN_PASSWORD) is not set. "
        "Please set ROOT_PASSWORD in your .env file. The application cannot start without it."
    )