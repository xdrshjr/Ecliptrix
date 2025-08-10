"""
Tests for TTS (Text-to-Speech) router endpoints.
"""

import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.models.tts_models import VoiceType


client = TestClient(app)


class TestTTSRouter:
    """Test cases for TTS router endpoints."""

    def test_get_voice_types_success(self):
        """Test successful retrieval of voice types."""
        response = client.get("/api/tts/voice-types")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert "data" in data
        assert len(data["data"]) > 0
        
        # Check that default voice type exists
        assert "zh_female_wanqudashu_moon_bigtts" in data["data"]
        voice_info = data["data"]["zh_female_wanqudashu_moon_bigtts"]
        assert voice_info["name"] == "温柔女声"
        assert voice_info["language"] == "zh-CN"
        assert voice_info["gender"] == "female"

    @patch('app.services.tts_service.tts_service.validate_config')
    def test_tts_health_check_healthy(self, mock_validate):
        """Test TTS health check when service is healthy."""
        mock_validate.return_value = None  # No exception means healthy
        
        response = client.get("/api/tts/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["service"] == "TTS"
        assert data["status"] == "healthy"
        assert data["config_valid"] is True
        assert "available_voice_types" in data

    @patch('app.services.tts_service.tts_service.validate_config')
    def test_tts_health_check_unhealthy(self, mock_validate):
        """Test TTS health check when configuration is invalid."""
        from fastapi import HTTPException
        mock_validate.side_effect = HTTPException(
            status_code=500, 
            detail="TTS配置不完整：请检查环境变量"
        )
        
        response = client.get("/api/tts/health")
        
        assert response.status_code == 503
        data = response.json()
        
        assert data["service"] == "TTS"
        assert data["status"] == "unhealthy"
        assert data["config_valid"] is False

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_success(self, mock_convert):
        """Test successful text-to-speech conversion."""
        # Mock successful conversion result
        mock_result = {
            "audio_url": "/api/audio/generated/test_audio.mp3",
            "file_name": "test_audio.mp3",
            "file_size": 12345,
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "text_length": 10,
            "speed_ratio": 1.0,
            "request_id": "test_request_id",
            "created_at": "2024-01-15T10:30:00",
            "segment_id": "test_segment",
            "task_id": "test_task"
        }
        mock_convert.return_value = mock_result
        
        request_data = {
            "text": "测试文本内容",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "speed_ratio": 1.0,
            "segment_id": "test_segment",
            "task_id": "test_task"
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert data["message"] == "语音转换成功"
        assert data["data"]["audio_url"] == "/api/audio/generated/test_audio.mp3"
        assert data["data"]["voice_type"] == "zh_female_wanqudashu_moon_bigtts"
        
        # Verify service was called with correct parameters
        mock_convert.assert_called_once_with(
            text="测试文本内容",
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            speed_ratio=1.0,
            segment_id="test_segment",
            task_id="test_task"
        )

    def test_convert_text_to_speech_empty_text(self):
        """Test conversion with empty text."""
        request_data = {
            "text": "",
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        # Should return validation error due to empty text
        assert response.status_code == 422

    def test_convert_text_to_speech_invalid_voice_type(self):
        """Test conversion with invalid voice type."""
        request_data = {
            "text": "测试文本",
            "voice_type": "invalid_voice_type"
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        # Should return validation error due to invalid voice type
        assert response.status_code == 422

    def test_convert_text_to_speech_invalid_speed_ratio(self):
        """Test conversion with invalid speed ratio."""
        request_data = {
            "text": "测试文本",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "speed_ratio": 3.0  # Invalid: should be between 0.5 and 2.0
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        # Should return validation error due to invalid speed ratio
        assert response.status_code == 422

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_service_error(self, mock_convert):
        """Test conversion when service throws an error."""
        from fastapi import HTTPException
        mock_convert.side_effect = HTTPException(
            status_code=500,
            detail="语音转换失败：配置错误"
        )
        
        request_data = {
            "text": "测试文本内容",
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 500

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_unknown_error(self, mock_convert):
        """Test conversion when service throws an unknown error."""
        mock_convert.side_effect = Exception("Unknown error")
        
        request_data = {
            "text": "测试文本内容",
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 200  # Returns error response, not HTTP error
        data = response.json()
        
        assert data["success"] is False
        assert "语音转换失败" in data["message"]
        assert data["error_code"] == "CONVERSION_FAILED"

    def test_convert_text_to_speech_minimal_request(self):
        """Test conversion with minimal required parameters."""
        with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
            mock_result = {
                "audio_url": "/api/audio/generated/minimal_test.mp3",
                "file_name": "minimal_test.mp3",
                "file_size": 5000,
                "voice_type": "zh_female_wanqudashu_moon_bigtts",
                "text_length": 6,
                "speed_ratio": 1.0,
                "request_id": "minimal_request_id",
                "created_at": "2024-01-15T10:30:00",
                "segment_id": None,
                "task_id": None
            }
            mock_convert.return_value = mock_result
            
            request_data = {
                "text": "最小测试"
            }
            
            response = client.post("/api/tts/convert", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["success"] is True
            assert data["data"]["text_length"] == 6
            
            # Verify default values were used
            mock_convert.assert_called_once_with(
                text="最小测试",
                voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
                speed_ratio=1.0,
                segment_id=None,
                task_id=None
            )

    def test_convert_text_to_speech_long_text(self):
        """Test conversion with text at the maximum length."""
        long_text = "测试" * 2500  # 5000 characters
        
        with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
            mock_result = {
                "audio_url": "/api/audio/generated/long_test.mp3",
                "file_name": "long_test.mp3",
                "file_size": 50000,
                "voice_type": "zh_female_wanqudashu_moon_bigtts",
                "text_length": 5000,
                "speed_ratio": 1.0,
                "request_id": "long_request_id",
                "created_at": "2024-01-15T10:30:00",
                "segment_id": None,
                "task_id": None
            }
            mock_convert.return_value = mock_result
            
            request_data = {
                "text": long_text
            }
            
            response = client.post("/api/tts/convert", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            
            assert data["success"] is True
            assert data["data"]["text_length"] == 5000


class TestTTSService:
    """Test cases for TTS service functionality."""

    @patch.dict(os.environ, {
        'VOLCANO_TTS_APPID': 'test_app_id',
        'VOLCANO_TTS_ACCESS_TOKEN': 'test_token'
    })
    def test_validate_config_success(self):
        """Test successful configuration validation."""
        from app.services.tts_service import TTSService
        
        service = TTSService()
        # Should not raise any exception
        service.validate_config()

    @patch.dict(os.environ, {}, clear=True)
    def test_validate_config_missing_appid(self):
        """Test configuration validation with missing app ID."""
        from app.services.tts_service import TTSService
        from fastapi import HTTPException
        
        service = TTSService()
        
        with pytest.raises(HTTPException) as exc_info:
            service.validate_config()
        
        assert exc_info.value.status_code == 500
        assert "TTS配置不完整" in exc_info.value.detail

    def test_get_available_voice_types(self):
        """Test getting available voice types."""
        from app.services.tts_service import TTSService
        
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        assert len(voice_types) > 0
        assert "zh_female_wanqudashu_moon_bigtts" in voice_types
        
        voice_info = voice_types["zh_female_wanqudashu_moon_bigtts"]
        assert voice_info.name == "温柔女声"
        assert voice_info.language == "zh-CN"
        assert voice_info.gender == "female"


if __name__ == "__main__":
    pytest.main([__file__]) 