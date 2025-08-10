"""
测试视频合成时间线顺序功能
验证视频、音频、字幕项目按照时间线位置正确排序
"""

import pytest
from unittest.mock import Mock, patch
from app.services.video_composition_service import VideoCompositionService
from app.models.video_models import (
    VideoCompositionRequest,
    VideoCompositionItem,
    AudioCompositionItem,
    SubtitleCompositionItem
)


class TestVideoCompositionTimelineOrder:
    """测试视频合成时间线顺序功能"""
    
    def setup_method(self):
        """测试前设置"""
        self.service = VideoCompositionService()
    
    @pytest.fixture
    def sample_video_items_unordered(self):
        """创建未排序的示例视频项目"""
        return [
            VideoCompositionItem(
                id="video_3",
                name="第三个视频",
                url="http://example.com/video3.mp4",
                start_time=10.0,
                duration=5.0,
                track_id="video_track_1",
                clip_end=5.0
            ),
            VideoCompositionItem(
                id="video_1", 
                name="第一个视频",
                url="http://example.com/video1.mp4",
                start_time=0.0,
                duration=5.0,
                track_id="video_track_1",
                clip_end=5.0
            ),
            VideoCompositionItem(
                id="video_2",
                name="第二个视频", 
                url="http://example.com/video2.mp4",
                start_time=5.0,
                duration=5.0,
                track_id="video_track_1",
                clip_end=5.0
            )
        ]
    
    @pytest.fixture
    def sample_audio_items_unordered(self):
        """创建未排序的示例音频项目"""
        return [
            AudioCompositionItem(
                id="audio_2",
                name="第二个音频",
                url="http://example.com/audio2.mp3",
                start_time=8.0,
                duration=4.0,
                track_id="audio_track_1",
                clip_end=4.0
            ),
            AudioCompositionItem(
                id="audio_1",
                name="第一个音频", 
                url="http://example.com/audio1.mp3",
                start_time=2.0,
                duration=3.0,
                track_id="audio_track_1",
                clip_end=3.0
            )
        ]
    
    @pytest.fixture
    def sample_subtitle_items_unordered(self):
        """创建未排序的示例字幕项目"""
        return [
            SubtitleCompositionItem(
                id="subtitle_2",
                name="第二条字幕",
                text="这是第二条字幕",
                start_time=6.0,
                duration=3.0,
                track_id="subtitle_track_1"
            ),
            SubtitleCompositionItem(
                id="subtitle_1",
                name="第一条字幕",
                text="这是第一条字幕", 
                start_time=1.0,
                duration=2.0,
                track_id="subtitle_track_1"
            )
        ]
    
    def test_video_items_sorting_by_start_time(self, sample_video_items_unordered):
        """测试视频项目按start_time正确排序"""
        # 创建合成请求
        request = VideoCompositionRequest(
            task_id="test_task_video_sorting",
            video_items=sample_video_items_unordered,
            audio_items=[],
            subtitle_items=[],
            total_duration=15.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        # Mock 外部依赖
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch.object(self.service, '_download_video'), \
             patch.object(self.service, '_normalize_video'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            # 验证排序前的顺序
            original_ids = [item.id for item in request.video_items]
            assert original_ids == ["video_3", "video_1", "video_2"]
            
            # 调用compose_video方法（会触发排序）
            try:
                self.service.compose_video(request)
            except Exception:
                # 忽略后续处理错误，我们只关心排序逻辑
                pass
            
            # 验证排序后的顺序
            sorted_ids = [item.id for item in request.video_items]
            expected_order = ["video_1", "video_2", "video_3"]  # 按start_time排序
            assert sorted_ids == expected_order
            
            # 验证start_time确实是递增的
            start_times = [item.start_time for item in request.video_items]
            assert start_times == sorted(start_times)
    
    def test_audio_items_sorting_by_start_time(self, sample_audio_items_unordered):
        """测试音频项目按start_time正确排序"""
        request = VideoCompositionRequest(
            task_id="test_task_audio_sorting",
            video_items=[],
            audio_items=sample_audio_items_unordered,
            subtitle_items=[],
            total_duration=12.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            # 验证排序前的顺序
            original_ids = [item.id for item in request.audio_items]
            assert original_ids == ["audio_2", "audio_1"]
            
            try:
                self.service.compose_video(request)
            except Exception:
                pass
            
            # 验证排序后的顺序
            sorted_ids = [item.id for item in request.audio_items]
            expected_order = ["audio_1", "audio_2"]  # 按start_time排序
            assert sorted_ids == expected_order
            
            # 验证start_time确实是递增的
            start_times = [item.start_time for item in request.audio_items]
            assert start_times == sorted(start_times)
    
    def test_subtitle_items_sorting_by_start_time(self, sample_subtitle_items_unordered):
        """测试字幕项目按start_time正确排序"""
        request = VideoCompositionRequest(
            task_id="test_task_subtitle_sorting",
            video_items=[],
            audio_items=[],
            subtitle_items=sample_subtitle_items_unordered,
            total_duration=9.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            # 验证排序前的顺序
            original_ids = [item.id for item in request.subtitle_items]
            assert original_ids == ["subtitle_2", "subtitle_1"]
            
            try:
                self.service.compose_video(request)
            except Exception:
                pass
            
            # 验证排序后的顺序
            sorted_ids = [item.id for item in request.subtitle_items]
            expected_order = ["subtitle_1", "subtitle_2"]  # 按start_time排序
            assert sorted_ids == expected_order
            
            # 验证start_time确实是递增的
            start_times = [item.start_time for item in request.subtitle_items]
            assert start_times == sorted(start_times)
    
    def test_mixed_items_sorting(self, sample_video_items_unordered, 
                                sample_audio_items_unordered, 
                                sample_subtitle_items_unordered):
        """测试混合项目（视频+音频+字幕）的排序"""
        request = VideoCompositionRequest(
            task_id="test_task_mixed_sorting",
            video_items=sample_video_items_unordered,
            audio_items=sample_audio_items_unordered,
            subtitle_items=sample_subtitle_items_unordered,
            total_duration=15.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch.object(self.service, '_download_video'), \
             patch.object(self.service, '_normalize_video'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            try:
                self.service.compose_video(request)
            except Exception:
                pass
            
            # 验证所有类型的项目都被正确排序
            video_start_times = [item.start_time for item in request.video_items]
            audio_start_times = [item.start_time for item in request.audio_items]
            subtitle_start_times = [item.start_time for item in request.subtitle_items]
            
            assert video_start_times == sorted(video_start_times)
            assert audio_start_times == sorted(audio_start_times)
            assert subtitle_start_times == sorted(subtitle_start_times)
            
            # 验证具体的排序结果
            assert [item.id for item in request.video_items] == ["video_1", "video_2", "video_3"]
            assert [item.id for item in request.audio_items] == ["audio_1", "audio_2"]
            assert [item.id for item in request.subtitle_items] == ["subtitle_1", "subtitle_2"]
    
    def test_already_sorted_items_remain_unchanged(self):
        """测试已经正确排序的项目保持不变"""
        # 创建已经按start_time排序的项目
        video_items = [
            VideoCompositionItem(
                id="video_1",
                name="第一个视频",
                url="http://example.com/video1.mp4",
                start_time=0.0,
                duration=5.0,
                track_id="video_track_1",
                clip_end=5.0
            ),
            VideoCompositionItem(
                id="video_2",
                name="第二个视频",
                url="http://example.com/video2.mp4", 
                start_time=5.0,
                duration=5.0,
                track_id="video_track_1",
                clip_end=5.0
            )
        ]
        
        request = VideoCompositionRequest(
            task_id="test_task_sorted",
            video_items=video_items,
            audio_items=[],
            subtitle_items=[],
            total_duration=10.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch.object(self.service, '_download_video'), \
             patch.object(self.service, '_normalize_video'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            original_order = [item.id for item in request.video_items]
            
            try:
                self.service.compose_video(request)
            except Exception:
                pass
            
            # 验证顺序没有改变
            final_order = [item.id for item in request.video_items]
            assert original_order == final_order
    
    def test_same_start_time_items_stability(self):
        """测试相同start_time项目的稳定性"""
        # 创建有相同start_time的项目
        video_items = [
            VideoCompositionItem(
                id="video_b",
                name="视频B",
                url="http://example.com/video_b.mp4",
                start_time=5.0,
                duration=3.0,
                track_id="video_track_1",
                clip_end=5.0
            ),
            VideoCompositionItem(
                id="video_a",
                name="视频A", 
                url="http://example.com/video_a.mp4",
                start_time=5.0,  # 相同的start_time
                duration=3.0,
                track_id="video_track_1",
                clip_end=5.0
            )
        ]
        
        request = VideoCompositionRequest(
            task_id="test_task_same_time",
            video_items=video_items,
            audio_items=[],
            subtitle_items=[],
            total_duration=8.0,
            output_resolution={"width": 1920, "height": 1080},
            output_fps=30,
            output_format="mp4"
        )
        
        with patch.object(self.service, '_check_ffmpeg', return_value=True), \
             patch.object(self.service, '_get_ffmpeg_path', return_value='ffmpeg'), \
             patch.object(self.service, '_download_video'), \
             patch.object(self.service, '_normalize_video'), \
             patch('subprocess.run'), \
             patch('os.makedirs'), \
             patch('shutil.rmtree'):
            
            try:
                self.service.compose_video(request)
            except Exception:
                pass
            
            # 验证排序后start_time仍然正确
            start_times = [item.start_time for item in request.video_items]
            assert start_times == sorted(start_times)
            
            # 对于相同start_time的项目，排序应该是稳定的
            # Python的sort是稳定排序，所以原始顺序应该保持
            final_ids = [item.id for item in request.video_items]
            # 由于都是5.0开始时间，应该保持原始顺序
            assert final_ids == ["video_b", "video_a"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 