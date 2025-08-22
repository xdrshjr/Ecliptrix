"""
Test cases for subtitle font size fix
验证字幕字体大小修复的测试用例
"""

import pytest
from unittest.mock import Mock, patch
from app.models.video_models import SubtitleCompositionItem
from app.services.video_composition_service import VideoCompositionService


class TestSubtitleFontSizeFix:
    """字幕字体大小修复测试类"""
    
    def test_font_size_from_frontend_respected(self):
        """测试后端正确使用前端传递的字体大小"""
        # 创建字幕项目，设置用户自定义的字体大小
        subtitle_item = SubtitleCompositionItem(
            id="test_subtitle_1",
            name="测试字幕",
            text="这是一个测试字幕",
            start_time=0.0,
            duration=3.0,
            track_id="subtitle_track_1",
            font_family="default",
            font_size=36,  # 用户设置的字体大小
            font_color="#FFFFFF",
            background_color="#000000@0.5",
            position="bottom"
        )
        
        subtitle_items = [subtitle_item]
        
        # 创建视频合成服务的实例
        service = VideoCompositionService()
        
        # 模拟创建SRT文件
        with patch.object(service, '_create_srt_from_subtitle_items') as mock_create_srt:
            mock_create_srt.return_value = "/tmp/test.srt"
            
            # 模拟SubtitleService
            with patch('app.services.video_composition_service.SubtitleService') as mock_subtitle_service:
                mock_service_instance = Mock()
                mock_subtitle_service.return_value = mock_service_instance
                
                # 模拟add_subtitles方法返回成功结果
                mock_result = Mock()
                mock_result.success = True
                mock_result.output_video_path = "/tmp/output.mp4"
                mock_result.subtitle_count = 1
                mock_result.processing_time = 1.0
                mock_result.video_width = 1920
                mock_result.video_height = 1080
                mock_result.file_size = 1024000
                
                async def mock_add_subtitles(request):
                    # 验证传递给SubtitleService的字体大小
                    assert request.font_size == 36, f"Expected font_size=36, got {request.font_size}"
                    return mock_result
                
                mock_service_instance.add_subtitles = mock_add_subtitles
                
                # 执行字幕处理
                result = service._process_subtitle_tracks(
                    subtitle_items=subtitle_items,
                    video_path="/tmp/input.mp4",
                    temp_dir="/tmp"
                )
                
                # 验证结果
                assert result == "/tmp/output.mp4"
    
    def test_default_font_size_when_not_specified(self):
        """测试当未指定字体大小时使用正确的默认值"""
        # 创建字幕项目，不设置字体大小
        subtitle_item = SubtitleCompositionItem(
            id="test_subtitle_2",
            name="测试字幕",
            text="这是一个测试字幕",
            start_time=0.0,
            duration=3.0,
            track_id="subtitle_track_1",
            font_family="default",
            # 不设置font_size，测试默认值
            font_color="#FFFFFF",
            position="bottom"
        )
        
        subtitle_items = [subtitle_item]
        
        # 创建视频合成服务的实例
        service = VideoCompositionService()
        
        # 模拟创建SRT文件
        with patch.object(service, '_create_srt_from_subtitle_items') as mock_create_srt:
            mock_create_srt.return_value = "/tmp/test.srt"
            
            # 模拟SubtitleService
            with patch('app.services.video_composition_service.SubtitleService') as mock_subtitle_service:
                mock_service_instance = Mock()
                mock_subtitle_service.return_value = mock_service_instance
                
                # 模拟add_subtitles方法返回成功结果
                mock_result = Mock()
                mock_result.success = True
                mock_result.output_video_path = "/tmp/output.mp4"
                mock_result.subtitle_count = 1
                mock_result.processing_time = 1.0
                mock_result.video_width = 1920
                mock_result.video_height = 1080
                mock_result.file_size = 1024000
                
                async def mock_add_subtitles(request):
                    # 验证传递给SubtitleService的字体大小为默认值24
                    assert request.font_size == 24, f"Expected default font_size=24, got {request.font_size}"
                    return mock_result
                
                mock_service_instance.add_subtitles = mock_add_subtitles
                
                # 执行字幕处理
                result = service._process_subtitle_tracks(
                    subtitle_items=subtitle_items,
                    video_path="/tmp/input.mp4",
                    temp_dir="/tmp"
                )
                
                # 验证结果
                assert result == "/tmp/output.mp4"
    
    def test_various_font_sizes(self):
        """测试各种字体大小的正确传递"""
        test_font_sizes = [8, 12, 16, 24, 32, 48, 60, 72]
        
        for font_size in test_font_sizes:
            subtitle_item = SubtitleCompositionItem(
                id=f"test_subtitle_{font_size}",
                name="测试字幕",
                text="这是一个测试字幕",
                start_time=0.0,
                duration=3.0,
                track_id="subtitle_track_1",
                font_family="default",
                font_size=font_size,
                font_color="#FFFFFF",
                position="bottom"
            )
            
            subtitle_items = [subtitle_item]
            
            # 创建视频合成服务的实例
            service = VideoCompositionService()
            
            # 模拟创建SRT文件
            with patch.object(service, '_create_srt_from_subtitle_items') as mock_create_srt:
                mock_create_srt.return_value = "/tmp/test.srt"
                
                # 模拟SubtitleService
                with patch('app.services.video_composition_service.SubtitleService') as mock_subtitle_service:
                    mock_service_instance = Mock()
                    mock_subtitle_service.return_value = mock_service_instance
                    
                    # 模拟add_subtitles方法返回成功结果
                    mock_result = Mock()
                    mock_result.success = True
                    mock_result.output_video_path = "/tmp/output.mp4"
                    mock_result.subtitle_count = 1
                    mock_result.processing_time = 1.0
                    mock_result.video_width = 1920
                    mock_result.video_height = 1080
                    mock_result.file_size = 1024000
                    
                    async def mock_add_subtitles(request):
                        # 验证传递给SubtitleService的字体大小与设置的一致
                        assert request.font_size == font_size, f"Expected font_size={font_size}, got {request.font_size}"
                        return mock_result
                    
                    mock_service_instance.add_subtitles = mock_add_subtitles
                    
                    # 执行字幕处理
                    result = service._process_subtitle_tracks(
                        subtitle_items=subtitle_items,
                        video_path="/tmp/input.mp4",
                        temp_dir="/tmp"
                    )
                    
                    # 验证结果
                    assert result == "/tmp/output.mp4"


if __name__ == "__main__":
    pytest.main([__file__]) 
 