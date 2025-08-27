"""
Tests for Pexels video download retry functionality in video composition service.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import tempfile
import os
import time

from app.services.video_composition_service import VideoCompositionService
from app.models import (
    VideoCompositionRequest,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem
)


class TestPexelsRetryFunctionality:
    """Test cases for Pexels video download retry functionality."""
    
    @pytest.fixture
    def service(self):
        """Create a VideoCompositionService instance for testing."""
        with patch('app.services.video_composition_service.settings') as mock_settings:
            mock_settings.pexels_api_keys = ['key1', 'key2', 'key3']
            service = VideoCompositionService()
            return service
    
    @pytest.fixture
    def pexels_video_request(self):
        """Create a video composition request with Pexels URL."""
        return VideoCompositionRequest(
            task_id="test_pexels_retry",
            video_items=[
                VideoCompositionItem(
                    id="pexels_video_1",
                    name="Pexels Test Video",
                    url="https://player.vimeo.com/external/12345.mp4?s=abcd&profile_id=174&oauth2_token_id=pexels",
                    start_time=0.0,
                    duration=10.0,
                    track_id="track_1",
                    clip_start=0.0,
                    clip_end=10.0
                )
            ],
            audio_items=[],
            subtitle_items=[],
            total_duration=10.0
        )
    
    def test_pexels_url_detection(self, service):
        """Test that Pexels URLs are correctly detected."""
        # Test Pexels URLs
        assert service._is_pexels_url("https://player.vimeo.com/external/12345.mp4?oauth2_token_id=pexels")
        assert service._is_pexels_url("https://videos.pexels.com/videos/12345/preview.mp4")
        assert service._is_pexels_url("https://VIDEOS.PEXELS.COM/videos/test.mp4")  # Case insensitive
        
        # Test non-Pexels URLs
        assert not service._is_pexels_url("https://www.youtube.com/watch?v=12345")
        assert not service._is_pexels_url("https://example.com/video.mp4")
        assert not service._is_pexels_url("https://vimeo.com/12345")
    
    def test_load_video_download_config_with_file(self, service):
        """Test loading configuration from existing file."""
        # The config should be loaded during service initialization
        assert hasattr(service, 'video_download_config')
        assert 'pexels' in service.video_download_config
        assert 'retry' in service.video_download_config['pexels']
        
        # Check default values
        retry_config = service.video_download_config['pexels']['retry']
        assert retry_config['max_retries'] == 5
        assert retry_config['switch_api_key_on_retry'] is True
        assert retry_config['retry_delay'] == 2.0
    
    @patch('app.services.video_composition_service.settings')
    def test_pexels_retry_with_success_on_first_attempt(self, mock_settings, service):
        """Test Pexels retry logic when first attempt succeeds."""
        mock_settings.pexels_api_keys = ['key1', 'key2']
        
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            mock_ffmpeg.return_value = {"success": True, "output_path": "/tmp/video.mp4"}
            
            result = service._download_pexels_video_with_retry(
                "https://videos.pexels.com/test.mp4",
                "/tmp/output.mp4",
                12345
            )
            
            assert result["success"] is True
            assert result["output_path"] == "/tmp/video.mp4"
            # Should only call once since first attempt succeeded
            assert mock_ffmpeg.call_count == 1
    
    @patch('app.services.video_composition_service.settings')
    @patch('time.sleep')  # Mock sleep to speed up tests
    def test_pexels_retry_with_success_on_retry(self, mock_sleep, mock_settings, service):
        """Test Pexels retry logic when retry attempt succeeds."""
        mock_settings.pexels_api_keys = ['key1', 'key2', 'key3']
        
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            # First attempt fails, second succeeds
            mock_ffmpeg.side_effect = [
                {"success": False, "error": "Network error"},
                {"success": True, "output_path": "/tmp/video.mp4"}
            ]
            
            result = service._download_pexels_video_with_retry(
                "https://videos.pexels.com/test.mp4",
                "/tmp/output.mp4",
                12345
            )
            
            assert result["success"] is True
            assert result["output_path"] == "/tmp/video.mp4"
            # Should call twice (first fail, second success)
            assert mock_ffmpeg.call_count == 2
            # Should have called sleep once (between first and second attempt)
            mock_sleep.assert_called_once_with(2.0)
    
    @patch('app.services.video_composition_service.settings')
    @patch('time.sleep')
    def test_pexels_retry_all_attempts_fail(self, mock_sleep, mock_settings, service):
        """Test Pexels retry logic when all attempts fail."""
        mock_settings.pexels_api_keys = ['key1', 'key2']
        
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            mock_ffmpeg.return_value = {"success": False, "error": "Persistent error"}
            
            result = service._download_pexels_video_with_retry(
                "https://videos.pexels.com/test.mp4",
                "/tmp/output.mp4",
                12345
            )
            
            assert result["success"] is False
            assert "All Pexels download attempts failed" in result["error"]
            # Should call max_retries + 1 times (5 + 1 = 6)
            assert mock_ffmpeg.call_count == 6
            # Should call sleep 5 times (between each retry)
            assert mock_sleep.call_count == 5
    
    @patch('app.services.video_composition_service.settings')
    def test_pexels_retry_no_api_keys(self, mock_settings, service):
        """Test Pexels retry logic when no API keys are available."""
        mock_settings.pexels_api_keys = []
        
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            mock_ffmpeg.return_value = {"success": True, "output_path": "/tmp/video.mp4"}
            
            result = service._download_pexels_video_with_retry(
                "https://videos.pexels.com/test.mp4",
                "/tmp/output.mp4",
                12345
            )
            
            # Should fallback to regular FFmpeg download
            assert result["success"] is True
            assert mock_ffmpeg.call_count == 1
    
    @patch('app.services.video_composition_service.settings')
    def test_pexels_retry_api_key_rotation(self, mock_settings, service):
        """Test that API keys are rotated during retries."""
        mock_settings.pexels_api_keys = ['key1', 'key2', 'key3']
        
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            mock_ffmpeg.return_value = {"success": False, "error": "Test error"}
            
            # Mock random.choice to return predictable results
            with patch('app.services.video_composition_service.random.choice') as mock_choice:
                mock_choice.side_effect = ['key1', 'key2', 'key3', 'key1', 'key2', 'key3']
                
                result = service._download_pexels_video_with_retry(
                    "https://videos.pexels.com/test.mp4",
                    "/tmp/output.mp4",
                    12345
                )
                
                # Should have tried different keys
                assert mock_choice.call_count >= 1
                assert result["success"] is False
    
    @patch('app.services.video_composition_service.settings')
    def test_download_video_routes_to_pexels_retry(self, mock_settings, service):
        """Test that _download_video correctly routes Pexels URLs to retry logic."""
        mock_settings.pexels_api_keys = ['key1', 'key2']
        
        with patch.object(service, '_download_pexels_video_with_retry') as mock_pexels_retry:
            mock_pexels_retry.return_value = {"success": True, "output_path": "/tmp/video.mp4"}
            
            result = service._download_video(
                "https://videos.pexels.com/test.mp4",
                "/tmp",
                0
            )
            
            assert result["success"] is True
            mock_pexels_retry.assert_called_once()
    
    def test_download_video_routes_to_youtube(self, service):
        """Test that _download_video correctly routes YouTube URLs."""
        with patch.object(service, '_download_youtube_video') as mock_youtube:
            mock_youtube.return_value = {"success": True, "output_path": "/tmp/video.mp4"}
            
            result = service._download_video(
                "https://www.youtube.com/watch?v=12345",
                "/tmp",
                0
            )
            
            assert result["success"] is True
            mock_youtube.assert_called_once()
    
    def test_download_video_routes_to_ffmpeg(self, service):
        """Test that _download_video correctly routes non-special URLs to FFmpeg."""
        with patch.object(service, '_download_video_with_ffmpeg') as mock_ffmpeg:
            mock_ffmpeg.return_value = {"success": True, "output_path": "/tmp/video.mp4"}
            
            result = service._download_video(
                "https://example.com/video.mp4",
                "/tmp",
                0
            )
            
            assert result["success"] is True
            mock_ffmpeg.assert_called_once()
    
    @patch('yaml.safe_load')
    @patch('builtins.open')
    @patch('pathlib.Path.exists')
    def test_config_loading_with_invalid_yaml(self, mock_exists, mock_open, mock_yaml):
        """Test configuration loading with invalid YAML file."""
        mock_exists.return_value = True
        mock_yaml.side_effect = Exception("Invalid YAML")
        
        service = VideoCompositionService()
        
        # Should fall back to default configuration
        assert 'pexels' in service.video_download_config
        assert service.video_download_config['pexels']['retry']['max_retries'] == 5
    
    def test_config_custom_retry_settings(self):
        """Test that custom retry settings are properly loaded."""
        custom_config = {
            'pexels': {
                'retry': {
                    'max_retries': 3,
                    'switch_api_key_on_retry': False,
                    'retry_delay': 1.5
                }
            }
        }
        
        with patch('yaml.safe_load', return_value=custom_config):
            with patch('pathlib.Path.exists', return_value=True):
                service = VideoCompositionService()
                
                retry_config = service.video_download_config['pexels']['retry']
                assert retry_config['max_retries'] == 3
                assert retry_config['switch_api_key_on_retry'] is False
                assert retry_config['retry_delay'] == 1.5 