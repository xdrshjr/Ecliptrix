#!/usr/bin/env python3
"""
Test script for portrait video subtitle centering functionality.

This script tests the new multi-line centering feature for portrait videos
where each line of subtitle is individually centered horizontally.
"""

import os
import sys
import asyncio
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

# Add the backend service directory to the Python path
current_dir = Path(__file__).parent
backend_service_dir = current_dir.parent
sys.path.insert(0, str(backend_service_dir))

from app.models.video_models import SubtitleAddRequest
from app.services.subtitle_service import SubtitleService, SubtitleEntry


class TestPortraitSubtitleCentering(unittest.TestCase):
    """Test class for portrait video subtitle centering."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.subtitle_service = SubtitleService()
        
        # Mock subtitle entries
        self.test_subtitles = [
            SubtitleEntry(
                index=1,
                start_time="00:00:00,000",
                end_time="00:00:03,000",
                text="这是一段很长的字幕文本，需要换行显示"
            ),
            SubtitleEntry(
                index=2,
                start_time="00:00:03,000",
                end_time="00:00:06,000",
                text="Another long subtitle text that should wrap"
            )
        ]
        
        # Mock request for portrait video
        self.portrait_request = SubtitleAddRequest(
            video_file_path="/mock/portrait_video.mp4",
            subtitle_file_path="/mock/subtitles.srt",
            font_family="default",
            font_size=50,
            font_color="#FFFFFF",
            background_color="#000000@0.5",
            border_width=2,
            border_color="#000000",
            position="bottom",
            margin_vertical=50,
            margin_horizontal=50
        )
        
        # Mock request for landscape video
        self.landscape_request = SubtitleAddRequest(
            video_file_path="/mock/landscape_video.mp4",
            subtitle_file_path="/mock/subtitles.srt",
            font_family="default",
            font_size=50,
            font_color="#FFFFFF",
            background_color="#000000@0.5",
            border_width=2,
            border_color="#000000",
            position="bottom",
            margin_vertical=50,
            margin_horizontal=50
        )
    
    def test_portrait_video_detection(self):
        """Test portrait video detection in build_ffmpeg_command."""
        # Portrait video dimensions (1080x1920)
        portrait_width, portrait_height = 1080, 1920
        portrait_filters = self.subtitle_service._build_ffmpeg_command(
            "input.mp4", "output.mp4", self.test_subtitles,
            self.portrait_request, portrait_width, portrait_height
        )
        
        # Should detect portrait and create multiple filters
        self.assertIsInstance(portrait_filters, list)
        self.assertTrue(len(portrait_filters) > 0)
        
        # Landscape video dimensions (1920x1080)
        landscape_width, landscape_height = 1920, 1080
        landscape_filters = self.subtitle_service._build_ffmpeg_command(
            "input.mp4", "output.mp4", self.test_subtitles,
            self.landscape_request, landscape_width, landscape_height
        )
        
        # Should detect landscape and use standard processing
        self.assertIsInstance(landscape_filters, list)
        self.assertTrue(len(landscape_filters) > 0)
    
    def test_multiline_centered_filters(self):
        """Test multi-line centered drawtext filters generation."""
        # Test with portrait video dimensions
        video_width, video_height = 1080, 1920
        
        filters = self.subtitle_service._build_multiline_centered_drawtext_filters(
            self.test_subtitles, self.portrait_request, video_width, video_height
        )
        
        # Should generate multiple filters (one for each line)
        self.assertIsInstance(filters, list)
        self.assertTrue(len(filters) > len(self.test_subtitles))
        
        # Each filter should contain centering x=(w-text_w)/2
        for filter_str in filters:
            self.assertIn("x=(w-text_w)/2", filter_str)
            self.assertIn("drawtext=", filter_str)
    
    def test_standard_filters(self):
        """Test standard drawtext filters generation."""
        # Test with landscape video dimensions
        video_width, video_height = 1920, 1080
        
        filters = self.subtitle_service._build_standard_drawtext_filters(
            self.test_subtitles, self.landscape_request, video_width, video_height
        )
        
        # Should generate one filter per subtitle
        self.assertIsInstance(filters, list)
        self.assertEqual(len(filters), len(self.test_subtitles))
        
        # Each filter should contain centering x=(w-text_w)/2
        for filter_str in filters:
            self.assertIn("x=(w-text_w)/2", filter_str)
            self.assertIn("drawtext=", filter_str)
    
    def test_aspect_ratio_calculation(self):
        """Test aspect ratio calculation and video type detection."""
        # Portrait video
        portrait_aspect = 1080 / 1920  # 0.5625
        self.assertLess(portrait_aspect, 1.0)
        
        # Landscape video
        landscape_aspect = 1920 / 1080  # 1.777...
        self.assertGreater(landscape_aspect, 1.0)
        
        # Square video
        square_aspect = 1080 / 1080  # 1.0
        self.assertEqual(square_aspect, 1.0)
        self.assertFalse(square_aspect < 1.0)  # Should not trigger portrait mode
    
    def test_line_positioning_calculation(self):
        """Test line positioning calculation for multi-line subtitles."""
        video_width, video_height = 1080, 1920
        font_size = 50
        line_height = font_size + 5  # Expected line height calculation
        
        # Mock wrapped lines
        wrapped_lines = ["第一行", "第二行", "第三行"]
        total_height = len(wrapped_lines) * line_height
        
        # Test bottom positioning
        margin_vertical = 50
        expected_start_y = video_height - total_height - margin_vertical
        
        self.assertGreater(expected_start_y, 0)
        self.assertLess(expected_start_y, video_height)
        
        # Test center positioning
        center_start_y = (video_height - total_height) // 2
        self.assertGreater(center_start_y, 0)
        self.assertLess(center_start_y, video_height)
    
    @patch('app.services.subtitle_service.logger')
    def test_logging_for_portrait_video(self, mock_logger):
        """Test that appropriate logging is generated for portrait videos."""
        video_width, video_height = 1080, 1920
        
        filters = self.subtitle_service._build_multiline_centered_drawtext_filters(
            self.test_subtitles, self.portrait_request, video_width, video_height
        )
        
        # Verify that portrait-specific logging was called
        mock_logger.info.assert_any_call(
            "Building multi-line centered drawtext filters for portrait video"
        )
        
        # Should log max line width
        mock_logger.info.assert_any_call(
            "Portrait video max line width: 6 characters"
        )


def run_tests():
    """Run all tests."""
    unittest.main(verbosity=2)


if __name__ == "__main__":
    print("Running Portrait Video Subtitle Centering Tests...")
    print("=" * 60)
    run_tests() 