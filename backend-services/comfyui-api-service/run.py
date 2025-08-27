#!/usr/bin/env python3
"""
Startup script for the ComfyUI API Service.
"""

import uvicorn
from app.config import settings
from app.logger import logger

def main():
    """Main function to start the FastAPI server."""
    logger.info("Starting ComfyUI API Service...")
    logger.info(f"Server configuration: {settings.host}:{settings.port}")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Log level: {settings.log_level}")
    logger.info(f"ComfyUI base URL: {settings.comfyui.base_url}")
    
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
        access_log=True
    )

if __name__ == "__main__":
    main() 