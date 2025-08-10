"""
Test cases for video composition timeline functionality.
Specifically testing the fix for video truncation when audio is shorter than video.
"""

import pytest
import tempfile
import os
from unittest.mock import Mock, patch, MagicMock
from app.services.video_composition_service import VideoCompositionService
from app.models.video_models import (
    VideoCompositionRequest, 
    VideoCompositionItem, 
    AudioCompositionItem
)


class TestVideoCompositionTimeline:
    """Test video composition with timeline-based duration calculations."""
    
    @pytest.fixture
    def video_service(self):
        """Create a video composition service for testing."""
        return VideoCompositionService()
    
    @pytest.fixture
    def mock_ffmpeg_success(self):
        """Mock successful ffmpeg execution."""
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Success"
        mock_result.stderr = ""
        return mock_result
    
    def test_video_not_truncated_when_audio_shorter(self, video_service, mock_ffmpeg_success):
        """
        Test that video is not truncated when audio track is shorter than video content.
        
        Scenario:
        - Video content: 25 seconds total (two clips: 15s + 10s)
        - Audio content: 13 seconds
        - Expected result: 25 second video with 13s audio + 12s silence
        """
        # Create test request with longer video than audio
        request = VideoCompositionRequest(
            task_id="test_timeline_duration_fix",
            video_items=[
                VideoCompositionItem(
                    id="video1",
                    name="First Video Clip",
                    url="http://example.com/video1.mp4",
                    start_time=0.0,
                    duration=15.0,  # 15 seconds
                    track_id="video-track-1",
                    volume=1.0,
                    opacity=1.0
                ),
                VideoCompositionItem(
                    id="video2", 
                    name="Second Video Clip",
                    url="http://example.com/video2.mp4",
                    start_time=15.0,
                    duration=10.0,  # 10 seconds, total = 25s
                    track_id="video-track-1",
                    volume=1.0,
                    opacity=1.0
                )
            ],
            audio_items=[
                AudioCompositionItem(
                    id="audio1",
                    name="Background Audio",
                    url="http://example.com/audio1.mp3", 
                    start_time=0.0,
                    duration=13.0,  # Only 13 seconds
                    track_id="audio-track-1",
                    volume=1.0
                )
            ],
            total_duration=25.0,  # Should be max end time: max(15+10, 0+13) = 25
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch('subprocess.run', return_value=mock_ffmpeg_success) as mock_subprocess:
            with patch.object(video_service, '_download_video') as mock_download:
                with patch.object(video_service, '_normalize_video') as mock_normalize:
                    with patch('os.path.exists', return_value=True):
                        with patch('os.path.getsize', return_value=1024*1024):  # 1MB file
                            
                            # Mock successful video download and normalization
                            mock_download.return_value = {
                                'success': True, 
                                'output_path': '/tmp/video.mp4'
                            }
                            mock_normalize.return_value = {
                                'success': True,
                                'normalized_path': '/tmp/normalized.mp4'
                            }
                            
                            # Execute the composition
                            result = video_service.compose_video(request)
                            
                            # Verify the result
                            assert result.success == True
                            assert "completed" in result.status
                            
                            # Check that ffmpeg commands were called
                            assert mock_subprocess.called
                            
                            # Verify that audio processing extends to total_duration (25s)
                            audio_calls = [call for call in mock_subprocess.call_args_list 
                                         if any('-t' in str(arg) and '25.0' in str(arg) for arg in call[0][0])]
                            assert len(audio_calls) > 0, "Audio should be processed with total_duration=25.0"
                            
                            # Verify that video-audio merge does NOT use '-shortest' parameter
                            merge_calls = [call for call in mock_subprocess.call_args_list 
                                         if any('aac' in str(arg) for arg in call[0][0])]
                            if merge_calls:
                                merge_cmd = merge_calls[0][0][0]
                                assert '-shortest' not in merge_cmd, "Should not use -shortest to prevent video truncation"
    
    def test_total_duration_calculation_logging(self, video_service, mock_ffmpeg_success):
        """Test that detailed logging is provided for duration calculation."""
        
        request = VideoCompositionRequest(
            task_id="test_duration_logging",
            video_items=[
                VideoCompositionItem(
                    id="video1",
                    name="Test Video",
                    url="http://example.com/video.mp4",
                    start_time=0.0,
                    duration=20.0,
                    track_id="video-track-1",
                    volume=1.0,
                    opacity=1.0
                )
            ],
            audio_items=[
                AudioCompositionItem(
                    id="audio1",
                    name="Test Audio",
                    url="http://example.com/audio.mp3",
                    start_time=5.0,  # Starts at 5s
                    duration=8.0,    # Ends at 13s
                    track_id="audio-track-1", 
                    volume=1.0
                )
            ],
            total_duration=20.0,  # Video goes to 20s, audio only to 13s
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch('subprocess.run', return_value=mock_ffmpeg_success):
            with patch.object(video_service, '_download_video') as mock_download:
                with patch.object(video_service, '_normalize_video') as mock_normalize:
                    with patch('os.path.exists', return_value=True):
                        with patch('os.path.getsize', return_value=1024*1024):
                            with patch('app.services.video_composition_service.logger') as mock_logger:
                                
                                mock_download.return_value = {'success': True, 'output_path': '/tmp/video.mp4'}
                                mock_normalize.return_value = {'success': True, 'normalized_path': '/tmp/normalized.mp4'}
                                
                                # Execute composition
                                result = video_service.compose_video(request)
                                
                                # Verify logging includes duration information
                                log_calls = [str(call) for call in mock_logger.info.call_args_list]
                                
                                # Check for total duration logging
                                assert any("Total composition duration: 20.0s" in call for call in log_calls), \
                                    "Should log total composition duration"
                                
                                # Check for video item duration logging
                                assert any("Video item 1: start=0.0s, duration=20.0s, end=20.0s" in call for call in log_calls), \
                                    "Should log video item timeline details"
                                
                                # Check for audio item duration logging  
                                assert any("Audio item 1: start=5.0s, duration=8.0s, end=13.0s" in call for call in log_calls), \
                                    "Should log audio item timeline details"
                                
                                # Check for audio processing strategy logging
                                assert any("Audio processing strategy" in call for call in log_calls), \
                                    "Should log audio processing strategy"

    def test_audio_padding_calculation(self, video_service):
        """Test that audio padding is correctly calculated for timeline gaps."""
        
        # Test case: Audio starts at 5s, duration 8s, total duration 20s
        # Should create 5s silence + 8s audio + 7s silence = 20s total
        
        request = VideoCompositionRequest(
            task_id="test_audio_padding",
            video_items=[
                VideoCompositionItem(
                    id="video1",
                    name="Long Video",
                    url="http://example.com/video.mp4",
                    start_time=0.0,
                    duration=20.0,
                    track_id="video-track-1",
                    volume=1.0,
                    opacity=1.0
                )
            ],
            audio_items=[
                AudioCompositionItem(
                    id="audio1",
                    name="Mid Audio",
                    url="http://example.com/audio.mp3",
                    start_time=5.0,
                    duration=8.0,
                    track_id="audio-track-1",
                    volume=1.0
                )
            ],
            total_duration=20.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Test the audio processing logic
            with patch('subprocess.run') as mock_subprocess:
                with patch.object(video_service, '_convert_url_to_local_path', return_value='/tmp/audio.mp3'):
                    mock_subprocess.return_value.returncode = 0
                    
                    result = video_service._process_audio_tracks(request, temp_dir, 'ffmpeg')
                    
                    # Verify that audio processing was attempted
                    assert mock_subprocess.called
                    
                    # Check that the audio processing command includes silence padding
                    # This validates that start_time offset is handled correctly
                    audio_calls = mock_subprocess.call_args_list
                    silence_calls = [call for call in audio_calls 
                                   if any('anullsrc' in str(arg) for arg in call[0][0])]
                    
                    # Should have silence generation for the 5-second offset
                    assert len(silence_calls) > 0, "Should generate silence for audio start time offset" 

    def test_video_composition_with_clipping(self, video_service):
        """Test video composition with clipping parameters"""
        request = VideoCompositionRequest(
            task_id="test_clipping_123",
            video_items=[
                VideoCompositionItem(
                    id="video1",
                    name="Test Video 1",
                    url="http://example.com/video1.mp4",
                    start_time=0.0,
                    duration=10.0,
                    track_id="video-track-1",
                    clip_start=5.0,
                    clip_end=15.0  # Extract 10 seconds from original video (5s-15s)
                ),
                VideoCompositionItem(
                    id="video2", 
                    name="Test Video 2",
                    url="http://example.com/video2.mp4",
                    start_time=10.0,
                    duration=6.4,
                    track_id="video-track-1", 
                    clip_start=0.0,
                    clip_end=6.4  # Extract first 6.4 seconds from original video
                )
            ],
            audio_items=[
                AudioCompositionItem(
                    id="audio1",
                    name="Test Audio",
                    url="/api/audio/generated/test.mp3",
                    start_time=2.0,
                    duration=12.0,
                    track_id="audio-track-1",
                    volume=0.8,
                    clip_start=1.0,
                    clip_end=13.0  # Extract 12 seconds from original audio (1s-13s)
                )
            ],
            total_duration=16.4,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30
        )
        
        with patch('subprocess.run') as mock_subprocess:
            # Mock successful subprocess calls
            mock_subprocess.return_value.returncode = 0
            mock_subprocess.return_value.stderr = ""
            mock_subprocess.return_value.stdout = ""
            
            with patch.object(video_service, '_normalize_video') as mock_normalize:
                mock_normalize.return_value = {
                    "success": True,
                    "normalized_path": "/tmp/normalized_0.mp4",
                    "used_duration": 10.0,
                    "index": 0
                }
                
                with patch('os.path.exists', return_value=True):
                    with patch('os.path.getsize', return_value=1024*1024):
                        result = video_service.compose_video(request)
        
        # Verify the response
        assert result.success == True
        assert result.status == "completed"
        
        # Verify that normalize_video was called with clipping parameters
        normalize_calls = mock_normalize.call_args_list
        assert len(normalize_calls) == 2
        
        # Check first video clipping parameters
        first_call_args = normalize_calls[0][0][0]
        assert first_call_args['clip_start'] == 5.0
        assert first_call_args['clip_end'] == 15.0
        
        # Check second video clipping parameters  
        second_call_args = normalize_calls[1][0][0]
        assert second_call_args['clip_start'] == 0.0
        assert second_call_args['clip_end'] == 6.4
        
        # Verify audio processing includes clipping
        audio_calls = [call for call in mock_subprocess.call_args_list 
                       if any('-ss' in str(arg) for arg in call[0][0])]
        assert len(audio_calls) > 0, "Audio should be processed with clipping parameters"
        
        # Check that audio clipping parameters are used
        audio_command = None
        for call in mock_subprocess.call_args_list:
            if isinstance(call[0][0], list) and '-ss' in call[0][0]:
                audio_command = call[0][0]
                break
        
        if audio_command:
            # Find the -ss parameter and verify it's set to clip_start (1.0)
            ss_index = audio_command.index('-ss')
            assert audio_command[ss_index + 1] == '1.0' 