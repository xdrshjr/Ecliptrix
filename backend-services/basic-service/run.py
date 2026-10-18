#!/usr/bin/env python3
"""
Startup script for the Basic Service.
"""

import asyncio
import sys
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
    
    if sys.platform == "win32":
        # 浏览器路径需要 playwright 子进程：Windows 下必须用 Proactor 循环
        # （Selector 不支持子进程创建）。显式构造而不是 asyncio.Runner
        # (loop_factory=...)——该参数 Python 3.12 才引入，本项目支持
        # 3.10+（spec 评审 R-V2-01）。
        config = uvicorn.Config(
            "app.main:app", host=settings.host, port=settings.port,
            reload=False, workers=1, log_level=settings.log_level.lower())
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(uvicorn.Server(config).serve())
        finally:
            loop.close()
        return

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