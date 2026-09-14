"""
Tests for video composition service and API endpoints.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
import tempfile
import os

from app.services.video_composition_service import VideoCompositionService
from app.models import (
    VideoCompositionRequest,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem
)


class TestVideoCompositionService:
    """Test cases for VideoCompositionService."""
    
    @pytest.fixture
    def service(self):
        """Create a VideoCompositionService instance for testing."""
        with patch('app.services.video_composition_service.subprocess.run') as mock_run:
            mock_run.return_value.returncode = 0
            service = VideoCompositionService()
            return service
    
    @pytest.fixture
    def sample_video_request(self):
        """Create a sample video composition request."""
        return VideoCompositionRequest(
            task_id="test_task_001",
            video_items=[
                VideoCompositionItem(
                    id="video_1",
                    name="Test Video 1",
                    url="https://example.com/video1.mp4",
                    start_time=0.0,
                    duration=5.0,
                    track_id="track_1"
                ),
                VideoCompositionItem(
                    id="video_2", 
                    name="Test Video 2",
                    url="https://example.com/video2.mp4",
                    start_time=5.0,
                    duration=3.0,
                    track_id="track_1"
                )
            ],
            total_duration=8.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
    
    def test_service_initialization(self, service):
        """Test that the service initializes correctly."""
        assert service is not None
        assert hasattr(service, 'compositions')
        assert hasattr(service, 'output_dir')
        assert service.output_dir.exists()
    
    @patch('app.services.video_composition_service.subprocess.run')
    def test_check_ffmpeg_available(self, mock_run):
        """Test ffmpeg availability check when ffmpeg is available."""
        mock_run.return_value.returncode = 0
        service = VideoCompositionService()
        
        result = service._check_ffmpeg()
        assert result is True
        mock_run.assert_called_with(['ffmpeg', '-version'], 
                                   capture_output=True, check=True)
    
    @patch('app.services.video_composition_service.subprocess.run')
    def test_check_ffmpeg_unavailable(self, mock_run):
        """Test ffmpeg availability check when ffmpeg is not available."""
        mock_run.side_effect = FileNotFoundError()
        service = VideoCompositionService()
        
        result = service._check_ffmpeg()
        assert result is False
    
    @patch('app.services.video_composition_service.cv2.VideoCapture')
    def test_get_video_properties_success(self, mock_cv2, service):
        """Test successful video property extraction."""
        mock_cap = Mock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.side_effect = [1920, 1080, 30.0]  # width, height, fps
        mock_cv2.return_value = mock_cap
        
        width, height, fps = service._get_video_properties("/fake/path.mp4")
        
        assert width == 1920
        assert height == 1080
        assert fps == 30.0
        mock_cap.release.assert_called_once()
    
    @patch('app.services.video_composition_service.cv2.VideoCapture')
    def test_get_video_properties_failure(self, mock_cv2, service):
        """Test video property extraction failure."""
        mock_cap = Mock()
        mock_cap.isOpened.return_value = False
        mock_cv2.return_value = mock_cap
        
        width, height, fps = service._get_video_properties("/fake/path.mp4")

        assert width is None
        assert height is None
        assert fps is None

    @patch('app.services.video_composition_service.probe_video_stream', return_value=None)
    @patch('app.services.video_composition_service.cv2.VideoCapture', side_effect=RuntimeError("codec"))
    def test_get_video_properties_is_empty_when_opencv_raises(self, _mock_cv2, _mock_probe, service):
        """Callers unpack three values; a bare None crashed normalization and subtitles."""
        assert service._get_video_properties("/fake/path.mp4") == (None, None, None)

    @patch('app.services.video_composition_service.cv2.VideoCapture')
    @patch('app.services.video_composition_service.probe_video_stream', return_value=None)
    def test_unprobeable_source_runs_ffprobe_once(self, mock_probe, mock_cv2, service):
        """The OpenCV fallback must not spawn ffprobe (and its 30 s timeout) a second time."""
        mock_cap = Mock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.side_effect = [640, 360, 25.0, 250]  # width, height, fps, frame count
        mock_cv2.return_value = mock_cap

        info = service._describe_source("/fake/path.mp4", "ffmpeg")

        assert mock_probe.call_count == 1
        assert (info.width, info.height, info.duration) == (640, 360, 10.0)
    
    def test_get_composition_status(self, service):
        """Test getting composition status."""
        composition_id = "test_composition_id"
        test_composition = {
            "id": composition_id,
            "status": "processing",
            "progress": 0.5
        }
        service.compositions[composition_id] = test_composition
        
        result = service.get_composition_status(composition_id)
        
        assert result == test_composition
    
    def test_get_composition_status_not_found(self, service):
        """Test getting status for non-existent composition."""
        result = service.get_composition_status("non_existent_id")
        assert result is None
    
    @patch('app.services.video_composition_service.Path')
    def test_get_download_info_success(self, mock_path, service):
        """Test getting download info for completed composition."""
        composition_id = "test_composition_id"
        test_composition = {
            "status": "completed",
            "output_file_path": "/fake/path/video.mp4"
        }
        service.compositions[composition_id] = test_composition
        
        mock_path_obj = Mock()
        mock_path_obj.exists.return_value = True
        mock_path_obj.name = "video.mp4"
        mock_path_obj.stat.return_value.st_size = 1024 * 1024
        mock_path.return_value = mock_path_obj
        
        result = service.get_download_info(composition_id)
        
        assert result is not None
        assert result["file_name"] == "video.mp4"
        assert result["file_size"] == 1024 * 1024
        assert result["composition_id"] == composition_id
    
    def test_get_download_info_not_completed(self, service):
        """Test getting download info for non-completed composition."""
        composition_id = "test_composition_id"
        test_composition = {
            "status": "processing",
            "output_file_path": "/fake/path/video.mp4"
        }
        service.compositions[composition_id] = test_composition
        
        result = service.get_download_info(composition_id)
        assert result is None
    
class TestVideoCompositionModels:
    """Test cases for video composition data models."""
    
    def test_video_composition_item_validation(self):
        """Test VideoCompositionItem validation."""
        # Valid item
        item = VideoCompositionItem(
            id="test_id",
            name="Test Video",
            url="https://example.com/video.mp4",
            start_time=0.0,
            duration=5.0,
            track_id="track_1"
        )
        assert item.id == "test_id"
        assert item.volume == 1.0  # Default value
        assert item.opacity == 1.0  # Default value
    
    def test_video_composition_item_invalid_duration(self):
        """Test VideoCompositionItem with invalid duration."""
        with pytest.raises(ValueError):
            VideoCompositionItem(
                id="test_id",
                name="Test Video", 
                url="https://example.com/video.mp4",
                start_time=0.0,
                duration=0.0,  # Invalid: must be > 0
                track_id="track_1"
            )
    
    def test_video_composition_request_validation(self):
        """Test VideoCompositionRequest validation."""
        video_item = VideoCompositionItem(
            id="video_1",
            name="Test Video",
            url="https://example.com/video.mp4",
            start_time=0.0,
            duration=5.0,
            track_id="track_1"
        )
        
        request = VideoCompositionRequest(
            task_id="test_task",
            video_items=[video_item],
            total_duration=5.0
        )
        
        assert request.task_id == "test_task"
        assert len(request.video_items) == 1
        assert request.output_resolution == {"width": 1920, "height": 1080}  # Default
        assert request.output_fps == 30  # Default
    
    def test_video_composition_request_invalid_resolution(self):
        """Test VideoCompositionRequest with invalid resolution."""
        video_item = VideoCompositionItem(
            id="video_1",
            name="Test Video",
            url="https://example.com/video.mp4",
            start_time=0.0,
            duration=5.0,
            track_id="track_1"
        )
        
        with pytest.raises(ValueError):
            VideoCompositionRequest(
                task_id="test_task",
                video_items=[video_item],
                total_duration=5.0,
                output_resolution={"width": -1920, "height": 1080}  # Invalid width
            )
    
    def test_audio_composition_item_validation(self):
        """Test AudioCompositionItem validation."""
        item = AudioCompositionItem(
            id="audio_1",
            name="Test Audio",
            url="https://example.com/audio.mp3",
            start_time=0.0,
            duration=10.0,
            track_id="audio_track_1"
        )
        
        assert item.id == "audio_1"
        assert item.volume == 1.0  # Default value
    
    def test_subtitle_composition_item_validation(self):
        """Test SubtitleCompositionItem validation."""
        item = SubtitleCompositionItem(
            id="subtitle_1",
            name="Test Subtitle",
            text="Hello World",
            start_time=0.0,
            duration=3.0,
            track_id="subtitle_track_1"
        )
        
        assert item.id == "subtitle_1"
        assert item.text == "Hello World"
        assert item.font_size == 24  # Default value
        assert item.font_color == "#FFFFFF"  # Default value
        assert item.position == "bottom"  # Default value 