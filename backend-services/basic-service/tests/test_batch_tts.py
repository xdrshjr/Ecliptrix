"""
Tests for batch text-to-speech functionality.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.models import BatchTTSRequest, BatchTTSSegmentRequest, VoiceType
from app.services.batch_tts_service import BatchTTSService

client = TestClient(app)


class TestBatchTTSEndpoint:
    """Test cases for batch TTS API endpoint."""
    
    def test_batch_tts_success(self):
        """Test successful batch TTS conversion."""
        request_data = {
            "segments": [
                {
                    "segment_id": "segment-1",
                    "text": "这是第一个测试段落。",
                    "title": "测试段落1"
                },
                {
                    "segment_id": "segment-2",
                    "text": "这是第二个测试段落。",
                    "title": "测试段落2"
                }
            ],
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "speed_ratio": 1.0,
            "task_id": "test_task_123",
            "concurrent_threads": 2
        }
        
        with patch('app.routers.tts_router.batch_tts_service') as mock_service:
            mock_service.convert_batch.return_value = Mock(
                success=True,
                message="批量语音转换完成，成功 2/2 个段落",
                total_segments=2,
                successful_segments=2,
                failed_segments=0,
                total_processing_time=10.5,
                results=[
                    Mock(
                        segment_id="segment-1",
                        success=True,
                        audio_url="/api/audio/generated/tts_segment-1_test.mp3",
                        duration=3.2,
                        file_size=51200,
                        error=None,
                        processing_time=5.1
                    ),
                    Mock(
                        segment_id="segment-2",
                        success=True,
                        audio_url="/api/audio/generated/tts_segment-2_test.mp3",
                        duration=3.8,
                        file_size=60800,
                        error=None,
                        processing_time=5.4
                    )
                ]
            )
            
            response = client.post("/api/tts/convert-batch", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["total_segments"] == 2
            assert data["successful_segments"] == 2
            assert data["failed_segments"] == 0
            assert len(data["results"]) == 2
            
            # 验证服务被正确调用
            mock_service.convert_batch.assert_called_once()
    
    def test_batch_tts_partial_failure(self):
        """Test batch TTS with some segments failing."""
        request_data = {
            "segments": [
                {
                    "segment_id": "segment-1",
                    "text": "这是一个正常的段落。",
                    "title": "正常段落"
                },
                {
                    "segment_id": "segment-2",
                    "text": "",  # 空文本，应该失败
                    "title": "空段落"
                }
            ],
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "task_id": "test_task_456"
        }
        
        with patch('app.routers.tts_router.batch_tts_service') as mock_service:
            mock_service.convert_batch.return_value = Mock(
                success=False,
                message="批量语音转换完成，成功 1/2 个段落",
                total_segments=2,
                successful_segments=1,
                failed_segments=1,
                total_processing_time=8.3,
                results=[
                    Mock(
                        segment_id="segment-1",
                        success=True,
                        audio_url="/api/audio/generated/tts_segment-1_test.mp3",
                        duration=3.2,
                        file_size=51200,
                        error=None,
                        processing_time=5.1
                    ),
                    Mock(
                        segment_id="segment-2",
                        success=False,
                        audio_url=None,
                        duration=None,
                        file_size=None,
                        error="文本内容不能为空",
                        processing_time=3.2
                    )
                ]
            )
            
            response = client.post("/api/tts/convert-batch", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert data["total_segments"] == 2
            assert data["successful_segments"] == 1
            assert data["failed_segments"] == 1
    
    def test_batch_tts_validation_error(self):
        """Test batch TTS with validation errors."""
        # 测试空segments列表
        request_data = {
            "segments": [],
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        response = client.post("/api/tts/convert-batch", json=request_data)
        assert response.status_code == 422  # Validation error
    
    def test_batch_tts_invalid_voice_type(self):
        """Test batch TTS with invalid voice type."""
        request_data = {
            "segments": [
                {
                    "segment_id": "segment-1",
                    "text": "测试文本",
                    "title": "测试"
                }
            ],
            "voice_type": "invalid_voice_type"
        }
        
        response = client.post("/api/tts/convert-batch", json=request_data)
        assert response.status_code == 422  # Validation error
    
    def test_batch_tts_service_exception(self):
        """Test batch TTS service throwing exception."""
        request_data = {
            "segments": [
                {
                    "segment_id": "segment-1",
                    "text": "测试文本",
                    "title": "测试"
                }
            ],
            "voice_type": "zh_female_wanqudashu_moon_bigtts",
            "task_id": "test_task_error"
        }
        
        with patch('app.routers.tts_router.batch_tts_service') as mock_service:
            mock_service.convert_batch.side_effect = Exception("服务器内部错误")
            
            response = client.post("/api/tts/convert-batch", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False
            assert "服务器内部错误" in data["message"]
            assert data["successful_segments"] == 0
            assert data["failed_segments"] == 1


class TestBatchTTSService:
    """Test cases for BatchTTSService."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.service = BatchTTSService()
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_validate_batch_request_success(self, mock_tts_service):
        """Test successful request validation."""
        request = BatchTTSRequest(
            segments=[
                BatchTTSSegmentRequest(
                    segment_id="segment-1",
                    text="这是一个测试段落。",
                    title="测试"
                )
            ],
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            task_id="test_task"
        )
        
        # Should not raise any exception
        self.service._validate_batch_request(request)
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_validate_batch_request_too_many_segments(self, mock_tts_service):
        """Test validation with too many segments."""
        segments = []
        for i in range(51):  # Exceeds max_segments_per_batch (50)
            segments.append(BatchTTSSegmentRequest(
                segment_id=f"segment-{i}",
                text=f"测试段落 {i}",
                title=f"测试 {i}"
            ))
        
        request = BatchTTSRequest(
            segments=segments,
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS
        )
        
        with pytest.raises(ValueError, match="段落数量超过限制"):
            self.service._validate_batch_request(request)
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_validate_batch_request_text_too_long(self, mock_tts_service):
        """Test validation with text too long."""
        long_text = "测" * 5001  # Exceeds max_text_length_per_segment (5000)
        
        request = BatchTTSRequest(
            segments=[
                BatchTTSSegmentRequest(
                    segment_id="segment-1",
                    text=long_text,
                    title="长文本测试"
                )
            ],
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS
        )
        
        with pytest.raises(ValueError, match="文本长度超过限制"):
            self.service._validate_batch_request(request)
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_convert_single_segment_success(self, mock_tts_service):
        """Test successful single segment conversion."""
        mock_tts_service.return_value.convert_text_to_speech.return_value = {
            "audio_url": "/api/audio/generated/test_audio.mp3",
            "file_size": 51200,
            "duration": 3.2,
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        result = self.service._convert_single_segment(
            segment_text="测试文本",
            segment_id="segment-1",
            segment_title="测试",
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            speed_ratio=1.0,
            task_id="test_task"
        )
        
        assert result.segment_id == "segment-1"
        assert result.success is True
        assert result.audio_url == "/api/audio/generated/test_audio.mp3"
        assert result.file_size == 51200
        assert result.duration == 3.2
        assert result.error is None
        assert result.processing_time > 0
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_convert_single_segment_failure(self, mock_tts_service):
        """Test single segment conversion failure."""
        mock_tts_service.return_value.convert_text_to_speech.side_effect = Exception("转换失败")
        
        result = self.service._convert_single_segment(
            segment_text="测试文本",
            segment_id="segment-1",
            segment_title="测试",
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            speed_ratio=1.0,
            task_id="test_task"
        )
        
        assert result.segment_id == "segment-1"
        assert result.success is False
        assert result.audio_url is None
        assert result.error == "转换失败"
        assert result.processing_time > 0
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_convert_batch_success(self, mock_tts_service):
        """Test successful batch conversion."""
        mock_tts_service.return_value.convert_text_to_speech.return_value = {
            "audio_url": "/api/audio/generated/test_audio.mp3",
            "file_size": 51200,
            "duration": 3.2,
            "voice_type": "zh_female_wanqudashu_moon_bigtts"
        }
        
        request = BatchTTSRequest(
            segments=[
                BatchTTSSegmentRequest(
                    segment_id="segment-1",
                    text="第一个测试段落。",
                    title="测试1"
                ),
                BatchTTSSegmentRequest(
                    segment_id="segment-2",
                    text="第二个测试段落。",
                    title="测试2"
                )
            ],
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            task_id="test_task",
            concurrent_threads=2
        )
        
        result = self.service.convert_batch(request)
        
        assert result.success is True
        assert result.total_segments == 2
        assert result.successful_segments == 2
        assert result.failed_segments == 0
        assert len(result.results) == 2
        assert result.total_processing_time > 0
        
        # 验证结果顺序
        assert result.results[0].segment_id == "segment-1"
        assert result.results[1].segment_id == "segment-2"
    
    @patch('app.services.batch_tts_service.TTSService')
    def test_convert_batch_with_failures(self, mock_tts_service):
        """Test batch conversion with some failures."""
        def mock_convert(text, **kwargs):
            if "失败" in text:
                raise Exception("模拟转换失败")
            return {
                "audio_url": "/api/audio/generated/test_audio.mp3",
                "file_size": 51200,
                "duration": 3.2,
                "voice_type": "zh_female_wanqudashu_moon_bigtts"
            }
        
        mock_tts_service.return_value.convert_text_to_speech.side_effect = mock_convert
        
        request = BatchTTSRequest(
            segments=[
                BatchTTSSegmentRequest(
                    segment_id="segment-1",
                    text="正常的测试段落。",
                    title="正常测试"
                ),
                BatchTTSSegmentRequest(
                    segment_id="segment-2",
                    text="这个段落会失败。",
                    title="失败测试"
                )
            ],
            voice_type=VoiceType.ZH_FEMALE_WANQUDASHU_MOON_BIGTTS,
            task_id="test_task"
        )
        
        result = self.service.convert_batch(request)
        
        assert result.success is False  # 有失败的段落
        assert result.total_segments == 2
        assert result.successful_segments == 1
        assert result.failed_segments == 1
        assert len(result.results) == 2
        
        # 检查具体结果
        success_result = next(r for r in result.results if r.success)
        failure_result = next(r for r in result.results if not r.success)
        
        assert success_result.segment_id == "segment-1"
        assert success_result.audio_url is not None
        
        assert failure_result.segment_id == "segment-2"
        assert failure_result.audio_url is None
        assert "模拟转换失败" in failure_result.error


class TestBatchTTSConfig:
    """Test cases for batch TTS configuration."""
    
    def test_config_loading(self):
        """Test that configuration is loaded correctly."""
        from app.config import settings
        
        assert hasattr(settings, 'batch_tts')
        assert settings.batch_tts.concurrent_threads >= 1
        assert settings.batch_tts.max_concurrent_threads >= settings.batch_tts.concurrent_threads
        assert settings.batch_tts.request_timeout > 0
        assert settings.batch_tts.batch_timeout > 0
    
    def test_config_limits(self):
        """Test configuration limits."""
        from app.config import settings
        
        limits = settings.batch_tts.limits
        assert limits.max_segments_per_batch > 0
        assert limits.max_text_length_per_segment > 0
        assert limits.max_total_text_length > 0
    
    def test_config_retry_settings(self):
        """Test retry configuration."""
        from app.config import settings
        
        retry = settings.batch_tts.retry
        assert retry.max_attempts > 0
        assert retry.delay_seconds > 0
        assert retry.backoff_factor >= 1


if __name__ == "__main__":
    pytest.main([__file__]) 