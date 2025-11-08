#!/usr/bin/env python3
"""
Startup script for the Basic Service.
"""

import uvicorn
import logging
from app.config import settings
from app.logger import logger

def main():
    """Main function to start the FastAPI server."""
    # Configure watchfiles logging before starting uvicorn to prevent excessive logs
    # during video processing when frames are extracted to temp directories
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)
    
    logger.info("Starting Basic Service...")
    logger.info(f"Server configuration: {settings.host}:{settings.port}")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Log level: {settings.log_level}")
    
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