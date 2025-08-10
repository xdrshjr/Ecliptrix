"""
Test cases for Supabase URL access fix.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import os
from app.services.supabase_service import SupabaseService


class TestSupabaseURLFix:
    """Test cases for Supabase URL generation fix."""

    @pytest.fixture
    def mock_supabase_client(self):
        """Create a mock Supabase client."""
        mock_client = Mock()
        mock_storage = Mock()
        mock_bucket = Mock()
        
        mock_client.storage.from_.return_value = mock_bucket
        mock_bucket.upload.return_value = Mock(error=None)
        mock_bucket.get_public_url.return_value = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/audio/generated/test_audio.mp3"
        
        return mock_client

    @pytest.fixture
    def supabase_service(self, mock_supabase_client):
        """Create SupabaseService instance with mocked client."""
        with patch('app.services.supabase_service.create_client', return_value=mock_supabase_client):
            with patch('app.services.supabase_service.settings') as mock_settings:
                mock_settings.supabase.url = "https://test.supabase.co"
                mock_settings.supabase.anon_key = "test_key"
                mock_settings.supabase.bucket = "test_bucket"
                mock_settings.supabase.environment = "test"
                
                service = SupabaseService()
                service.client = mock_supabase_client
                service.bucket_name = "test_bucket"
                service.environment = "test"
                
                return service

    def test_get_public_url_success(self, supabase_service, tmp_path):
        """Test successful public URL generation."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock the upload and URL generation
        expected_url = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/test_bucket/audio/generated/test_audio.mp3"
        supabase_service.client.storage.from_().get_public_url.return_value = expected_url
        
        # Test upload_file method
        result = supabase_service.upload_file(
            local_file_path=str(test_file),
            bucket_path="audio/generated/test_audio.mp3"
        )
        
        # Assertions
        assert result["success"] is True
        assert result["file_url"] == expected_url
        assert "url_accessible" in str(result)  # Check if logging indicates URL accessibility
        
        # Verify get_public_url was called correctly
        supabase_service.client.storage.from_().get_public_url.assert_called_with("audio/generated/test_audio.mp3")

    def test_get_public_url_failure(self, supabase_service, tmp_path):
        """Test handling of public URL generation failure."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock URL generation failure
        supabase_service.client.storage.from_().get_public_url.side_effect = Exception("URL generation failed")
        
        # Test upload_file method
        result = supabase_service.upload_file(
            local_file_path=str(test_file),
            bucket_path="audio/generated/test_audio.mp3"
        )
        
        # Assertions
        assert result["success"] is False
        assert "获取公共URL失败" in result["message"]

    def test_upload_audio_file_with_url_generation(self, supabase_service, tmp_path):
        """Test audio file upload with proper URL generation."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock successful upload and URL generation
        expected_url = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/test_bucket/audio/generated/test_audio.mp3"
        
        with patch.object(supabase_service, 'upload_file') as mock_upload:
            mock_upload.return_value = {
                "success": True,
                "file_url": expected_url,
                "file_path": "audio/generated/test_audio.mp3",
                "file_size": 15,
                "upload_time": "2024-01-01T00:00:00"
            }
            
            with patch.object(supabase_service, '_get_audio_duration') as mock_duration:
                mock_duration.return_value = 10.5
                
                # Test upload_audio_file method
                result = supabase_service.upload_audio_file(
                    audio_file_path=str(test_file),
                    segment_id="segment_001",
                    task_id="task_001",
                    voice_type="zh_female_test"
                )
                
                # Assertions
                assert result["success"] is True
                assert result["audio_url"] == expected_url
                assert result["segment_id"] == "segment_001"
                assert result["task_id"] == "task_001"
                assert result["duration"] == 10.5

    @patch('app.services.supabase_service.logger')
    def test_logging_for_successful_url_generation(self, mock_logger, supabase_service, tmp_path):
        """Test that proper logging is done for successful URL generation."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock successful upload and URL generation
        expected_url = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/test_bucket/audio/generated/test_audio.mp3"
        supabase_service.client.storage.from_().get_public_url.return_value = expected_url
        
        # Test upload_file method
        result = supabase_service.upload_file(
            local_file_path=str(test_file),
            bucket_path="audio/generated/test_audio.mp3"
        )
        
        # Verify success logging
        assert result["success"] is True
        mock_logger.info.assert_called()
        
        # Check if the log message indicates successful URL generation
        log_calls = mock_logger.info.call_args_list
        url_success_logged = any(
            "获取公共URL成功" in str(call) and "url_accessible" in str(call)
            for call in log_calls
        )
        assert url_success_logged, "Should log successful URL generation with accessibility info"

    @patch('app.services.supabase_service.logger')
    def test_logging_for_failed_url_generation(self, mock_logger, supabase_service, tmp_path):
        """Test that proper error logging is done for failed URL generation."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock URL generation failure
        supabase_service.client.storage.from_().get_public_url.side_effect = Exception("URL generation failed")
        
        # Test upload_file method
        result = supabase_service.upload_file(
            local_file_path=str(test_file),
            bucket_path="audio/generated/test_audio.mp3"
        )
        
        # Verify failure logging
        assert result["success"] is False
        mock_logger.error.assert_called()
        
        # Check if the error message is properly logged
        error_calls = mock_logger.error.call_args_list
        url_error_logged = any(
            "获取公共URL失败" in str(call)
            for call in error_calls
        )
        assert url_error_logged, "Should log URL generation failure"

    def test_url_format_validation(self, supabase_service, tmp_path):
        """Test that the returned URL has the correct format."""
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock successful upload with properly formatted URL
        expected_url = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/test_bucket/audio/generated/test_audio.mp3"
        supabase_service.client.storage.from_().get_public_url.return_value = expected_url
        
        # Test upload_file method
        result = supabase_service.upload_file(
            local_file_path=str(test_file),
            bucket_path="audio/generated/test_audio.mp3"
        )
        
        # Verify URL format
        assert result["success"] is True
        returned_url = result["file_url"]
        
        # Check URL format
        assert returned_url.startswith("https://")
        assert "supabase.co" in returned_url
        assert "storage/v1/object/public" in returned_url
        assert returned_url.endswith(".mp3") 