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


class Settings(BaseModel):
    """Application settings configuration."""
    
    # LLM Configuration
    llm_api_key: str = Field(..., description="LLM API key")
    llm_api_url: str = Field(..., description="LLM API base URL")
    
    # PEXELS API Configuration
    pexels_api_keys: List[str] = Field(default=[], description="PEXELS API keys (comma-separated)")
    
    # Volcano TTS Configuration
    volcano_tts_appid: str = Field(default="", description="Volcano TTS App ID")
    volcano_tts_access_token: str = Field(default="", description="Volcano TTS Access Token")
    volcano_tts_secret_key: str = Field(default="", description="Volcano TTS Secret Key")
    
    # Batch TTS Configuration
    batch_tts: BatchTTSConfig = BatchTTSConfig()
    
    # Logging Configuration
    log_level: str = Field(default="INFO", description="Logging level")
    
    # Server Configuration
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=8000, description="Server port")
    debug: bool = Field(default=False, description="Debug mode")
    
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
    yaml_config = load_yaml_config(batch_tts_config_path)
    
    # Create batch TTS config from YAML
    batch_tts_config = BatchTTSConfig()
    if 'batch_tts' in yaml_config:
        batch_tts_data = yaml_config['batch_tts']
        batch_tts_config = BatchTTSConfig(
            concurrent_threads=batch_tts_data.get('concurrent_threads', 3),
            max_concurrent_threads=batch_tts_data.get('max_concurrent_threads', 10),
            request_timeout=batch_tts_data.get('request_timeout', 30),
            batch_timeout=batch_tts_data.get('batch_timeout', 300),
            retry=BatchTTSRetryConfig(**batch_tts_data.get('retry', {})),
            logging=BatchTTSLoggingConfig(**batch_tts_data.get('logging', {})),
            limits=BatchTTSLimitsConfig(**batch_tts_data.get('limits', {}))
        )
    
    return Settings(
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_api_url=os.getenv("LLM_API_URL", ""),
        pexels_api_keys=pexels_api_keys,
        volcano_tts_appid=os.getenv("VOLCANO_TTS_APPID", ""),
        volcano_tts_access_token=os.getenv("VOLCANO_TTS_ACCESS_TOKEN", ""),
        volcano_tts_secret_key=os.getenv("VOLCANO_TTS_SECRET_KEY", ""),
        batch_tts=batch_tts_config,
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() == "true"
    )


# Global settings instance
settings = get_settings() 