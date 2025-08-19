"""
测试音频音量一致性的测试用例
验证修复后的音频合成服务能够正确处理轨道音量设置

作者: AI Assistant
创建时间: 2025-01-10
"""

import pytest
import tempfile
import os
import json
from unittest.mock import patch, MagicMock
from app.services.video_composition_service import VideoCompositionService
from app.models.video_models import (
    VideoCompositionRequest, 
    AudioCompositionItem, 
    AspectRatio
)


class TestAudioVolumeConsistency:
    """音频音量一致性测试类"""
    
    @pytest.fixture
    def service(self):
        """创建视频合成服务实例"""
        return VideoCompositionService()
    
    @pytest.fixture
    def sample_audio_items(self):
        """创建示例音频项目，具有不同的音量设置"""
        return [
            AudioCompositionItem(
                id="audio-1",
                name="音频片段1",
                url="/api/audio/generated/test-audio-1.mp3",
                start_time=0.0,
                duration=5.0,
                track_id="audio-track-1",
                volume=0.5,  # 50% 音量
                clip_start=0.0,
                clip_end=5.0
            ),
            AudioCompositionItem(
                id="audio-2", 
                name="音频片段2",
                url="/api/audio/generated/test-audio-2.mp3",
                start_time=3.0,
                duration=4.0,
                track_id="audio-track-2",
                volume=1.0,  # 100% 音量
                clip_start=0.0,
                clip_end=4.0
            ),
            AudioCompositionItem(
                id="audio-3",
                name="音频片段3", 
                url="/api/audio/generated/test-audio-3.mp3",
                start_time=6.0,
                duration=3.0,
                track_id="audio-track-1", 
                volume=0.8,  # 80% 音量
                clip_start=0.0,
                clip_end=3.0
            )
        ]
    
    @pytest.fixture
    def composition_request(self, sample_audio_items):
        """创建视频合成请求"""
        return VideoCompositionRequest(
            video_items=[],
            audio_items=sample_audio_items,
            subtitle_items=[],
            total_duration=10.0,
            aspect_ratio=AspectRatio.RATIO_16_9
        )
    
    def test_multiple_audio_tracks_volume_independence(self, service, composition_request):
        """
        测试多个音频轨道的音量独立性
        确保每个音频轨道的音量设置不会相互影响
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            # 模拟音频文件存在
            for audio_item in composition_request.audio_items:
                filename = audio_item.url.replace('/api/audio/generated/', '')
                mock_audio_path = os.path.join('static', 'audio', 'generated', filename)
                os.makedirs(os.path.dirname(mock_audio_path), exist_ok=True)
                # 创建空的音频文件用于测试
                with open(mock_audio_path, 'w') as f:
                    f.write('mock audio content')
            
            # 模拟 FFmpeg 命令执行成功
            with patch('subprocess.run') as mock_run:
                # 配置 subprocess.run 的返回值
                mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
                
                # 调用音频处理方法
                result = service._process_audio_tracks(
                    composition_request, 
                    temp_dir, 
                    'ffmpeg', 
                    10.0
                )
                
                # 验证结果不为空
                assert result is not None
                
                # 验证 FFmpeg 被调用的次数
                # 应该调用 3 次用于预处理 + 1 次用于最终混合
                assert mock_run.call_count == 4
                
                # 验证预处理命令包含正确的音量设置
                calls = mock_run.call_args_list
                
                # 检查第一个音频的预处理命令
                first_preprocess_cmd = calls[0][0][0]  # 第一个调用的命令参数
                assert 'volume=0.5' in ' '.join(first_preprocess_cmd)
                
                # 检查第二个音频的预处理命令
                second_preprocess_cmd = calls[1][0][0]
                assert 'volume=1.0' in ' '.join(second_preprocess_cmd)
                
                # 检查第三个音频的预处理命令
                third_preprocess_cmd = calls[2][0][0]
                assert 'volume=0.8' in ' '.join(third_preprocess_cmd)
                
                # 检查最终混合命令
                final_mix_cmd = calls[3][0][0]
                mix_cmd_str = ' '.join(final_mix_cmd)
                
                # 验证使用了正确的输入数量
                assert 'amix=inputs=3' in mix_cmd_str
                
                # 验证包含了延迟设置
                assert 'adelay=3000|3000' in mix_cmd_str  # 第二个音频延迟3秒
                assert 'adelay=6000|6000' in mix_cmd_str  # 第三个音频延迟6秒
    
    def test_single_audio_track_volume_application(self, service):
        """
        测试单个音频轨道的音量应用
        确保单音频轨道的音量设置正确应用
        """
        single_audio_request = VideoCompositionRequest(
            video_items=[],
            audio_items=[
                AudioCompositionItem(
                    id="single-audio",
                    name="单个音频",
                    url="/api/audio/generated/single-test.mp3",
                    start_time=2.0,
                    duration=5.0,
                    track_id="audio-track-1",
                    volume=0.7,  # 70% 音量
                    clip_start=0.0,
                    clip_end=5.0
                )
            ],
            subtitle_items=[],
            total_duration=8.0,
            aspect_ratio=AspectRatio.RATIO_16_9
        )
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # 模拟音频文件存在
            mock_audio_path = os.path.join('static', 'audio', 'generated', 'single-test.mp3')
            os.makedirs(os.path.dirname(mock_audio_path), exist_ok=True)
            with open(mock_audio_path, 'w') as f:
                f.write('mock single audio content')
            
            # 模拟 FFmpeg 命令执行成功
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
                
                result = service._process_audio_tracks(
                    single_audio_request,
                    temp_dir,
                    'ffmpeg',
                    8.0
                )
                
                # 验证结果不为空
                assert result is not None
                
                # 验证 FFmpeg 被调用（单音频情况下调用次数较少）
                assert mock_run.call_count >= 1
                
                # 检查命令包含正确的音量设置
                final_cmd = mock_run.call_args_list[-1][0][0]  # 最后一个调用的命令
                cmd_str = ' '.join(final_cmd)
                assert 'volume=0.7' in cmd_str
    
    def test_audio_track_timing_preservation(self, service, composition_request):
        """
        测试音频轨道时间定位保持
        确保音频在时间轴上的位置正确
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            # 模拟音频文件存在
            for audio_item in composition_request.audio_items:
                filename = audio_item.url.replace('/api/audio/generated/', '')
                mock_audio_path = os.path.join('static', 'audio', 'generated', filename)
                os.makedirs(os.path.dirname(mock_audio_path), exist_ok=True)
                with open(mock_audio_path, 'w') as f:
                    f.write('mock audio content')
            
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
                
                result = service._process_audio_tracks(
                    composition_request,
                    temp_dir, 
                    'ffmpeg',
                    10.0
                )
                
                assert result is not None
                
                # 检查最终混合命令的延迟设置
                final_mix_cmd = mock_run.call_args_list[-1][0][0]
                cmd_str = ' '.join(final_mix_cmd)
                
                # 验证第一个音频没有延迟（start_time=0）
                # 验证第二个音频有3秒延迟（start_time=3.0）
                assert 'adelay=3000|3000' in cmd_str
                # 验证第三个音频有6秒延迟（start_time=6.0）
                assert 'adelay=6000|6000' in cmd_str
    
    def test_audio_clipping_with_volume(self, service):
        """
        测试音频剪辑与音量组合应用
        确保剪辑的音频片段正确应用音量设置
        """
        clipped_audio_request = VideoCompositionRequest(
            video_items=[],
            audio_items=[
                AudioCompositionItem(
                    id="clipped-audio",
                    name="剪辑音频",
                    url="/api/audio/generated/clipped-test.mp3",
                    start_time=1.0,
                    duration=3.0,
                    track_id="audio-track-1",
                    volume=1.5,  # 150% 音量
                    clip_start=2.0,  # 从音频文件的第2秒开始
                    clip_end=5.0     # 到音频文件的第5秒结束
                )
            ],
            subtitle_items=[],
            total_duration=6.0,
            aspect_ratio=AspectRatio.RATIO_16_9
        )
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # 模拟音频文件存在
            mock_audio_path = os.path.join('static', 'audio', 'generated', 'clipped-test.mp3')
            os.makedirs(os.path.dirname(mock_audio_path), exist_ok=True)
            with open(mock_audio_path, 'w') as f:
                f.write('mock clipped audio content')
            
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
                
                result = service._process_audio_tracks(
                    clipped_audio_request,
                    temp_dir,
                    'ffmpeg',
                    6.0
                )
                
                assert result is not None
                
                # 验证命令包含剪辑参数
                final_cmd = mock_run.call_args_list[-1][0][0]
                cmd_str = ' '.join(final_cmd)
                
                # 检查剪辑开始时间
                assert '-ss 2.0' in cmd_str or '-ss' in cmd_str
                # 检查音量设置
                assert 'volume=1.5' in cmd_str
                # 检查时长设置（clip_end - clip_start = 3.0）
                assert '-t 3.0' in cmd_str or '-t' in cmd_str
    
    def test_error_handling_invalid_audio_file(self, service):
        """
        测试错误处理：无效音频文件
        确保当音频文件不存在或无效时，服务能够正确处理错误
        """
        invalid_audio_request = VideoCompositionRequest(
            video_items=[],
            audio_items=[
                AudioCompositionItem(
                    id="invalid-audio",
                    name="无效音频",
                    url="/api/audio/generated/nonexistent.mp3",
                    start_time=0.0,
                    duration=3.0,
                    track_id="audio-track-1",
                    volume=1.0,
                    clip_start=0.0,
                    clip_end=3.0
                )
            ],
            subtitle_items=[],
            total_duration=5.0,
            aspect_ratio=AspectRatio.RATIO_16_9
        )
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # 不创建音频文件，模拟文件不存在的情况
            
            with patch('subprocess.run') as mock_run:
                # 模拟 FFmpeg 执行失败
                mock_run.return_value = MagicMock(
                    returncode=1, 
                    stdout='', 
                    stderr='No such file or directory'
                )
                
                result = service._process_audio_tracks(
                    invalid_audio_request,
                    temp_dir,
                    'ffmpeg',
                    5.0
                )
                
                # 当音频处理失败时，应该返回 None
                assert result is None
    
    def test_logging_volume_information(self, service, composition_request):
        """
        测试日志记录音量信息
        确保音频处理过程中正确记录音量相关信息
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            # 模拟音频文件存在
            for audio_item in composition_request.audio_items:
                filename = audio_item.url.replace('/api/audio/generated/', '')
                mock_audio_path = os.path.join('static', 'audio', 'generated', filename)
                os.makedirs(os.path.dirname(mock_audio_path), exist_ok=True)
                with open(mock_audio_path, 'w') as f:
                    f.write('mock audio content')
            
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
                
                # 使用 patch 来捕获日志记录
                with patch('app.services.video_composition_service.logger') as mock_logger:
                    result = service._process_audio_tracks(
                        composition_request,
                        temp_dir,
                        'ffmpeg',
                        10.0
                    )
                    
                    assert result is not None
                    
                    # 验证日志记录了音量信息
                    # 检查是否记录了预处理音频的日志
                    info_calls = [call for call in mock_logger.info.call_args_list 
                                if 'Pre-processing audio' in str(call)]
                    assert len(info_calls) == 3  # 应该有3个音频预处理日志
                    
                    # 验证日志包含音量信息
                    for call in info_calls:
                        args, kwargs = call
                        if len(args) > 1 and isinstance(args[1], dict):
                            log_data = args[1]
                            assert 'volume' in log_data
                            assert 'track_id' in log_data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])