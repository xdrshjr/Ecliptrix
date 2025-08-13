"""
Test script for subtitle addition functionality.
Tests the /video/add-subtitles endpoint with the sample files in datas/merge.
"""

import os
import sys
import asyncio
import pytest
import httpx
from pathlib import Path

# Add the parent directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.models import SubtitleAddRequest, SubtitleAddResponse
from app.services import SubtitleService
from app.logger import get_logger

logger = get_logger(__name__)


class TestSubtitleAdd:
    """Test cases for subtitle addition functionality."""
    
    @pytest.fixture
    def subtitle_service(self):
        """Create a SubtitleService instance for testing."""
        return SubtitleService()
    
    @pytest.fixture
    def sample_video_path(self):
        """Path to the sample video file."""
        return "datas/merge/video-1.mp4"
    
    @pytest.fixture
    def sample_subtitle_path(self):
        """Path to the sample subtitle file."""
        return "datas/merge/basic-01.srt"
    
    @pytest.fixture
    def valid_request(self, sample_video_path, sample_subtitle_path):
        """Create a valid subtitle addition request."""
        return SubtitleAddRequest(
            video_file_path=sample_video_path,
            subtitle_file_path=sample_subtitle_path,
            font_size=24,
            font_color="#FFFFFF",
            background_color="#000000",
            border_width=2,
            border_color="#000000",
            position="bottom",
            margin_vertical=50,
            margin_horizontal=50
        )
    
    def test_sample_files_exist(self, sample_video_path, sample_subtitle_path):
        """Test that the required sample files exist."""
        assert os.path.exists(sample_video_path), f"Sample video file not found: {sample_video_path}"
        assert os.path.exists(sample_subtitle_path), f"Sample subtitle file not found: {sample_subtitle_path}"
        
        # Check file sizes
        video_size = os.path.getsize(sample_video_path)
        subtitle_size = os.path.getsize(sample_subtitle_path)
        
        assert video_size > 0, "Video file is empty"
        assert subtitle_size > 0, "Subtitle file is empty"
        
        logger.info(f"Sample files validated - Video: {video_size} bytes, Subtitle: {subtitle_size} bytes")
    
    def test_subtitle_service_initialization(self, subtitle_service):
        """Test that the SubtitleService initializes correctly."""
        assert subtitle_service is not None
        assert subtitle_service.output_dir.exists()
        logger.info("SubtitleService initialized successfully")
    
    def test_parse_srt_file(self, subtitle_service, sample_subtitle_path):
        """Test SRT file parsing."""
        subtitles = subtitle_service._parse_srt_file(sample_subtitle_path)
        
        assert len(subtitles) > 0, "No subtitles parsed from SRT file"
        
        # Check first subtitle entry
        first_subtitle = subtitles[0]
        assert first_subtitle.index == 1
        assert first_subtitle.start_time == "00:00.20"
        assert first_subtitle.end_time == "00:03.02"
        assert "大家好欢迎来到今天的视频教程" in first_subtitle.text
        
        logger.info(f"Successfully parsed {len(subtitles)} subtitle entries")
        for i, subtitle in enumerate(subtitles[:3]):  # Log first 3 entries
            logger.info(f"Subtitle {i+1}: {subtitle}")
    
    def test_get_video_properties(self, subtitle_service, sample_video_path):
        """Test video properties extraction."""
        width, height, fps = subtitle_service._get_video_properties(sample_video_path)
        
        assert width is not None and width > 0, "Invalid video width"
        assert height is not None and height > 0, "Invalid video height"
        assert fps is not None and fps > 0, "Invalid video FPS"
        
        logger.info(f"Video properties: {width}x{height} @ {fps}fps")
    
    def test_calculate_max_line_width(self, subtitle_service):
        """Test line width calculation."""
        # Test with typical video dimensions
        width_720p = subtitle_service._calculate_max_line_width(1280, 24, 50)
        width_1080p = subtitle_service._calculate_max_line_width(1920, 24, 50)
        
        assert 20 <= width_720p <= 100, f"Invalid line width for 720p: {width_720p}"
        assert 20 <= width_1080p <= 100, f"Invalid line width for 1080p: {width_1080p}"
        assert width_1080p > width_720p, "1080p should have wider line width than 720p"
        
        logger.info(f"Line width calculations - 720p: {width_720p}, 1080p: {width_1080p}")
    
    def test_wrap_text(self, subtitle_service):
        """Test text wrapping functionality."""
        long_text = "这是一个很长的字幕文本，需要被自动换行以适应视频的宽度限制，确保字幕不会超出视频边缘。"
        wrapped_lines = subtitle_service._wrap_text(long_text, 30)
        
        assert len(wrapped_lines) > 1, "Long text should be wrapped into multiple lines"
        
        # Check that no line exceeds the limit
        for line in wrapped_lines:
            assert len(line) <= 30, f"Line exceeds character limit: '{line}' ({len(line)} chars)"
        
        logger.info(f"Text wrapped into {len(wrapped_lines)} lines:")
        for i, line in enumerate(wrapped_lines):
            logger.info(f"  Line {i+1}: '{line}' ({len(line)} chars)")
    
    def test_convert_time_to_seconds(self, subtitle_service):
        """Test time conversion from SRT format to seconds."""
        test_cases = [
            ("00:00.20", 0.2),
            ("00:03.02", 3.02),
            ("01:30.50", 90.5),
            ("02:15.75", 135.75)
        ]
        
        for time_str, expected_seconds in test_cases:
            result = subtitle_service._convert_time_to_seconds(time_str)
            assert abs(result - expected_seconds) < 0.01, f"Time conversion failed for {time_str}: got {result}, expected {expected_seconds}"
        
        logger.info("Time conversion tests passed")
    
    @pytest.mark.asyncio
    async def test_add_subtitles_success(self, subtitle_service, valid_request):
        """Test successful subtitle addition."""
        result = await subtitle_service.add_subtitles(valid_request)
        
        assert result.success, f"Subtitle addition failed: {result.message}"
        assert result.output_video_path is not None, "Output video path not provided"
        assert os.path.exists(result.output_video_path), f"Output video file not created: {result.output_video_path}"
        
        # Check metadata
        assert result.video_width is not None and result.video_width > 0
        assert result.video_height is not None and result.video_height > 0
        assert result.subtitle_count is not None and result.subtitle_count > 0
        assert result.processing_time is not None and result.processing_time > 0
        assert result.file_size is not None and result.file_size > 0
        
        logger.info(f"Subtitle addition successful:")
        logger.info(f"  Output: {result.output_video_path}")
        logger.info(f"  Video: {result.video_width}x{result.video_height}")
        logger.info(f"  Subtitles: {result.subtitle_count}")
        logger.info(f"  Processing time: {result.processing_time:.2f}s")
        logger.info(f"  File size: {result.file_size} bytes")
    
    @pytest.mark.asyncio
    async def test_add_subtitles_invalid_video_path(self, subtitle_service, sample_subtitle_path):
        """Test subtitle addition with invalid video path."""
        request = SubtitleAddRequest(
            video_file_path="nonexistent/video.mp4",
            subtitle_file_path=sample_subtitle_path,
            font_size=24
        )
        
        result = await subtitle_service.add_subtitles(request)
        
        assert not result.success, "Should fail with invalid video path"
        assert "not found" in result.message.lower()
        
        logger.info(f"Invalid video path test passed: {result.message}")
    
    @pytest.mark.asyncio
    async def test_add_subtitles_invalid_subtitle_path(self, subtitle_service, sample_video_path):
        """Test subtitle addition with invalid subtitle path."""
        request = SubtitleAddRequest(
            video_file_path=sample_video_path,
            subtitle_file_path="nonexistent/subtitle.srt",
            font_size=24
        )
        
        result = await subtitle_service.add_subtitles(request)
        
        assert not result.success, "Should fail with invalid subtitle path"
        assert "not found" in result.message.lower()
        
        logger.info(f"Invalid subtitle path test passed: {result.message}")
    
    @pytest.mark.asyncio
    async def test_different_font_sizes(self, subtitle_service, valid_request):
        """Test subtitle addition with different font sizes."""
        font_sizes = [12, 18, 24, 36, 48]
        
        for font_size in font_sizes:
            request = valid_request.model_copy()
            request.font_size = font_size
            
            result = await subtitle_service.add_subtitles(request)
            
            assert result.success, f"Failed with font size {font_size}: {result.message}"
            assert os.path.exists(result.output_video_path), f"Output not created for font size {font_size}"
            
            logger.info(f"Font size {font_size} test passed - Output: {result.output_video_path}")
    
    @pytest.mark.asyncio
    async def test_different_positions(self, subtitle_service, valid_request):
        """Test subtitle addition with different positions."""
        positions = ["top", "center", "bottom"]
        
        for position in positions:
            request = valid_request.model_copy()
            request.position = position
            
            result = await subtitle_service.add_subtitles(request)
            
            assert result.success, f"Failed with position {position}: {result.message}"
            assert os.path.exists(result.output_video_path), f"Output not created for position {position}"
            
            logger.info(f"Position {position} test passed - Output: {result.output_video_path}")


# Standalone test functions for manual execution
async def test_basic_functionality():
    """Basic test that can be run independently."""
    logger.info("Starting basic subtitle addition test...")
    
    service = SubtitleService()
    
    request = SubtitleAddRequest(
        video_file_path="datas/merge/video-1.mp4",
        subtitle_file_path="datas/merge/basic-01.srt",
        font_size=28,
        font_color="#FFFFFF",
        background_color="#000000",
        border_width=2,
        border_color="#000000",
        position="bottom",
        margin_vertical=60,
        margin_horizontal=40
    )
    
    result = await service.add_subtitles(request)
    
    if result.success:
        logger.info("✅ Basic test PASSED")
        logger.info(f"Output video: {result.output_video_path}")
        logger.info(f"Processing time: {result.processing_time:.2f}s")
        return True
    else:
        logger.error("❌ Basic test FAILED")
        logger.error(f"Error: {result.message}")
        return False


async def test_api_endpoint():
    """Test the API endpoint directly."""
    logger.info("Testing API endpoint...")
    
    # This would require the server to be running
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "http://localhost:8000/video/add-subtitles",
                json={
                    "video_file_path": "datas/merge/video-1.mp4",
                    "subtitle_file_path": "datas/merge/basic-01.srt",
                    "font_size": 24,
                    "font_color": "#FFFFFF",
                    "position": "bottom"
                }
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info("✅ API endpoint test PASSED")
                logger.info(f"Response: {result}")
                return True
            else:
                logger.error(f"❌ API endpoint test FAILED - Status: {response.status_code}")
                logger.error(f"Response: {response.text}")
                return False
                
    except Exception as e:
        logger.warning(f"API endpoint test skipped (server not running?): {str(e)}")
        return None


if __name__ == "__main__":
    """Run tests when script is executed directly."""
    import logging
    
    # Set up logging for standalone execution
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    async def run_tests():
        """Run all standalone tests."""
        logger.info("=" * 60)
        logger.info("SUBTITLE ADDITION TEST SUITE")
        logger.info("=" * 60)
        
        # Test 1: Basic functionality
        logger.info("\n1. Testing basic functionality...")
        basic_result = await test_basic_functionality()
        
        # Test 2: API endpoint (if server is running)
        logger.info("\n2. Testing API endpoint...")
        api_result = await test_api_endpoint()
        
        # Summary
        logger.info("\n" + "=" * 60)
        logger.info("TEST SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Basic functionality: {'✅ PASSED' if basic_result else '❌ FAILED'}")
        
        if api_result is True:
            logger.info("API endpoint: ✅ PASSED")
        elif api_result is False:
            logger.info("API endpoint: ❌ FAILED")
        else:
            logger.info("API endpoint: ⚠️ SKIPPED (server not running)")
        
        return basic_result
    
    # Run the tests
    result = asyncio.run(run_tests())
    sys.exit(0 if result else 1) 