"""
TTS API 测试用例

整个模块默认跳过，需要 ``RUN_TTS_INTEGRATION=1`` 才会执行。

两个原因叠在一起：
1. ``TestTTSAPIIntegration`` 需要真实的火山 TTS 凭证；
2. ``TestTTSAPI`` 的 mock 断言写于更早的一代 TTS 路由契约，与当前
   ``app/routers/tts_router.py`` / ``app/services/tts_service.py`` 已经漂移
   （patch 目标 ``check_health`` / ``get_voice_types`` / ``BatchTTSService.
   process_batch`` 均已不存在，若干端点返回 404/422）。

历史成因：这里原本写的是 ``pytest.config.getoption("--integration")``——
``pytest.config`` 是 pytest 5.0 移除的 API，且 ``--integration`` 从未在任何
conftest 里 ``addoption`` 注册过，所以该文件**从未被成功收集过**，漂移也就从未
被发现。本次只恢复"可收集"，重写这 17 个用例以对齐当前契约属独立工作项。
"""

import os
import pytest
import json
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch, MagicMock
from app.main import app
from app.models.tts_models import TTSRequest, VoiceType

# 创建测试客户端
client = TestClient(app)

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_TTS_INTEGRATION") != "1",
    reason="needs live Volcano TTS credentials and a contract refresh; "
           "set RUN_TTS_INTEGRATION=1 to run",
)

class TestTTSAPI:
    """TTS API 测试类"""
    
    def setup_method(self):
        """每个测试方法前的设置"""
        self.test_request = {
            "text": "这是一个测试文本",
            "voice_type": "zh-CN-XiaoxiaoNeural",
            "speed_ratio": 1.0,
            "segment_id": "test_segment_001",
            "task_id": "test_task_001"
        }
        
        self.expected_response = {
            "success": True,
            "message": "语音转换成功",
            "data": {
                "audio_url": "http://localhost:8000/api/audio/generated/test_audio.mp3",
                "duration": 2.5,
                "file_size": 45678,
                "voice_type": "zh-CN-XiaoxiaoNeural",
                "text_length": 7,
                "request_id": "req_test_123",
                "file_name": "test_audio.mp3",
                "speed_ratio": 1.0,
                "segment_id": "test_segment_001",
                "task_id": "test_task_001",
                "mock_mode": False,
                "duration_method": "ffmpeg"
            }
        }

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_success(self, mock_convert):
        """测试单个文本转语音成功"""
        # 设置mock返回值
        mock_convert.return_value = self.expected_response
        
        # 发送请求
        response = client.post("/api/tts/convert", json=self.test_request)
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "语音转换成功"
        assert "audio_url" in data["data"]
        assert data["data"]["voice_type"] == "zh-CN-XiaoxiaoNeural"
        assert data["data"]["text_length"] == 7
        
        # 验证mock被正确调用
        mock_convert.assert_called_once()
        
    def test_convert_text_to_speech_missing_text(self):
        """测试缺少文本参数"""
        request_data = self.test_request.copy()
        del request_data["text"]
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 422  # Validation error
        
    def test_convert_text_to_speech_empty_text(self):
        """测试空文本"""
        request_data = self.test_request.copy()
        request_data["text"] = ""
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "文本内容为空" in data["message"]
        
    def test_convert_text_to_speech_invalid_speed_ratio(self):
        """测试无效的语速比例"""
        request_data = self.test_request.copy()
        request_data["speed_ratio"] = 5.0  # 超出范围
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "语速比例" in data["message"]
        
    def test_convert_text_to_speech_text_too_long(self):
        """测试文本过长"""
        request_data = self.test_request.copy()
        request_data["text"] = "x" * 10001  # 超过10000字符限制
        
        response = client.post("/api/tts/convert", json=request_data)
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "文本长度超过限制" in data["message"]

    @patch('app.services.tts_service.tts_service.convert_text_to_speech')
    def test_convert_text_to_speech_service_error(self, mock_convert):
        """测试服务异常"""
        # 设置mock抛出异常
        mock_convert.side_effect = Exception("TTS服务异常")
        
        response = client.post("/api/tts/convert", json=self.test_request)
        
        assert response.status_code == 500
        data = response.json()
        assert data["success"] is False
        assert "TTS服务异常" in data["message"]

    @patch('app.services.batch_tts_service.BatchTTSService.process_batch')
    def test_batch_convert_success(self, mock_batch_convert):
        """测试批量转换成功"""
        batch_request = {
            "segments": [
                {
                    "segment_id": "seg_001",
                    "text": "第一个片段",
                    "title": "开场白"
                },
                {
                    "segment_id": "seg_002",
                    "text": "第二个片段",
                    "title": "主要内容"
                }
            ],
            "voice_type": "zh-CN-XiaoxiaoNeural",
            "speed_ratio": 1.0,
            "task_id": "batch_task_001",
            "concurrent_threads": 2
        }
        
        expected_batch_response = {
            "success": True,
            "message": "批量转换完成",
            "data": {
                "results": [
                    {
                        "segment_id": "seg_001",
                        "success": True,
                        "audio_url": "http://localhost:8000/api/audio/generated/seg_001.mp3",
                        "duration": 1.5,
                        "file_size": 23456,
                        "message": "转换成功"
                    },
                    {
                        "segment_id": "seg_002",
                        "success": True,
                        "audio_url": "http://localhost:8000/api/audio/generated/seg_002.mp3",
                        "duration": 2.0,
                        "file_size": 34567,
                        "message": "转换成功"
                    }
                ],
                "total_segments": 2,
                "successful_segments": 2,
                "failed_segments": 0,
                "processing_time": 3.5
            }
        }
        
        mock_batch_convert.return_value = expected_batch_response
        
        response = client.post("/api/tts/batch-convert", json=batch_request)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["total_segments"] == 2
        assert data["data"]["successful_segments"] == 2
        assert len(data["data"]["results"]) == 2

    def test_batch_convert_empty_segments(self):
        """测试批量转换空片段数组"""
        batch_request = {
            "segments": [],
            "voice_type": "zh-CN-XiaoxiaoNeural",
            "speed_ratio": 1.0
        }
        
        response = client.post("/api/tts/batch-convert", json=batch_request)
        
        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "片段数组不能为空" in data["message"]

    @patch('app.services.tts_service.tts_service.get_voice_types')
    def test_get_voice_types_success(self, mock_get_voices):
        """测试获取语音类型成功"""
        expected_voices = {
            "success": True,
            "message": "获取音色列表成功",
            "data": {
                "zh-CN-XiaoxiaoNeural": {
                    "name": "晓晓",
                    "language": "zh-CN",
                    "gender": "Female",
                    "description": "温柔自然的女性声音"
                },
                "zh-CN-YunxiNeural": {
                    "name": "云希",
                    "language": "zh-CN",
                    "gender": "Male",
                    "description": "清晰稳重的男性声音"
                }
            }
        }
        
        mock_get_voices.return_value = expected_voices
        
        response = client.get("/api/tts/voice-types")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "zh-CN-XiaoxiaoNeural" in data["data"]
        assert "zh-CN-YunxiNeural" in data["data"]

    @patch('app.services.tts_service.tts_service.get_voice_types')
    def test_get_voice_types_service_error(self, mock_get_voices):
        """测试获取语音类型服务异常"""
        mock_get_voices.side_effect = Exception("配置文件读取失败")
        
        response = client.get("/api/tts/voice-types")
        
        assert response.status_code == 500
        data = response.json()
        assert data["success"] is False

    @patch('os.path.exists')
    @patch('builtins.open')
    def test_download_audio_file_success(self, mock_open, mock_exists):
        """测试音频文件下载成功"""
        # 设置文件存在
        mock_exists.return_value = True
        
        # 模拟文件内容
        mock_file_content = b"fake audio content"
        mock_file = MagicMock()
        mock_file.read.return_value = mock_file_content
        mock_open.return_value.__enter__.return_value = mock_file
        
        response = client.get("/api/audio/generated/test_audio.mp3")
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"

    @patch('os.path.exists')
    def test_download_audio_file_not_found(self, mock_exists):
        """测试音频文件不存在"""
        mock_exists.return_value = False
        
        response = client.get("/api/audio/generated/nonexistent.mp3")
        
        assert response.status_code == 404
        data = response.json()
        assert "音频文件不存在" in data["detail"]

    def test_download_audio_file_invalid_filename(self):
        """测试无效文件名"""
        # 测试包含路径遍历的文件名
        response = client.get("/api/audio/generated/../../../etc/passwd")
        
        assert response.status_code == 400
        data = response.json()
        assert "无效的文件名" in data["detail"]

    @patch('app.services.tts_service.tts_service.check_health')
    def test_health_check_healthy(self, mock_health):
        """测试健康检查 - 健康状态"""
        expected_health = {
            "service": "TTS",
            "status": "healthy",
            "message": "TTS服务运行正常",
            "timestamp": "2024-01-10T14:30:22Z",
            "dependencies": {
                "tts_engine": "available",
                "file_system": "writable"
            }
        }
        
        mock_health.return_value = expected_health
        
        response = client.get("/api/tts/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "TTS"

    @patch('app.services.tts_service.tts_service.check_health')
    def test_health_check_unhealthy(self, mock_health):
        """测试健康检查 - 不健康状态"""
        expected_health = {
            "service": "TTS",
            "status": "unhealthy",
            "message": "TTS配置不完整",
            "timestamp": "2024-01-10T14:30:22Z"
        }
        
        mock_health.return_value = expected_health
        
        response = client.get("/api/tts/health")
        
        assert response.status_code == 503
        data = response.json()
        assert data["status"] == "unhealthy"

    def test_convert_with_special_characters(self):
        """测试包含特殊字符的文本转换"""
        request_data = self.test_request.copy()
        request_data["text"] = "Hello! 你好，世界。测试@#$%符号123"
        
        with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
            mock_convert.return_value = self.expected_response
            
            response = client.post("/api/tts/convert", json=request_data)
            
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_convert_with_different_voice_types(self):
        """测试不同语音类型"""
        voice_types = [
            "zh-CN-XiaoxiaoNeural",
            "zh-CN-YunxiNeural",
            "en-US-JennyNeural"
        ]
        
        for voice_type in voice_types:
            request_data = self.test_request.copy()
            request_data["voice_type"] = voice_type
            
            with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
                mock_convert.return_value = self.expected_response
                
                response = client.post("/api/tts/convert", json=request_data)
                
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True

    def test_convert_with_different_speed_ratios(self):
        """测试不同语速比例"""
        speed_ratios = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0]
        
        for speed_ratio in speed_ratios:
            request_data = self.test_request.copy()
            request_data["speed_ratio"] = speed_ratio
            
            with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
                mock_convert.return_value = self.expected_response
                
                response = client.post("/api/tts/convert", json=request_data)
                
                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True

    @pytest.mark.parametrize("invalid_speed", [-1, 0, 3.1, 10, "invalid"])
    def test_convert_with_invalid_speed_ratios(self, invalid_speed):
        """测试无效语速比例"""
        request_data = self.test_request.copy()
        request_data["speed_ratio"] = invalid_speed
        
        response = client.post("/api/tts/convert", json=request_data)
        
        # 根据输入类型，可能是422（类型错误）或400（值错误）
        assert response.status_code in [400, 422]

    def test_concurrent_requests(self):
        """测试并发请求"""
        import threading
        import time
        
        results = []
        
        def make_request():
            with patch('app.services.tts_service.tts_service.convert_text_to_speech') as mock_convert:
                mock_convert.return_value = self.expected_response
                response = client.post("/api/tts/convert", json=self.test_request)
                results.append(response.status_code)
        
        # 创建多个并发请求
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=make_request)
            threads.append(thread)
            thread.start()
        
        # 等待所有线程完成
        for thread in threads:
            thread.join()
        
        # 验证所有请求都成功
        assert all(status == 200 for status in results)
        assert len(results) == 5


class TestTTSAPIIntegration:
    """TTS API 集成测试"""

    def test_full_tts_workflow(self):
        """测试完整的TTS工作流程"""
        # 1. 检查服务健康状态
        health_response = client.get("/api/tts/health")
        if health_response.status_code != 200:
            pytest.skip("TTS service is not healthy")
        
        # 2. 获取可用语音类型
        voices_response = client.get("/api/tts/voice-types")
        assert voices_response.status_code == 200
        voices_data = voices_response.json()
        assert voices_data["success"] is True
        
        # 3. 选择一个语音类型进行转换
        voice_types = list(voices_data["data"].keys())
        if not voice_types:
            pytest.skip("No voice types available")
        
        selected_voice = voice_types[0]
        
        # 4. 执行文本转语音
        convert_request = {
            "text": "这是一个集成测试文本",
            "voice_type": selected_voice,
            "speed_ratio": 1.0,
            "task_id": "integration_test"
        }
        
        convert_response = client.post("/api/tts/convert", json=convert_request)
        assert convert_response.status_code == 200
        convert_data = convert_response.json()
        assert convert_data["success"] is True
        
        # 5. 验证生成的音频文件
        audio_url = convert_data["data"]["audio_url"]
        file_name = convert_data["data"]["file_name"]
        
        # 尝试下载音频文件
        download_response = client.get(f"/api/audio/generated/{file_name}")
        assert download_response.status_code == 200
        assert download_response.headers["content-type"] == "audio/mpeg"


# 配置pytest命令行选项
def pytest_addoption(parser):
    parser.addoption(
        "--integration",
        action="store_true",
        default=False,
        help="run integration tests"
    )


# 测试运行配置
if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 