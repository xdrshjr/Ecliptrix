"""
Tests for Supabase video upload API endpoints.
"""

import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import UploadFile
import io

from app.main import app
from app.models.supabase_models import VideoUploadResponse, VideoUploadErrorResponse


class TestSupabaseVideoUpload:
    """Test cases for Supabase video upload functionality."""
    
    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)
    
    @pytest.fixture
    def mock_video_file(self):
        """Create a mock video file for testing."""
        # Create a simple mock video file content
        video_content = b"fake_video_content_for_testing" * 1000  # ~30KB
        return io.BytesIO(video_content)
    
    @pytest.fixture
    def mock_supabase_service(self):
        """Mock Supabase service for testing."""
        with patch('app.routers.supabase_router.supabase_service') as mock:
            yield mock
    
    def test_upload_video_success(self, client, mock_video_file, mock_supabase_service):
        """Test successful video upload."""
        # Mock Supabase service response
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/storage/v1/object/sign/bucket/video.mp4?token=abc123",
            "file_size": 30000,
            "file_path": "video/uploaded/2025/01/11/test-video.mp4"
        }
        
        # Mock ffprobe for video metadata
        with patch('subprocess.run') as mock_subprocess:
            mock_subprocess.return_value = MagicMock(
                returncode=0,
                stdout='{"streams": [{"codec_type": "video", "width": 1920, "height": 1080}], "format": {"duration": "30.5"}}'
            )
            
            # Prepare test file
            files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
            data = {
                "task_id": "test-task-123",
                "custom_filename": "test-video.mp4",
                "generate_thumbnail": "true"
            }
            
            # Make request
            response = client.post("/api/supabase/upload-video", files=files, data=data)
            
            # Assertions
            assert response.status_code == 200
            result = response.json()
            
            assert result["success"] is True
            assert result["message"] == "视频文件上传成功"
            assert result["video_url"] == "https://example.supabase.co/storage/v1/object/sign/bucket/video.mp4?token=abc123"
            assert result["file_size"] == 30000
            assert result["duration"] == 30.5
            assert result["width"] == 1920
            assert result["height"] == 1080
            assert result["task_id"] == "test-task-123"
            assert "metadata" in result
    
    def test_upload_video_invalid_file_type(self, client):
        """Test upload with invalid file type."""
        # Create a text file instead of video
        text_content = b"this is not a video file"
        text_file = io.BytesIO(text_content)
        
        files = {"file": ("test.txt", text_file, "text/plain")}
        data = {"task_id": "test-task-123"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is False
        assert result["error_code"] == "INVALID_FILE_TYPE"
        assert "不支持的文件类型" in result["message"]
    
    def test_upload_video_supabase_failure(self, client, mock_video_file, mock_supabase_service):
        """Test video upload when Supabase upload fails."""
        # Mock Supabase service failure
        mock_supabase_service.upload_file.return_value = {
            "success": False,
            "message": "Supabase upload failed"
        }
        
        files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
        data = {"task_id": "test-task-123"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is False
        assert result["error_code"] == "UPLOAD_FAILED"
        assert result["message"] == "Supabase upload failed"
    
    def test_upload_video_without_task_id(self, client, mock_video_file, mock_supabase_service):
        """Test video upload without task_id."""
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/storage/v1/object/sign/bucket/video.mp4?token=abc123",
            "file_size": 30000
        }
        
        files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
        data = {"generate_thumbnail": "false"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is True
        assert result["task_id"] is None
        assert "video/uploaded/" in result["file_path"]
        # Should not contain task- prefix when no task_id
        assert "task-" not in result["file_path"]
    
    def test_upload_video_without_ffmpeg(self, client, mock_video_file, mock_supabase_service):
        """Test video upload when ffmpeg is not available."""
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/storage/v1/object/sign/bucket/video.mp4?token=abc123",
            "file_size": 30000
        }
        
        # Mock ffprobe failure (ffmpeg not available)
        with patch('subprocess.run') as mock_subprocess:
            mock_subprocess.side_effect = FileNotFoundError("ffprobe not found")
            
            files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
            data = {"task_id": "test-task-123"}
            
            response = client.post("/api/supabase/upload-video", files=files, data=data)
            
            assert response.status_code == 200
            result = response.json()
            
            assert result["success"] is True
            # Metadata should be null when ffmpeg is not available
            assert result["duration"] is None
            assert result["width"] is None
            assert result["height"] is None
            assert result["thumbnail_url"] is None
    
    def test_upload_video_thumbnail_generation_success(self, client, mock_video_file, mock_supabase_service):
        """Test successful thumbnail generation."""
        # Mock video upload success
        mock_supabase_service.upload_file.side_effect = [
            {
                "success": True,
                "file_url": "https://example.supabase.co/video.mp4",
                "file_size": 30000
            },
            {
                "success": True,
                "file_url": "https://example.supabase.co/thumb_video.jpg",
                "file_size": 5000
            }
        ]
        
        # Mock ffprobe success
        with patch('subprocess.run') as mock_subprocess:
            # First call: ffprobe for metadata
            # Second call: ffmpeg for thumbnail generation
            mock_subprocess.side_effect = [
                MagicMock(
                    returncode=0,
                    stdout='{"streams": [{"codec_type": "video", "width": 1920, "height": 1080}], "format": {"duration": "30.5"}}'
                ),
                MagicMock(returncode=0)  # ffmpeg thumbnail generation success
            ]
            
            # Mock temporary thumbnail file creation
            with patch('tempfile.NamedTemporaryFile') as mock_temp:
                mock_temp.return_value.__enter__.return_value.name = "/tmp/thumbnail.jpg"
                
                with patch('os.path.exists') as mock_exists:
                    mock_exists.return_value = True
                    
                    files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
                    data = {
                        "task_id": "test-task-123",
                        "generate_thumbnail": "true"
                    }
                    
                    response = client.post("/api/supabase/upload-video", files=files, data=data)
                    
                    assert response.status_code == 200
                    result = response.json()
                    
                    assert result["success"] is True
                    assert result["thumbnail_url"] == "https://example.supabase.co/thumb_video.jpg"
                    assert result["duration"] == 30.5
    
    def test_upload_video_thumbnail_generation_failure(self, client, mock_video_file, mock_supabase_service):
        """Test thumbnail generation failure."""
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/video.mp4",
            "file_size": 30000
        }
        
        # Mock ffprobe success but ffmpeg failure
        with patch('subprocess.run') as mock_subprocess:
            mock_subprocess.side_effect = [
                MagicMock(
                    returncode=0,
                    stdout='{"streams": [{"codec_type": "video", "width": 1920, "height": 1080}], "format": {"duration": "30.5"}}'
                ),
                MagicMock(returncode=1, stderr=b"ffmpeg error")  # ffmpeg failure
            ]
            
            files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
            data = {
                "task_id": "test-task-123",
                "generate_thumbnail": "true"
            }
            
            response = client.post("/api/supabase/upload-video", files=files, data=data)
            
            assert response.status_code == 200
            result = response.json()
            
            assert result["success"] is True  # Upload should still succeed
            assert result["thumbnail_url"] is None  # But no thumbnail
            assert result["duration"] == 30.5  # Metadata should still be available
    
    def test_upload_video_custom_filename(self, client, mock_video_file, mock_supabase_service):
        """Test video upload with custom filename."""
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/my-custom-video.mp4",
            "file_size": 30000
        }
        
        files = {"file": ("original.mp4", mock_video_file, "video/mp4")}
        data = {
            "custom_filename": "my-custom-video",  # Without extension
            "generate_thumbnail": "false"
        }
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is True
        # Should contain custom filename with extension added
        assert "my-custom-video.mp4" in result["file_path"]
    
    def test_upload_video_large_file(self, client, mock_supabase_service):
        """Test video upload with large file."""
        # Create a larger mock file
        large_video_content = b"fake_video_content" * 10000  # ~180KB
        large_video_file = io.BytesIO(large_video_content)
        
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/large-video.mp4",
            "file_size": len(large_video_content)
        }
        
        files = {"file": ("large-video.mp4", large_video_file, "video/mp4")}
        data = {"generate_thumbnail": "false"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is True
        assert result["file_size"] == len(large_video_content)
    
    @patch('app.routers.supabase_router.logger')
    def test_upload_video_logging(self, mock_logger, client, mock_video_file, mock_supabase_service):
        """Test that proper logging occurs during video upload."""
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "file_url": "https://example.supabase.co/video.mp4",
            "file_size": 30000
        }
        
        files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
        data = {"task_id": "test-task-123"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        
        # Verify logging calls
        mock_logger.info.assert_called()
        
        # Check that important log messages were called
        log_calls = [call.args[0] for call in mock_logger.info.call_args_list]
        assert any("收到视频文件上传请求" in call for call in log_calls)
        assert any("视频文件上传成功" in call for call in log_calls)
    
    def test_upload_video_missing_file(self, client):
        """Test video upload without file parameter."""
        data = {"task_id": "test-task-123"}
        
        response = client.post("/api/supabase/upload-video", data=data)
        
        # Should return 422 for missing required field
        assert response.status_code == 422
    
    def test_upload_video_internal_error(self, client, mock_video_file, mock_supabase_service):
        """Test handling of internal errors during video upload."""
        # Mock Supabase service to raise an exception
        mock_supabase_service.upload_file.side_effect = Exception("Internal error")
        
        files = {"file": ("test-video.mp4", mock_video_file, "video/mp4")}
        data = {"task_id": "test-task-123"}
        
        response = client.post("/api/supabase/upload-video", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        
        assert result["success"] is False
        assert result["error_code"] == "INTERNAL_ERROR"
        assert "Internal error" in result["message"] 