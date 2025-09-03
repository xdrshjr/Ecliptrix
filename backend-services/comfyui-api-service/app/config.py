"""
Configuration management for the ComfyUI API Service application.
"""

import os
from typing import Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class ComfyUIConfig(BaseModel):
    """ComfyUI specific configuration."""
    base_url: str = Field(..., description="ComfyUI base URL")
    request_timeout: int = Field(default=30, description="Request timeout in seconds")
    max_wait_time: int = Field(default=300, description="Maximum wait time for completion")
    poll_interval: int = Field(default=5, description="Status polling interval in seconds")
    input_dir: str = Field(default=os.getenv("COMFYUI_INPUT_DIR", "./comfyui_input"), description="ComfyUI input directory for uploaded files")


class WorkflowConfig(BaseModel):
    """Default workflow configuration."""
    default_width: int = Field(default=1024, description="Default image width")
    default_height: int = Field(default=1024, description="Default image height")
    default_steps: int = Field(default=20, description="Default sampling steps")
    default_cfg: float = Field(default=1.0, description="Default CFG scale")
    default_guidance: float = Field(default=3.5, description="Default guidance scale")
    default_checkpoint: str = Field(default="flux1-dev-fp8.safetensors", description="Default checkpoint")


class StorageConfig(BaseModel):
    """File storage configuration."""
    static_dir: str = Field(default="static", description="Static files directory")
    generated_images_dir: str = Field(default="static/generated", description="Generated images directory")
    max_image_size_mb: int = Field(default=50, description="Maximum image size in MB")


class Settings(BaseModel):
    """Application settings."""
    # Application
    app_name: str = Field(default="ComfyUI API Service")
    app_version: str = Field(default="1.0.0")
    debug: bool = Field(default=False)
    
    # Server
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    
    # Logging
    log_level: str = Field(default="INFO")
    
    # ComfyUI Configuration
    comfyui: ComfyUIConfig
    workflow: WorkflowConfig = WorkflowConfig()
    storage: StorageConfig = StorageConfig()
    
    def __init__(self, **kwargs):
        # Initialize ComfyUI config from environment variables
        comfyui_config = ComfyUIConfig(
            base_url=os.getenv("COMFYUI_BASE_URL", "http://localhost:8188"),
            request_timeout=int(os.getenv("REQUEST_TIMEOUT", "30")),
            max_wait_time=int(os.getenv("MAX_WAIT_TIME", "300")),
            poll_interval=int(os.getenv("POLL_INTERVAL", "5"))
        )
        
        # Initialize workflow config from environment variables
        workflow_config = WorkflowConfig(
            default_width=int(os.getenv("DEFAULT_WIDTH", "1024")),
            default_height=int(os.getenv("DEFAULT_HEIGHT", "1024")),
            default_steps=int(os.getenv("DEFAULT_STEPS", "20")),
            default_cfg=float(os.getenv("DEFAULT_CFG", "1.0")),
            default_guidance=float(os.getenv("DEFAULT_GUIDANCE", "3.5")),
            default_checkpoint=os.getenv("DEFAULT_CHECKPOINT", "flux1-dev-fp8.safetensors")
        )
        
        # Initialize storage config from environment variables
        storage_config = StorageConfig(
            static_dir=os.getenv("STATIC_DIR", "static"),
            generated_images_dir=os.getenv("GENERATED_IMAGES_DIR", "static/generated"),
            max_image_size_mb=int(os.getenv("MAX_IMAGE_SIZE_MB", "50"))
        )
        
        super().__init__(
            app_name=os.getenv("APP_NAME", "ComfyUI API Service"),
            app_version=os.getenv("APP_VERSION", "1.0.0"),
            debug=os.getenv("DEBUG", "false").lower() == "true",
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8000")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            comfyui=comfyui_config,
            workflow=workflow_config,
            storage=storage_config,
            **kwargs
        )


# Global settings instance
settings = Settings() 