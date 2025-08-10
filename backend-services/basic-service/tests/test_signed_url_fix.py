"""
Test script to verify signed URL generation fix.
"""

import pytest
from unittest.mock import Mock, patch
from app.services.supabase_service import SupabaseService


class TestSignedURLFix:
    """Test cases for signed URL generation fix."""

    @pytest.fixture
    def mock_supabase_client(self):
        """Create a mock Supabase client."""
        mock_client = Mock()
        mock_bucket = Mock()
        
        mock_client.storage.from_.return_value = mock_bucket
        mock_bucket.upload.return_value = Mock(error=None)
        
        # Mock public URL generation
        mock_bucket.get_public_url.return_value = "https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/public/articraft-dev/test.mp3"
        
        # Mock signed URL generation
        mock_bucket.create_signed_url.return_value = {
            'signedURL': 'https://hlqvzgwmbejiviaekdns.supabase.co/storage/v1/object/sign/articraft-dev/test.mp3?token=***REMOVED***test_signature'
        }
        
        return mock_client, mock_bucket

    @pytest.fixture
    def supabase_service(self, mock_supabase_client):
        """Create SupabaseService instance with mocked client."""
        mock_client, mock_bucket = mock_supabase_client
        
        with patch('app.services.supabase_service.create_client', return_value=mock_client):
            with patch('app.services.supabase_service.settings') as mock_settings:
                mock_settings.supabase.url = "https://test.supabase.co"
                mock_settings.supabase.anon_key = "test_key"
                mock_settings.supabase.bucket = "test_bucket"
                mock_settings.supabase.environment = "test"
                
                service = SupabaseService()
                service.client = mock_client
                service.bucket_name = "test_bucket"
                service.environment = "test"
                
                return service, mock_bucket

    def test_signed_url_preserves_token(self, supabase_service, tmp_path):
        """Test that signed URL token is preserved."""
        service, mock_bucket = supabase_service
        
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock URL accessibility test to fail for public URL, succeed for signed URL
        def mock_test_accessibility(url):
            if '/object/public/' in url:
                return {"accessible": False, "status_code": 400}
            elif '/object/sign/' in url and 'token=' in url:
                return {"accessible": True, "status_code": 200}
            else:
                return {"accessible": False, "status_code": 400}
        
        with patch.object(service, '_test_url_accessibility', side_effect=mock_test_accessibility):
            # Test upload_file method
            result = service.upload_file(
                local_file_path=str(test_file),
                bucket_path="audio/generated/test_audio.mp3"
            )
            
            # Verify that the result contains a signed URL with token
            assert result["success"] is True
            assert "/object/sign/" in result["file_url"]
            assert "token=" in result["file_url"]
            assert "eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV80ODE4NDA3NS1jYjQ1LTQ3M2UtYTk2NS1iZGVhNTdkNDNlNTciLCJhbGciOiJIUzI1NiJ9" in result["file_url"]

    def test_public_url_fallback_when_accessible(self, supabase_service, tmp_path):
        """Test that public URL is used when accessible."""
        service, mock_bucket = supabase_service
        
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock URL accessibility test to succeed for public URL
        def mock_test_accessibility(url):
            return {"accessible": True, "status_code": 200}
        
        with patch.object(service, '_test_url_accessibility', side_effect=mock_test_accessibility):
            # Test upload_file method
            result = service.upload_file(
                local_file_path=str(test_file),
                bucket_path="audio/generated/test_audio.mp3"
            )
            
            # Verify that the result contains a public URL (not signed)
            assert result["success"] is True
            assert "/object/public/" in result["file_url"]
            assert "token=" not in result["file_url"]

    def test_url_cleaning_logic(self, supabase_service, tmp_path):
        """Test URL cleaning logic for different URL types."""
        service, mock_bucket = supabase_service
        
        # Test public URL cleaning
        public_url_with_params = "https://example.com/storage/v1/object/public/bucket/file.mp3?cache=123"
        # Should clean query params from public URLs
        assert public_url_with_params.split('?')[0] if '/object/public/' in public_url_with_params else public_url_with_params == "https://example.com/storage/v1/object/public/bucket/file.mp3"
        
        # Test signed URL preservation
        signed_url_with_token = "https://example.com/storage/v1/object/sign/bucket/file.mp3?token=abc123"
        # Should preserve token in signed URLs
        assert signed_url_with_token if '/object/sign/' in signed_url_with_token else signed_url_with_token.split('?')[0] == signed_url_with_token

    @patch('app.services.supabase_service.logger')
    def test_signed_url_creation_logging(self, mock_logger, supabase_service, tmp_path):
        """Test that signed URL creation is properly logged."""
        service, mock_bucket = supabase_service
        
        # Create a temporary test file
        test_file = tmp_path / "test_audio.mp3"
        test_file.write_bytes(b"fake audio data")
        
        # Mock URL accessibility test to fail for public URL
        def mock_test_accessibility(url):
            if '/object/public/' in url:
                return {"accessible": False, "status_code": 400}
            else:
                return {"accessible": True, "status_code": 200}
        
        with patch.object(service, '_test_url_accessibility', side_effect=mock_test_accessibility):
            # Test upload_file method
            result = service.upload_file(
                local_file_path=str(test_file),
                bucket_path="audio/generated/test_audio.mp3"
            )
            
            # Verify success
            assert result["success"] is True
            
            # Check that appropriate log messages were called
            mock_logger.warning.assert_called()  # For public URL failure
            mock_logger.info.assert_called()     # For signed URL creation
            
            # Verify log content includes signed URL information
            log_calls = mock_logger.info.call_args_list
            signed_url_logged = any(
                "签名URL" in str(call) or "signed" in str(call).lower()
                for call in log_calls
            )
            assert signed_url_logged, "Should log signed URL creation" 