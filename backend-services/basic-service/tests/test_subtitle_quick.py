#!/usr/bin/env python3
"""
Quick test script for subtitle addition functionality.
This script can be run independently to test the subtitle service.
"""

import os
import sys
import asyncio
import logging
from pathlib import Path

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

from app.models import SubtitleAddRequest
from app.services import SubtitleService

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def main():
    """Main test function."""
    logger.info("=" * 60)
    logger.info("SUBTITLE ADDITION QUICK TEST")
    logger.info("=" * 60)
    
    # Check if test files exist
    video_path = "../datas/merge/video-1.mp4"
    subtitle_path = "../datas/merge/basic-01.srt"
    
    if not os.path.exists(video_path):
        logger.error(f"❌ Test video file not found: {video_path}")
        return False
    
    if not os.path.exists(subtitle_path):
        logger.error(f"❌ Test subtitle file not found: {subtitle_path}")
        return False
    
    logger.info(f"✅ Test files found:")
    logger.info(f"   Video: {video_path} ({os.path.getsize(video_path)} bytes)")
    logger.info(f"   Subtitle: {subtitle_path} ({os.path.getsize(subtitle_path)} bytes)")
    
    # Initialize service
    try:
        service = SubtitleService()
        logger.info("✅ SubtitleService initialized")
    except Exception as e:
        logger.error(f"❌ Failed to initialize SubtitleService: {str(e)}")
        return False
    
    # Create request
    request = SubtitleAddRequest(
        video_file_path=video_path,
        subtitle_file_path=subtitle_path,
        font_size=28,
        font_color="#FFFFFF",
        background_color="#000000",
        border_width=2,
        border_color="#000000",
        position="bottom",
        margin_vertical=60,
        margin_horizontal=40
    )
    
    logger.info("📝 Request parameters:")
    logger.info(f"   Font size: {request.font_size}")
    logger.info(f"   Font color: {request.font_color}")
    logger.info(f"   Position: {request.position}")
    logger.info(f"   Margins: V={request.margin_vertical}, H={request.margin_horizontal}")
    
    # Process subtitles
    logger.info("\n🎬 Processing subtitles...")
    try:
        result = await service.add_subtitles(request)
        
        if result.success:
            logger.info("✅ SUCCESS! Subtitles added successfully")
            logger.info(f"📁 Output video: {result.output_video_path}")
            logger.info(f"📐 Video dimensions: {result.video_width}x{result.video_height}")
            logger.info(f"📝 Subtitle count: {result.subtitle_count}")
            logger.info(f"⏱️  Processing time: {result.processing_time:.2f} seconds")
            logger.info(f"💾 File size: {result.file_size:,} bytes")
            
            # Verify output file exists
            if os.path.exists(result.output_video_path):
                logger.info("✅ Output file verified")
                return True
            else:
                logger.error("❌ Output file not found")
                return False
                
        else:
            logger.error(f"❌ FAILED: {result.message}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Exception during processing: {str(e)}")
        return False


if __name__ == "__main__":
    """Run the quick test."""
    try:
        result = asyncio.run(main())
        
        print("\n" + "=" * 60)
        if result:
            print("🎉 QUICK TEST PASSED!")
            print("You can now test the API endpoint with the server running.")
        else:
            print("💥 QUICK TEST FAILED!")
            print("Check the logs above for error details.")
        print("=" * 60)
        
        sys.exit(0 if result else 1)
        
    except KeyboardInterrupt:
        print("\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Unexpected error: {str(e)}")
        sys.exit(1) 