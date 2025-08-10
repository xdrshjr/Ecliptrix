"""
Configuration management for the Basic Service application.
"""

import os
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


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


def get_settings() -> Settings:
    """Get application settings from environment variables."""
    # Parse PEXELS API keys from comma-separated string
    pexels_api_key_str = os.getenv("PEXELS_API_KEY", "")
    pexels_api_keys = [key.strip() for key in pexels_api_key_str.split(",") if key.strip()]
    
    return Settings(
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_api_url=os.getenv("LLM_API_URL", ""),
        pexels_api_keys=pexels_api_keys,
        volcano_tts_appid=os.getenv("VOLCANO_TTS_APPID", ""),
        volcano_tts_access_token=os.getenv("VOLCANO_TTS_ACCESS_TOKEN", ""),
        volcano_tts_secret_key=os.getenv("VOLCANO_TTS_SECRET_KEY", ""),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() == "true"
    )


# Global settings instance
settings = get_settings() 