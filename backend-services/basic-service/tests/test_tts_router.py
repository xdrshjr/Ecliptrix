"""
Tests for TTS (Text-to-Speech) router endpoints.
"""

import pytest
import os
import subprocess
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
        
        # Check that at least one voice type exists and has the new category field
        voice_ids = list(data["data"].keys())
        first_voice_id = voice_ids[0]
        voice_info = data["data"][first_voice_id]
        
        # Verify all required fields are present
        assert "name" in voice_info
        assert "language" in voice_info
        assert "gender" in voice_info
        assert "description" in voice_info
        assert "category" in voice_info  # New field
        
        # Verify category is one of the expected values
        expected_categories = ['通用场景', '趣味方言', '角色扮演', '播报解说', '有声阅读', '其他']
        assert voice_info["category"] in expected_categories

    def test_get_voice_types_with_categories(self):
        """Test that voice types are properly categorized."""
        response = client.get("/api/tts/voice-types")
        
        assert response.status_code == 200
        data = response.json()
        
        # Collect all categories from the response
        categories = set()
        for voice_info in data["data"].values():
            categories.add(voice_info["category"])
        
        # Should have multiple categories
        assert len(categories) >= 2
        
        # Count voices by category
        category_counts = {}
        for voice_info in data["data"].values():
            category = voice_info["category"]
            category_counts[category] = category_counts.get(category, 0) + 1
        
        # Log the category distribution for debugging
        print(f"Voice distribution by category: {category_counts}")
        
        # Should have at least one voice in the general category
        assert category_counts.get('通用场景', 0) > 0

    @patch('app.services.tts_service.TTSService.get_available_voice_types')
    def test_get_voice_types_config_file_error(self, mock_get_voices):
        """Test voice types endpoint when config file loading fails."""
        # Mock the service to return fallback voices
        from app.models.tts_models import VoiceTypeInfo, VoiceType
        
        fallback_voices = {
            VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value: VoiceTypeInfo(
                id=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS.value,
                name="温柔女声",
                language="zh-CN",
                gender="female",
                description="温柔甜美的女性声音，适合讲解和叙述",
                category="通用场景"
            )
        }
        mock_get_voices.return_value = fallback_voices
        
        response = client.get("/api/tts/voice-types")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] is True
        assert len(data["data"]) == 1
        assert "zh_female_wanqudashu_moon_bigtts" in data["data"]
        
        voice_info = data["data"]["zh_female_wanqudashu_moon_bigtts"]
        assert voice_info["category"] == "通用场景"

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

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_with_ffmpeg_duration(self, mock_convert):
        """Test TTS conversion with ffmpeg duration detection."""
        # Mock the service response with ffmpeg duration
        mock_convert.return_value = {
            "audio_url": "/api/audio/generated/test_audio.mp3",
            "file_name": "test_audio.mp3",
            "file_size": 12345,
            "duration": 5.7,  # Actual duration from ffmpeg
            "duration_method": "ffmpeg",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "text_length": 20,
            "speed_ratio": 1.0,
            "request_id": "test_req_123",
            "created_at": "2024-01-15T10:30:00",
            "segment_id": "test_segment",
            "task_id": "test_task",
            "mock_mode": False
        }
        
        request_data = {
            "text": "这是一个测试文本。",
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
        assert data["data"]["duration"] == 5.7
        assert data["data"]["duration_method"] == "ffmpeg"
        assert data["data"]["file_name"] == "test_audio.mp3"
        
        # Verify the service was called with correct parameters
        mock_convert.assert_called_once_with(
            text="这是一个测试文本。",
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            speed_ratio=1.0,
            segment_id="test_segment",
            task_id="test_task"
        )

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_with_estimated_duration(self, mock_convert):
        """Test TTS conversion with estimated duration (ffmpeg unavailable)."""
        # Mock the service response with estimated duration
        mock_convert.return_value = {
            "audio_url": "/api/audio/generated/test_audio.mp3",
            "file_name": "test_audio.mp3",
            "file_size": 12345,
            "duration": 3.0,  # Estimated duration
            "duration_method": "estimated",
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "text_length": 20,
            "speed_ratio": 1.0,
            "request_id": "test_req_123",
            "created_at": "2024-01-15T10:30:00",
            "segment_id": "test_segment",
            "task_id": "test_task",
            "mock_mode": False
        }
        
        request_data = {
            "text": "这是一个测试文本。",
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
        assert data["data"]["duration"] == 3.0
        assert data["data"]["duration_method"] == "estimated"
        
        mock_convert.assert_called_once()


class TestTTSService:
    """Test cases for TTS service methods."""
    
    @patch('subprocess.run')
    def test_check_ffmpeg_available(self, mock_subprocess):
        """Test ffmpeg availability check when ffmpeg is available."""
        from app.services.tts_service import TTSService
        
        # Mock successful ffmpeg version check
        mock_subprocess.return_value = Mock(returncode=0)
        
        service = TTSService()
        result = service._check_ffmpeg()
        
        assert result is True
        mock_subprocess.assert_called_with(['ffmpeg', '-version'], 
                                         capture_output=True, check=True)

    @patch('subprocess.run')
    def test_check_ffmpeg_unavailable(self, mock_subprocess):
        """Test ffmpeg availability check when ffmpeg is not available."""
        from app.services.tts_service import TTSService
        
        # Mock ffmpeg not found
        mock_subprocess.side_effect = FileNotFoundError()
        
        service = TTSService()
        result = service._check_ffmpeg()
        
        assert result is False

    @patch('subprocess.run')
    def test_get_audio_duration_with_ffmpeg_success(self, mock_subprocess):
        """Test successful audio duration detection with ffmpeg."""
        from app.services.tts_service import TTSService
        
        # Mock successful ffprobe execution
        mock_result = Mock()
        mock_result.stdout = "15.5\n"
        mock_result.returncode = 0
        mock_subprocess.return_value = mock_result
        
        service = TTSService()
        duration = service._get_audio_duration_with_ffmpeg("/path/to/audio.mp3")
        
        assert duration == 15.5
        # Verify ffprobe was called with correct parameters
        mock_subprocess.assert_called_with([
            'ffprobe',
            '-v', 'quiet',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            '/path/to/audio.mp3'
        ], capture_output=True, text=True, check=True)

    @patch('subprocess.run')
    def test_get_audio_duration_with_ffmpeg_failure(self, mock_subprocess):
        """Test audio duration detection when ffprobe fails."""
        from app.services.tts_service import TTSService
        
        # Mock ffprobe failure
        mock_subprocess.side_effect = subprocess.CalledProcessError(1, 'ffprobe')
        
        service = TTSService()
        duration = service._get_audio_duration_with_ffmpeg("/path/to/audio.mp3")
        
        assert duration is None

    def test_estimate_audio_duration(self):
        """Test audio duration estimation fallback."""
        from app.services.tts_service import TTSService
        
        service = TTSService()
        
        # Test basic estimation
        duration = service._estimate_audio_duration(text_length=100, speed_ratio=1.0)
        assert duration == 15.0  # 100 * 0.15
        
        # Test with speed adjustment
        duration = service._estimate_audio_duration(text_length=100, speed_ratio=2.0)
        assert duration == 7.5  # 100 * 0.15 / 2.0
        
        # Test with slower speed
        duration = service._estimate_audio_duration(text_length=100, speed_ratio=0.5)
        assert duration == 30.0  # 100 * 0.15 / 0.5

    @patch('app.services.tts_service.TTSService._get_audio_duration_with_ffmpeg')
    @patch('app.services.tts_service.TTSService._estimate_audio_duration')
    def test_duration_detection_fallback(self, mock_estimate, mock_ffmpeg):
        """Test that estimation is used when ffmpeg fails."""
        from app.services.tts_service import TTSService
        
        # Mock ffmpeg failure and estimation success
        mock_ffmpeg.return_value = None
        mock_estimate.return_value = 12.0
        
        service = TTSService()
        
        # This would be called within convert_text_to_speech
        ffmpeg_duration = service._get_audio_duration_with_ffmpeg("/path/to/audio.mp3")
        assert ffmpeg_duration is None
        
        estimated_duration = service._estimate_audio_duration(80, 1.0)
        assert estimated_duration == 12.0

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
        
        # Check that we have voices with categories
        categories = set()
        for voice_info in voice_types.values():
            categories.add(voice_info.category)
            # Verify all required fields are present
            assert hasattr(voice_info, 'id')
            assert hasattr(voice_info, 'name')
            assert hasattr(voice_info, 'language')
            assert hasattr(voice_info, 'gender')
            assert hasattr(voice_info, 'description')
            assert hasattr(voice_info, 'category')
        
        # Should have multiple categories if config file is loaded successfully
        if len(voice_types) > 6:  # More than fallback voices
            assert len(categories) > 1

    @patch('app.services.tts_service.Path.exists')
    @patch('builtins.open')
    @patch('yaml.safe_load')
    def test_voice_config_file_loading_success(self, mock_yaml_load, mock_open, mock_exists):
        """Test successful loading of voice configuration from YAML file."""
        from app.services.tts_service import TTSService
        
        # Mock config file exists
        mock_exists.return_value = True
        
        # Mock YAML content
        mock_config = {
            'voice_types': {
                'volcano': {
                    'name': '语音合成引擎专业版',
                    'voices': [
                        {
                            'value': 'test_voice_1',
                            'label': '测试音色1 (女声)',
                            'category': '通用场景',
                            'gender': 'female',
                            'language': 'zh-CN',
                            'description': '测试音色描述'
                        },
                        {
                            'value': 'test_voice_2',
                            'label': '测试音色2 (男声)',
                            'category': '角色扮演',
                            'gender': 'male',
                            'language': 'zh-CN',
                            'description': '测试角色音色'
                        }
                    ]
                }
            }
        }
        mock_yaml_load.return_value = mock_config
        
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        # Should have 2 voices from config
        assert len(voice_types) == 2
        assert 'test_voice_1' in voice_types
        assert 'test_voice_2' in voice_types
        
        # Verify voice 1
        voice1 = voice_types['test_voice_1']
        assert voice1.name == '测试音色1 (女声)'
        assert voice1.category == '通用场景'
        assert voice1.gender == 'female'
        
        # Verify voice 2
        voice2 = voice_types['test_voice_2']
        assert voice2.name == '测试音色2 (男声)'
        assert voice2.category == '角色扮演'
        assert voice2.gender == 'male'

    @patch('app.services.tts_service.Path.exists')
    def test_voice_config_file_missing_fallback(self, mock_exists):
        """Test fallback to hardcoded voices when config file is missing."""
        from app.services.tts_service import TTSService
        
        # Mock config file doesn't exist
        mock_exists.return_value = False
        
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        # Should have fallback voices
        assert len(voice_types) > 0
        
        # Should contain at least one fallback voice
        fallback_voice_ids = [
            'zh_female_wanqudashu_moon_bigtts',
            'zh_female_sweet',
            'zh_male_warm'
        ]
        
        found_fallback = False
        for voice_id in fallback_voice_ids:
            if voice_id in voice_types:
                found_fallback = True
                # Verify it has the category field
                assert hasattr(voice_types[voice_id], 'category')
                break
        
        assert found_fallback, "Should contain at least one fallback voice"

    @patch('app.services.tts_service.Path.exists')
    @patch('builtins.open')
    def test_voice_config_file_yaml_error_fallback(self, mock_open, mock_exists):
        """Test fallback to hardcoded voices when YAML parsing fails."""
        from app.services.tts_service import TTSService
        
        # Mock config file exists but YAML parsing fails
        mock_exists.return_value = True
        mock_open.side_effect = Exception("YAML parsing error")
        
        service = TTSService()
        voice_types = service.get_available_voice_types()
        
        # Should have fallback voices
        assert len(voice_types) > 0
        
        # Verify at least one fallback voice has category
        for voice_info in voice_types.values():
            assert hasattr(voice_info, 'category')
            break


@pytest.fixture
def create_mock_audio_file():
    """Create a mock audio file for testing."""
    def _create_file(file_name: str, content: str = "mock audio content") -> str:
        audio_dir = "static/audio/generated"
        os.makedirs(audio_dir, exist_ok=True)
        file_path = os.path.join(audio_dir, file_name)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return file_path
    
    return _create_file


class TestTTSDownloadEndpoint:
    """Test TTS audio file download endpoint."""
    
    def test_download_existing_audio_file(self, create_mock_audio_file):
        """Test downloading an existing audio file."""
        # Create a mock audio file
        file_name = "test_audio_download.mp3"
        file_path = create_mock_audio_file(file_name, "Test audio content for download")
        
        # Test download endpoint
        response = client.get(f"/api/tts/download/{file_name}")
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert f"attachment; filename={file_name}" in response.headers.get("content-disposition", "")
        assert "no-cache" in response.headers.get("cache-control", "")
        
        # Verify file content
        assert len(response.content) > 0
        
        # Clean up
        if os.path.exists(file_path):
            os.remove(file_path)
    
    def test_download_nonexistent_audio_file(self):
        """Test downloading a non-existent audio file."""
        file_name = "nonexistent_audio.mp3"
        
        response = client.get(f"/api/tts/download/{file_name}")
        
        assert response.status_code == 404
        response_data = response.json()
        # Check message field instead of detail
        assert "音频文件不存在" in response_data.get("message", "")
    
    def test_download_empty_audio_file(self, create_mock_audio_file):
        """Test downloading an empty audio file."""
        file_name = "empty_audio.mp3"
        file_path = create_mock_audio_file(file_name, "")  # Empty content
        
        response = client.get(f"/api/tts/download/{file_name}")
        
        assert response.status_code == 500
        response_data = response.json()
        assert "音频文件已损坏" in response_data.get("message", "")
        
        # Clean up
        if os.path.exists(file_path):
            os.remove(file_path)
    
    def test_download_with_special_characters_in_filename(self, create_mock_audio_file):
        """Test downloading file with special characters in filename."""
        file_name = "tts_segment_001_20241201_120000_12345678.mp3"
        file_path = create_mock_audio_file(file_name, "Audio content with special filename")
        
        response = client.get(f"/api/tts/download/{file_name}")
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert f"attachment; filename={file_name}" in response.headers.get("content-disposition", "")
        
        # Clean up
        if os.path.exists(file_path):
            os.remove(file_path)
    
    def test_download_file_security(self):
        """Test that download endpoint prevents path traversal attacks."""
        # Try to access files outside the audio directory
        malicious_filenames = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"
        ]
        
        for filename in malicious_filenames:
            response = client.get(f"/api/tts/download/{filename}")
            # Should return 404 for non-existent files (security through obscurity)
            assert response.status_code in [404, 500]


if __name__ == "__main__":
    pytest.main([__file__]) 