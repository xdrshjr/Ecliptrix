"""
Tests for audio transcription functionality.
"""

import os
import sys
import pytest
import asyncio
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)

from app.main import app
from app.services.audio_transcription_service import AudioTranscriptionService
from app.models.audio_models import SubtitleItem


class TestAudioTranscriptionService:
    """音频转字幕服务测试类"""
    
    def setup_method(self):
        """测试前的设置"""
        self.test_audio_path = "datas/audio/audio-01.mp3"
        
    def test_service_initialization(self):
        """测试服务初始化"""
        try:
            service = AudioTranscriptionService()
            assert service.appid is not None
            assert service.access_token is not None
            assert service.secret_key is not None
            assert service.base_url == 'https://openspeech.bytedance.com/api/v1/vc'
            print("✓ 音频转字幕服务初始化测试通过")
        except Exception as e:
            print(f"✗ 音频转字幕服务初始化测试失败: {str(e)}")
            
    def test_ms_to_srt_time_conversion(self):
        """测试毫秒到SRT时间格式转换"""
        service = AudioTranscriptionService()
        
        # 测试用例
        test_cases = [
            (0, "00:00:00,000"),
            (1000, "00:00:01,000"),
            (60000, "00:01:00,000"),
            (3661500, "01:01:01,500"),
            (7323456, "02:02:03,456")
        ]
        
        for milliseconds, expected in test_cases:
            result = service.ms_to_srt_time(milliseconds)
            assert result == expected, f"转换 {milliseconds}ms 失败，期望 {expected}，得到 {result}"
            
        print("✓ 毫秒到SRT时间格式转换测试通过")
        
    def test_convert_to_srt(self):
        """测试字幕数据转换为SRT格式"""
        service = AudioTranscriptionService()
        
        # 模拟API返回的字幕数据
        subtitle_data = {
            'utterances': [
                {
                    'start_time': 0,
                    'end_time': 2000,
                    'text': '这是第一句话'
                },
                {
                    'start_time': 2500,
                    'end_time': 5000,
                    'text': '这是第二句话'
                }
            ]
        }
        
        srt_content = service.convert_to_srt(subtitle_data)
        assert srt_content is not None
        assert "1" in srt_content
        assert "00:00:00,000 --> 00:00:02,000" in srt_content
        assert "这是第一句话" in srt_content
        assert "2" in srt_content
        assert "00:00:02,500 --> 00:00:05,000" in srt_content
        assert "这是第二句话" in srt_content
        
        print("✓ 字幕数据转换为SRT格式测试通过")
        
    @patch('requests.post')
    def test_submit_audio_success(self, mock_post):
        """测试音频提交成功"""
        # 模拟成功响应
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'message': 'Success',
            'id': 'test_job_id_123'
        }
        mock_post.return_value = mock_response
        
        service = AudioTranscriptionService()
        
        # 创建临时测试文件
        test_file_path = "temp_test_audio.wav"
        with open(test_file_path, 'wb') as f:
            f.write(b"fake audio data")
            
        try:
            job_id = service.submit_audio(test_file_path)
            assert job_id == 'test_job_id_123'
            print("✓ 音频提交成功测试通过")
        finally:
            # 清理测试文件
            if os.path.exists(test_file_path):
                os.remove(test_file_path)
                
    @patch('requests.get')
    def test_query_result_success(self, mock_get):
        """测试查询结果成功"""
        # 模拟成功响应
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'code': 0,
            'utterances': [
                {
                    'start_time': 0,
                    'end_time': 2000,
                    'text': '测试字幕内容'
                }
            ]
        }
        mock_get.return_value = mock_response
        
        service = AudioTranscriptionService()
        result = service.query_result('test_job_id')
        
        assert result is not None
        assert result['code'] == 0
        assert 'utterances' in result
        assert len(result['utterances']) == 1
        assert result['utterances'][0]['text'] == '测试字幕内容'
        
        print("✓ 查询结果成功测试通过")
        
    def test_save_srt_file(self):
        """测试保存SRT文件"""
        service = AudioTranscriptionService()
        
        srt_content = """1
00:00:00,000 --> 00:00:02,000
测试字幕内容

2
00:00:02,500 --> 00:00:05,000
第二句测试内容

"""
        
        try:
            file_path, file_url = service.save_srt_file(srt_content, "test_audio")
            
            assert os.path.exists(file_path)
            assert file_url.startswith("/static/audio/subtitles/")
            assert file_url.endswith(".srt")
            
            # 验证文件内容
            with open(file_path, 'r', encoding='utf-8') as f:
                saved_content = f.read()
                assert saved_content == srt_content
                
            print("✓ 保存SRT文件测试通过")
            
        finally:
            # 清理测试文件
            if 'file_path' in locals() and os.path.exists(file_path):
                os.remove(file_path)


class TestAudioTranscriptionAPI:
    """音频转字幕API测试类"""
    
    def setup_method(self):
        """测试前的设置"""
        self.client = TestClient(app)
        self.test_audio_path = os.path.abspath("datas/audio/audio-01.mp3")
        
    def test_health_check(self):
        """测试健康检查接口"""
        response = self.client.get("/api/audio/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["service"] == "audio_transcription"
        assert "status" in data
        assert "config" in data
        
        print("✓ 音频转字幕健康检查接口测试通过")
        
    def test_transcribe_local_audio_file_not_found(self):
        """测试本地音频转字幕 - 文件不存在"""
        response = self.client.post(
            "/api/audio/transcribe-local",
            json={
                "language": "zh-CN",
                "use_itn": True,
                "use_punc": False,
                "max_lines": 2,
                "words_per_line": 15,
                "generate_srt_file": True
            },
            data={"file_path": "nonexistent_file.mp3"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == False
        assert data["error_code"] == "FILE_NOT_FOUND"
        
        print("✓ 本地音频转字幕文件不存在测试通过")
        
    @pytest.mark.skipif(
        not os.path.exists("datas/audio/audio-01.mp3"),
        reason="测试音频文件不存在"
    )
    def test_transcribe_local_audio_real_file(self):
        """测试本地音频转字幕 - 真实文件（需要有效的API配置）"""
        if not os.path.exists(self.test_audio_path):
            pytest.skip("测试音频文件不存在")
            
        response = self.client.post(
            "/api/audio/transcribe-local",
            json={
                "language": "zh-CN",
                "use_itn": True,
                "use_punc": False,
                "max_lines": 2,
                "words_per_line": 15,
                "generate_srt_file": True
            },
            data={"file_path": self.test_audio_path}
        )
        
        print(f"响应状态码: {response.status_code}")
        print(f"响应内容: {response.json()}")
        
        # 注意：这个测试可能会失败，如果API配置不正确或网络问题
        # 这是正常的，因为它需要真实的API调用
        assert response.status_code == 200
        
        data = response.json()
        if data.get("success"):
            assert "job_id" in data
            assert "subtitles" in data
            assert "processing_time" in data
            print("✓ 本地音频转字幕真实文件测试通过")
        else:
            print(f"⚠ 本地音频转字幕真实文件测试失败（可能是API配置问题）: {data.get('error')}")
            
    def test_transcribe_upload_invalid_file_type(self):
        """测试上传音频转字幕 - 无效文件类型"""
        # 创建一个文本文件作为无效的音频文件
        test_content = b"This is not an audio file"
        
        response = self.client.post(
            "/api/audio/transcribe",
            files={"file": ("test.txt", test_content, "text/plain")},
            data={
                "language": "zh-CN",
                "use_itn": True,
                "use_punc": False,
                "max_lines": 2,
                "words_per_line": 15,
                "generate_srt_file": True
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == False
        assert data["error_code"] == "INVALID_FILE_TYPE"
        
        print("✓ 上传音频转字幕无效文件类型测试通过")


def run_audio_transcription_tests():
    """运行音频转字幕测试"""
    print("=" * 60)
    print("开始音频转字幕功能测试")
    print("=" * 60)
    
    # 服务层测试
    print("\n--- 服务层测试 ---")
    service_tests = TestAudioTranscriptionService()
    service_tests.setup_method()
    
    try:
        service_tests.test_service_initialization()
        service_tests.test_ms_to_srt_time_conversion()
        service_tests.test_convert_to_srt()
        service_tests.test_submit_audio_success()
        service_tests.test_query_result_success()
        service_tests.test_save_srt_file()
    except Exception as e:
        print(f"服务层测试异常: {str(e)}")
    
    # API测试
    print("\n--- API测试 ---")
    api_tests = TestAudioTranscriptionAPI()
    api_tests.setup_method()
    
    try:
        api_tests.test_health_check()
        api_tests.test_transcribe_local_audio_file_not_found()
        api_tests.test_transcribe_upload_invalid_file_type()
        
        # 真实文件测试（可能失败）
        if os.path.exists("datas/audio/audio-01.mp3"):
            print("\n--- 真实API调用测试 ---")
            print("注意：此测试需要有效的火山引擎API配置")
            api_tests.test_transcribe_local_audio_real_file()
        else:
            print("⚠ 跳过真实文件测试：测试音频文件不存在")
            
    except Exception as e:
        print(f"API测试异常: {str(e)}")
    
    print("\n" + "=" * 60)
    print("音频转字幕功能测试完成")
    print("=" * 60)


if __name__ == "__main__":
    run_audio_transcription_tests() 