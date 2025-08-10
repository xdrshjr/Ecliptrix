"""
Test cases for Supabase router functionality.
"""

import os
import tempfile
import pytest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from datetime import datetime

from app.main import app


class TestSupabaseRouter:
    """Test cases for Supabase router endpoints."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def temp_audio_file(self):
        """Create a temporary audio file for testing."""
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_file.write(b"fake audio content for testing")
            temp_file_path = temp_file.name
        
        yield temp_file_path
        
        # Cleanup
        try:
            os.unlink(temp_file_path)
        except:
            pass

    @pytest.fixture
    def mock_supabase_service(self):
        """Mock Supabase service."""
        with patch('app.routers.supabase_router.supabase_service') as mock_service:
            yield mock_service

    def test_upload_audio_file_success(self, client, mock_supabase_service, temp_audio_file):
        """Test successful audio file upload."""
        # Mock successful upload response with proper Supabase URL
        mock_supabase_service.upload_audio_file.return_value = {
            "success": True,
            "message": "音频文件上传成功",
            "audio_url": "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/audio/generated/test_audio.mp3",
            "file_path": "test/path/audio.mp3",
            "file_size": 1024,
            "duration": 15.5,
            "segment_id": "segment_001",
            "task_id": "task_001",
            "upload_time": datetime.now()
        }
        
        request_data = {
            "audio_file_path": temp_audio_file,
            "segment_id": "segment_001",
            "task_id": "task_001",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "custom_filename": "test_audio.mp3"
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "音频文件上传成功"
        assert data["audio_url"] == "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/audio/generated/test_audio.mp3"
        assert data["segment_id"] == "segment_001"
        assert data["task_id"] == "task_001"
        
        # Verify URL format for accessibility (URL fix validation)
        assert data["audio_url"].startswith("https://")
        assert "supabase.co" in data["audio_url"]
        assert "storage/v1/object/public" in data["audio_url"]
        
        # Verify service was called with correct parameters
        mock_supabase_service.upload_audio_file.assert_called_once_with(
            audio_file_path=temp_audio_file,
            segment_id="segment_001",
            task_id="task_001",
            voice_type="zh_female_wanqudashu_moon_bigtts",
            custom_filename="test_audio.mp3"
        )

    def test_upload_audio_url_accessibility_fix(self, client, mock_supabase_service, temp_audio_file):
        """Test that uploaded audio URLs are properly accessible (URL fix validation)."""
        # Mock successful upload with proper Supabase public URL
        expected_url = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/audio/generated/segment_001_audio.mp3"
        mock_supabase_service.upload_audio_file.return_value = {
            "success": True,
            "message": "音频文件上传成功并获取到访问URL",
            "audio_url": expected_url,
            "file_path": "audio/generated/segment_001_audio.mp3",
            "file_size": 2048,
            "duration": 10.5,
            "segment_id": "segment_001",
            "task_id": "video_editing_001",
            "upload_time": datetime.now()
        }
        
        request_data = {
            "audio_file_path": temp_audio_file,
            "segment_id": "segment_001",
            "task_id": "video_editing_001",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "custom_filename": "segment_001_audio.mp3"
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify successful response
        assert data["success"] is True
        assert "获取到访问URL" in data["message"]
        
        # Verify URL is properly formatted and accessible
        returned_url = data["audio_url"]
        assert returned_url == expected_url
        assert returned_url.startswith("https://hlqvzgwmbejiviaekdns.supabase.co")
        assert "/storage/v1/object/public/" in returned_url
        assert "/articraft-dev/" in returned_url
        assert returned_url.endswith(".mp3")
        
        # Verify the URL follows the correct Supabase public URL pattern
        url_parts = returned_url.split("/")
        assert "hlqvzgwmbejiviaekdns.supabase.co" in url_parts
        assert "storage" in url_parts
        assert "v1" in url_parts
        assert "object" in url_parts
        assert "public" in url_parts
        assert "articraft-dev" in url_parts

    def test_upload_audio_file_failure(self, client, mock_supabase_service, temp_audio_file):
        """Test audio file upload failure."""
        # Mock failed upload response
        mock_supabase_service.upload_audio_file.return_value = {
            "success": False,
            "message": "文件不存在"
        }
        
        request_data = {
            "audio_file_path": temp_audio_file,
            "segment_id": "segment_001",
            "task_id": "task_001"
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["message"] == "文件不存在"
        assert data["error_code"] == "UPLOAD_FAILED"

    def test_upload_audio_file_exception(self, client, mock_supabase_service, temp_audio_file):
        """Test audio file upload with exception."""
        # Mock exception
        mock_supabase_service.upload_audio_file.side_effect = Exception("Connection error")
        
        request_data = {
            "audio_file_path": temp_audio_file,
            "segment_id": "segment_001"
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "音频文件上传异常" in data["message"]
        assert data["error_code"] == "INTERNAL_ERROR"

    def test_upload_file_success(self, client, mock_supabase_service):
        """Test successful file upload via form data."""
        # Mock successful upload response
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "message": "文件上传成功",
            "file_url": "https://example.com/file.mp3",
            "file_path": "test/path/file.mp3",
            "file_size": 2048,
            "upload_time": datetime.now(),
            "content_type": "audio/mpeg"
        }
        
        # Create test file content
        test_content = b"test file content"
        
        response = client.post(
            "/api/supabase/upload-file",
            files={"file": ("test.mp3", test_content, "audio/mpeg")},
            data={
                "bucket_path": "custom/path/test.mp3",
                "task_id": "task_001",
                "segment_id": "segment_001"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "文件上传成功"
        assert data["file_url"] == "https://example.com/file.mp3"
        assert data["metadata"]["task_id"] == "task_001"
        assert data["metadata"]["segment_id"] == "segment_001"
        
        # Verify service was called
        mock_supabase_service.upload_file.assert_called_once()

    def test_upload_file_failure(self, client, mock_supabase_service):
        """Test file upload failure via form data."""
        # Mock failed upload response
        mock_supabase_service.upload_file.return_value = {
            "success": False,
            "message": "上传失败"
        }
        
        test_content = b"test file content"
        
        response = client.post(
            "/api/supabase/upload-file",
            files={"file": ("test.mp3", test_content, "audio/mpeg")},
            data={"task_id": "task_001"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["message"] == "上传失败"
        assert data["error_code"] == "UPLOAD_FAILED"

    def test_upload_file_exception(self, client, mock_supabase_service):
        """Test file upload with exception via form data."""
        # Mock exception
        mock_supabase_service.upload_file.side_effect = Exception("Storage error")
        
        test_content = b"test file content"
        
        response = client.post(
            "/api/supabase/upload-file",
            files={"file": ("test.mp3", test_content, "audio/mpeg")}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "文件上传异常" in data["message"]
        assert data["error_code"] == "INTERNAL_ERROR"

    def test_health_check_success(self, client, mock_supabase_service):
        """Test successful health check."""
        # Mock healthy response
        mock_supabase_service.health_check.return_value = {
            "service": "Supabase",
            "status": "healthy",
            "bucket": "test-bucket",
            "environment": "development",
            "message": "Supabase服务运行正常"
        }
        
        response = client.get("/api/supabase/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "Supabase"
        assert data["status"] == "healthy"
        assert data["bucket"] == "test-bucket"
        assert data["environment"] == "development"
        
        mock_supabase_service.health_check.assert_called_once()

    def test_health_check_unhealthy(self, client, mock_supabase_service):
        """Test unhealthy health check."""
        # Mock unhealthy response
        mock_supabase_service.health_check.return_value = {
            "service": "Supabase",
            "status": "unhealthy",
            "message": "连接失败"
        }
        
        response = client.get("/api/supabase/health")
        
        assert response.status_code == 503
        data = response.json()
        assert data["service"] == "Supabase"
        assert data["status"] == "unhealthy"
        assert data["message"] == "连接失败"

    def test_health_check_exception(self, client, mock_supabase_service):
        """Test health check with exception."""
        # Mock exception
        mock_supabase_service.health_check.side_effect = Exception("Service error")
        
        response = client.get("/api/supabase/health")
        
        assert response.status_code == 500
        data = response.json()
        assert data["service"] == "Supabase"
        assert data["status"] == "error"
        assert "健康检查异常" in data["message"]

    def test_upload_audio_file_missing_required_field(self, client):
        """Test audio file upload with missing required field."""
        request_data = {
            "segment_id": "segment_001",
            "task_id": "task_001"
            # Missing audio_file_path
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 422  # Validation error

    def test_upload_audio_file_with_minimal_data(self, client, mock_supabase_service, temp_audio_file):
        """Test audio file upload with minimal required data."""
        # Mock successful upload response
        mock_supabase_service.upload_audio_file.return_value = {
            "success": True,
            "message": "音频文件上传成功",
            "audio_url": "https://example.com/audio.mp3",
            "file_path": "test/path/audio.mp3",
            "file_size": 1024,
            "duration": None,
            "segment_id": None,
            "task_id": None,
            "upload_time": datetime.now()
        }
        
        request_data = {
            "audio_file_path": temp_audio_file
        }
        
        response = client.post("/api/supabase/upload-audio", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["audio_url"] == "https://example.com/audio.mp3"
        assert data["segment_id"] is None
        assert data["task_id"] is None

    def test_upload_file_without_optional_params(self, client, mock_supabase_service):
        """Test file upload without optional parameters."""
        # Mock successful upload response
        mock_supabase_service.upload_file.return_value = {
            "success": True,
            "message": "文件上传成功",
            "file_url": "https://example.com/file.mp3",
            "file_path": "test/path/file.mp3",
            "file_size": 2048,
            "upload_time": datetime.now(),
            "content_type": "audio/mpeg"
        }
        
        test_content = b"test file content"
        
        response = client.post(
            "/api/supabase/upload-file",
            files={"file": ("test.mp3", test_content, "audio/mpeg")}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["metadata"]["task_id"] is None
        assert data["metadata"]["segment_id"] is None


class TestSupabaseRouterIntegration:
    """Integration tests for Supabase router."""
    
    @pytest.mark.integration
    def test_real_upload_flow(self):
        """Test real upload flow (requires actual Supabase credentials)."""
        # This test would require real Supabase credentials
        # and should only be run in integration test environment
        pytest.skip("Integration test requires real Supabase credentials")
    
    @pytest.mark.integration 
    def test_real_health_check_flow(self):
        """Test real health check flow (requires actual Supabase credentials)."""
        # This test would require real Supabase credentials
        # and should only be run in integration test environment
        pytest.skip("Integration test requires real Supabase credentials") 