"""
Test cases for Supabase service functionality.
"""

import os
import tempfile
import pytest
from unittest.mock import Mock, patch, mock_open
from datetime import datetime

from app.services.supabase_service import SupabaseService, supabase_service
from app.config import settings


class TestSupabaseService:
    """Test cases for SupabaseService class."""

    @pytest.fixture
    def mock_supabase_client(self):
        """Mock Supabase client."""
        with patch('app.services.supabase_service.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client
            
            # Mock storage methods
            mock_client.storage.from_.return_value.upload.return_value = Mock(error=None)
            mock_client.storage.from_.return_value.get_public_url.return_value = "https://example.com/file.mp3"
            mock_client.storage.from_.return_value.remove.return_value = Mock(error=None)
            mock_client.storage.from_.return_value.list.return_value = []
            
            yield mock_client

    @pytest.fixture
    def supabase_service_instance(self, mock_supabase_client):
        """Create a SupabaseService instance with mocked client."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', True):
            service = SupabaseService()
            service.client = mock_supabase_client
            return service

    @pytest.fixture
    def temp_audio_file(self):
        """Create a temporary audio file for testing."""
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_file.write(b"fake audio content")
            temp_file_path = temp_file.name
        
        yield temp_file_path
        
        # Cleanup
        try:
            os.unlink(temp_file_path)
        except:
            pass

    def test_service_initialization_success(self, mock_supabase_client):
        """Test successful service initialization."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', True):
            service = SupabaseService()
            assert service.client is not None
            assert service.bucket_name == settings.supabase.bucket
            assert service.environment == settings.supabase.environment

    def test_service_initialization_no_supabase(self):
        """Test service initialization when Supabase is not available."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', False):
            service = SupabaseService()
            assert service.client is None

    def test_validate_client_success(self, supabase_service_instance):
        """Test client validation success."""
        assert supabase_service_instance._validate_client() is True

    def test_validate_client_no_supabase(self):
        """Test client validation when Supabase is not available."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', False):
            service = SupabaseService()
            assert service._validate_client() is False

    def test_validate_client_no_client(self):
        """Test client validation when client is None."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', True):
            service = SupabaseService()
            service.client = None
            assert service._validate_client() is False

    def test_generate_bucket_path_basic(self, supabase_service_instance):
        """Test basic bucket path generation."""
        with patch('app.services.supabase_service.datetime') as mock_datetime:
            mock_datetime.now.return_value.strftime.return_value = "2024/12/01"
            
            path = supabase_service_instance._generate_bucket_path("test.mp3")
            expected = "development/audio/2024/12/01/test.mp3"
            assert path == expected

    def test_generate_bucket_path_with_ids(self, supabase_service_instance):
        """Test bucket path generation with task and segment IDs."""
        with patch('app.services.supabase_service.datetime') as mock_datetime:
            mock_datetime.now.return_value.strftime.return_value = "2024/12/01"
            
            path = supabase_service_instance._generate_bucket_path(
                "test.mp3",
                folder="audio/generated",
                task_id="task_001",
                segment_id="segment_001"
            )
            expected = "development/audio/generated/2024/12/01/task_001/segment_001_test.mp3"
            assert path == expected

    def test_get_file_content_type_mp3(self, supabase_service_instance):
        """Test content type detection for MP3 files."""
        content_type = supabase_service_instance._get_file_content_type("test.mp3")
        assert content_type == "audio/mpeg"

    def test_get_file_content_type_unknown(self, supabase_service_instance):
        """Test content type detection for unknown files."""
        content_type = supabase_service_instance._get_file_content_type("test.unknown")
        assert content_type == "application/octet-stream"

    def test_upload_file_success(self, supabase_service_instance, temp_audio_file):
        """Test successful file upload."""
        result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is True
        assert result["message"] == "文件上传成功"
        assert "file_url" in result
        assert "file_path" in result
        assert "file_size" in result
        assert "upload_time" in result

    def test_upload_file_not_exists(self, supabase_service_instance):
        """Test file upload when file doesn't exist."""
        result = supabase_service_instance.upload_file("/nonexistent/file.mp3")
        
        assert result["success"] is False
        assert "文件不存在" in result["message"]

    def test_upload_file_no_client(self):
        """Test file upload when client is not available."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', False):
            service = SupabaseService()
            result = service.upload_file("/some/file.mp3")
            
            assert result["success"] is False
            assert "Supabase客户端不可用" in result["message"]

    def test_upload_audio_file_success(self, supabase_service_instance, temp_audio_file):
        """Test successful audio file upload."""
        with patch.object(supabase_service_instance, '_get_audio_duration', return_value=15.5):
            result = supabase_service_instance.upload_audio_file(
                audio_file_path=temp_audio_file,
                segment_id="segment_001",
                task_id="task_001",
                voice_type="zh_female_wanqudashu_moon_bigtts"
            )
            
            assert result["success"] is True
            assert result["message"] == "音频文件上传成功"
            assert result["segment_id"] == "segment_001"
            assert result["task_id"] == "task_001"
            assert result["voice_type"] == "zh_female_wanqudashu_moon_bigtts"
            assert result["duration"] == 15.5

    def test_upload_audio_file_not_exists(self, supabase_service_instance):
        """Test audio file upload when file doesn't exist."""
        result = supabase_service_instance.upload_audio_file("/nonexistent/audio.mp3")
        
        assert result["success"] is False
        assert "音频文件不存在" in result["message"]

    def test_get_audio_duration_with_mutagen(self, supabase_service_instance, temp_audio_file):
        """Test audio duration extraction with mutagen."""
        mock_audio_file = Mock()
        mock_audio_file.info.length = 15.5
        
        with patch('app.services.supabase_service.File', return_value=mock_audio_file):
            duration = supabase_service_instance._get_audio_duration(temp_audio_file)
            assert duration == 15.5

    def test_get_audio_duration_no_mutagen(self, supabase_service_instance, temp_audio_file):
        """Test audio duration extraction when mutagen is not available."""
        with patch('app.services.supabase_service.File', side_effect=ImportError):
            duration = supabase_service_instance._get_audio_duration(temp_audio_file)
            assert duration is None

    def test_delete_file_success(self, supabase_service_instance):
        """Test successful file deletion."""
        result = supabase_service_instance.delete_file("test/path/file.mp3")
        
        assert result["success"] is True
        assert result["message"] == "文件删除成功"

    def test_delete_file_no_client(self):
        """Test file deletion when client is not available."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', False):
            service = SupabaseService()
            result = service.delete_file("test/path/file.mp3")
            
            assert result["success"] is False
            assert "Supabase客户端不可用" in result["message"]

    def test_health_check_success(self, supabase_service_instance):
        """Test successful health check."""
        result = supabase_service_instance.health_check()
        
        assert result["service"] == "Supabase"
        assert result["status"] == "healthy"
        assert result["bucket"] == settings.supabase.bucket
        assert result["environment"] == settings.supabase.environment

    def test_health_check_no_client(self):
        """Test health check when client is not available."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', False):
            service = SupabaseService()
            result = service.health_check()
            
            assert result["service"] == "Supabase"
            assert result["status"] == "unhealthy"
            assert "Supabase客户端不可用" in result["message"]

    def test_upload_file_supabase_error(self, supabase_service_instance, temp_audio_file):
        """Test file upload when Supabase returns an error."""
        # Mock Supabase error response
        error_response = Mock()
        error_response.error = "Upload failed"
        supabase_service_instance.client.storage.from_.return_value.upload.return_value = error_response
        
        result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is False
        assert "上传失败" in result["message"]

    def test_upload_file_exception(self, supabase_service_instance, temp_audio_file):
        """Test file upload when an exception occurs."""
        # Mock exception during upload
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = Exception("Connection error")
        
        result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is False
        assert "文件上传异常" in result["message"]

    def test_global_service_instance(self):
        """Test that the global service instance is properly initialized."""
        assert supabase_service is not None
        assert isinstance(supabase_service, SupabaseService)


class TestSupabaseServiceIntegration:
    """Integration tests for Supabase service."""
    
    @pytest.mark.integration
    def test_real_upload_flow(self):
        """Test real upload flow (requires actual Supabase credentials)."""
        # This test would require real Supabase credentials
        # and should only be run in integration test environment
        pytest.skip("Integration test requires real Supabase credentials")
    
    @pytest.mark.integration
    def test_real_health_check(self):
        """Test real health check (requires actual Supabase credentials)."""
        # This test would require real Supabase credentials
        # and should only be run in integration test environment
        pytest.skip("Integration test requires real Supabase credentials") 