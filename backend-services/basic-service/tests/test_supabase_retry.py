"""
Test cases for Supabase service retry mechanism.
"""

import os
import tempfile
import pytest
from unittest.mock import Mock, patch, call
from datetime import datetime

from app.services.supabase_service import SupabaseService


class TestSupabaseRetryMechanism:
    """Test cases for Supabase retry mechanism."""

    @pytest.fixture
    def mock_supabase_client(self):
        """Mock Supabase client."""
        with patch('app.services.supabase_service.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client
            yield mock_client

    @pytest.fixture
    def supabase_service_instance(self, mock_supabase_client):
        """Create a SupabaseService instance with mocked client."""
        with patch('app.services.supabase_service.SUPABASE_AVAILABLE', True):
            service = SupabaseService()
            service.client = mock_supabase_client
            service.bucket_name = "test-bucket"
            return service

    @pytest.fixture
    def temp_audio_file(self):
        """Create a temporary audio file for testing."""
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_file.write(b"fake audio content for retry testing")
            temp_file_path = temp_file.name
        
        yield temp_file_path
        
        # Cleanup
        try:
            os.unlink(temp_file_path)
        except:
            pass

    def test_upload_success_first_attempt(self, supabase_service_instance, temp_audio_file):
        """Test successful upload on first attempt."""
        # Mock successful response
        mock_response = Mock()
        mock_response.error = None
        supabase_service_instance.client.storage.from_.return_value.upload.return_value = mock_response
        supabase_service_instance.client.storage.from_.return_value.create_signed_url.return_value = {
            'signedURL': 'https://test.supabase.co/storage/v1/object/sign/test-bucket/test.mp3?token=abc123'
        }
        
        result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is True
        assert "文件上传成功" in result["message"]
        # Should only call upload once
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 1

    def test_upload_retry_on_connection_error(self, supabase_service_instance, temp_audio_file):
        """Test retry mechanism on connection error."""
        # Mock connection error on first two attempts, success on third
        side_effects = [
            ConnectionError("远程主机强迫关闭了一个现有的连接"),
            ConnectionError("远程主机强迫关闭了一个现有的连接"),
            Mock(error=None)  # Success on third attempt
        ]
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = side_effects
        supabase_service_instance.client.storage.from_.return_value.create_signed_url.return_value = {
            'signedURL': 'https://test.supabase.co/storage/v1/object/sign/test-bucket/test.mp3?token=abc123'
        }
        
        with patch('time.sleep') as mock_sleep:  # Mock sleep to speed up test
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is True
        # Should call upload 3 times (2 failures + 1 success)
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 3
        # Should call sleep twice (after first and second failures)
        assert mock_sleep.call_count == 2
        # Check exponential backoff delays
        mock_sleep.assert_has_calls([call(1.0), call(2.0)])

    def test_upload_max_retries_exceeded(self, supabase_service_instance, temp_audio_file):
        """Test max retries exceeded scenario."""
        # Mock connection error on all attempts
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = [
            ConnectionError("远程主机强迫关闭了一个现有的连接"),
            ConnectionError("远程主机强迫关闭了一个现有的连接"),
            ConnectionError("远程主机强迫关闭了一个现有的连接")
        ]
        
        with patch('time.sleep') as mock_sleep:  # Mock sleep to speed up test
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is False
        assert "已重试3次" in result["message"]
        # Should call upload 3 times (all failures)
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 3
        # Should call sleep twice (after first and second failures, not after last)
        assert mock_sleep.call_count == 2

    def test_upload_no_retry_on_client_error(self, supabase_service_instance, temp_audio_file):
        """Test no retry on client errors (4xx)."""
        # Mock client error response
        mock_response = Mock()
        mock_response.error = "400 Bad Request"
        supabase_service_instance.client.storage.from_.return_value.upload.return_value = mock_response
        
        with patch('time.sleep') as mock_sleep:  # Mock sleep to speed up test
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is False
        assert "上传失败: 400 Bad Request" in result["message"]
        # Should only call upload once (no retries for client errors)
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 1
        # Should not call sleep (no retries)
        assert mock_sleep.call_count == 0

    def test_upload_no_retry_on_non_retryable_error(self, supabase_service_instance, temp_audio_file):
        """Test no retry on non-retryable errors."""
        # Mock non-retryable error
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = ValueError("Invalid file format")
        
        with patch('time.sleep') as mock_sleep:  # Mock sleep to speed up test
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is False
        assert "非可重试错误" in result["message"]
        # Should only call upload once (no retries for non-retryable errors)
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 1
        # Should not call sleep (no retries)
        assert mock_sleep.call_count == 0

    def test_upload_retry_on_supabase_error_response(self, supabase_service_instance, temp_audio_file):
        """Test retry on Supabase error responses (non-4xx)."""
        # Mock server error on first attempt, success on second
        error_response = Mock()
        error_response.error = "500 Internal Server Error"
        success_response = Mock()
        success_response.error = None
        
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = [
            error_response,
            success_response
        ]
        supabase_service_instance.client.storage.from_.return_value.create_signed_url.return_value = {
            'signedURL': 'https://test.supabase.co/storage/v1/object/sign/test-bucket/test.mp3?token=abc123'
        }
        
        with patch('time.sleep') as mock_sleep:  # Mock sleep to speed up test
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        assert result["success"] is True
        # Should call upload twice (1 failure + 1 success)
        assert supabase_service_instance.client.storage.from_.return_value.upload.call_count == 2
        # Should call sleep once (after first failure)
        assert mock_sleep.call_count == 1

    def test_retry_configuration_constants(self, supabase_service_instance):
        """Test that retry configuration constants are properly set."""
        assert supabase_service_instance.MAX_UPLOAD_RETRIES == 3
        assert supabase_service_instance.RETRY_BASE_DELAY == 1.0
        assert supabase_service_instance.RETRY_BACKOFF_FACTOR == 2.0

    def test_exponential_backoff_delays(self, supabase_service_instance, temp_audio_file):
        """Test that exponential backoff delays are calculated correctly."""
        # Mock connection error on all attempts
        supabase_service_instance.client.storage.from_.return_value.upload.side_effect = [
            ConnectionError("Connection failed"),
            ConnectionError("Connection failed"),
            ConnectionError("Connection failed")
        ]
        
        with patch('time.sleep') as mock_sleep:
            result = supabase_service_instance.upload_file(temp_audio_file)
        
        # Check that delays follow exponential backoff: 1.0, 2.0
        expected_delays = [1.0, 2.0]  # 1.0 * 2^0, 1.0 * 2^1
        actual_delays = [call_args[0][0] for call_args in mock_sleep.call_args_list]
        
        assert actual_delays == expected_delays
        assert result["success"] is False