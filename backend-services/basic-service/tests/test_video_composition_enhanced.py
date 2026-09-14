"""
Tests for the enhanced video composition service with improved audio processing.
"""

import os
import tempfile
import shutil
from unittest.mock import patch
import pytest

from app.services import video_composition_service as composition_module
from app.services.video_composition_service import VideoCompositionService
from app.models.video_models import (
    VideoCompositionRequest,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem
)
from tests.composition_harness import FakeFfmpeg


class TestEnhancedVideoCompositionService:
    """Test cases for enhanced VideoCompositionService."""

    def setup_method(self):
        """Set up test fixtures."""
        self.service = VideoCompositionService()
        self.temp_dir = tempfile.mkdtemp()

        # Create test audio files
        self.test_audio_file = os.path.join(self.temp_dir, "test_audio.mp3")
        with open(self.test_audio_file, 'w') as f:
            f.write("fake audio content")

        # Create static audio directory structure
        self.static_audio_dir = os.path.join(self.temp_dir, "static", "audio", "generated")
        os.makedirs(self.static_audio_dir, exist_ok=True)

        self.tts_audio_file = os.path.join(self.static_audio_dir, "tts_test.mp3")
        with open(self.tts_audio_file, 'w') as f:
            f.write("fake tts audio content")

    def teardown_method(self):
        """Clean up test fixtures."""
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def _generated_audio_in_temp_dir(self, monkeypatch):
        """Generated audio resolves against STORAGE_ROOT, not the CWD (N-11)."""
        from pathlib import Path

        monkeypatch.setattr(
            composition_module, "audio_generated_dir", lambda: Path(self.static_audio_dir),
        )
        monkeypatch.setattr(
            composition_module, "legacy_audio_generated_dir", lambda: Path(self.static_audio_dir),
        )

    def test_convert_url_to_local_path_server_url(self, monkeypatch):
        """Test conversion of server URL to local path."""
        self._generated_audio_in_temp_dir(monkeypatch)

        result = self.service._convert_url_to_local_path("/api/audio/generated/tts_test.mp3")

        assert os.path.normpath(result) == os.path.normpath(self.tts_audio_file)
        assert os.path.exists(result)

    def test_convert_url_to_local_path_http_url(self, monkeypatch):
        """Test handling of HTTP URLs."""
        # DNS resolution is not what this test pins (fake-ip networks reject it).
        monkeypatch.setattr(composition_module, "validate_external_url", lambda url: url)
        http_url = "http://example.com/audio.mp3"
        result = self.service._convert_url_to_local_path(http_url)
        assert result == http_url

    def test_convert_url_to_local_path_local_file(self):
        """Test handling of local file paths."""
        result = self.service._convert_url_to_local_path(self.test_audio_file)
        assert result == self.test_audio_file

    def test_convert_url_to_local_path_file_not_found(self):
        """Test handling of non-existent files."""
        with pytest.raises(FileNotFoundError):
            self.service._convert_url_to_local_path("/nonexistent/path/audio.mp3")

    @patch('subprocess.run')
    def test_process_audio_tracks_single_track(self, mock_subprocess):
        """Test processing of a single audio track."""
        # Mock successful subprocess call
        mock_subprocess.side_effect = FakeFfmpeg()

        # Create test request with single audio item
        audio_item = AudioCompositionItem(
            id="audio_1",
            name="Test Audio",
            url=self.test_audio_file,
            start_time=0.0,
            duration=5.0,
            track_id="audio-track-1",
            volume=0.8
        )

        request = VideoCompositionRequest(
            task_id="test_task",
            video_items=[],
            audio_items=[audio_item],
            total_duration=10.0
        )

        result = self.service._process_audio_tracks(request, self.temp_dir, "ffmpeg", 10.0)

        assert result.path is not None
        assert result.path.endswith("audio_mix.wav")
        mock_subprocess.assert_called_once()

        # Verify command arguments
        call_args = mock_subprocess.call_args[0][0]
        assert "ffmpeg" in call_args
        assert self.test_audio_file in call_args
        assert "volume=0.8" in call_args

    @patch('subprocess.run')
    def test_process_audio_tracks_server_url(self, mock_subprocess, monkeypatch):
        """Test processing of server URL audio tracks."""
        self._generated_audio_in_temp_dir(monkeypatch)
        mock_subprocess.side_effect = FakeFfmpeg()

        # Create test request with server URL
        audio_item = AudioCompositionItem(
            id="tts_audio_1",
            name="TTS Generated Audio",
            url="/api/audio/generated/tts_test.mp3",
            start_time=0.0,
            duration=5.0,
            track_id="audio-track-1",
            volume=1.0
        )

        request = VideoCompositionRequest(
            task_id="test_task",
            video_items=[],
            audio_items=[audio_item],
            total_duration=10.0
        )

        result = self.service._process_audio_tracks(request, self.temp_dir, "ffmpeg", 10.0)

        assert result.path is not None
        mock_subprocess.assert_called_once()

        # Verify that server URL was converted to local path
        call_args = mock_subprocess.call_args[0][0]
        expected = os.path.normpath(self.tts_audio_file)
        assert any(os.path.normpath(str(arg)) == expected for arg in call_args)
