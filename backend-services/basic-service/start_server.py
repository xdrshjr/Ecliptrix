#!/usr/bin/env python3
"""
Startup script for the Basic Service.
"""

import uvicorn
import logging
from app.config import settings

if __name__ == "__main__":
    # Configure watchfiles logging before starting uvicorn to prevent excessive logs
    # during video processing when frames are extracted to temp directories
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)
    
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower()
    ) 