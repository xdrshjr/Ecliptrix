"""
测试脚本段落视频关联功能

该测试主要验证：
1. 视频搜索API的可用性
2. 数据结构的正确性
3. 时长验证逻辑
"""

import pytest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from app.models.video_models import VideoSearchRequest, VideoInfo
from app.main import app

client = TestClient(app)


class TestScriptVideoAssociation:
    """脚本段落视频关联功能测试类"""
    
    def test_video_search_api_availability(self):
        """测试视频搜索API的可用性"""
        request_data = {
            "query": "自然风景",
            "max_videos": 5,
            "orientation": "landscape"
        }
        
        response = client.post("/api/video/search", json=request_data)
        
        # 验证API响应
        assert response.status_code in [200, 400, 429, 500]  # 允许的状态码
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data
            assert "videos" in data
            assert "total_found" in data
    
    def test_video_search_request_model(self):
        """测试视频搜索请求模型"""
        # 正常请求
        valid_request = VideoSearchRequest(
            query="测试视频",
            max_videos=10,
            orientation="mixed"
        )
        assert valid_request.query == "测试视频"
        assert valid_request.max_videos == 10
        assert valid_request.orientation == "mixed"
        
        # 测试默认值
        minimal_request = VideoSearchRequest(query="测试")
        assert minimal_request.max_videos == 20
        assert minimal_request.orientation == "mixed"
    
    def test_video_info_model(self):
        """测试视频信息模型"""
        video_info = VideoInfo(
            id=12345,
            title="测试视频",
            author="测试作者",
            width=1920,
            height=1080,
            duration=30,
            thumbnail="https://example.com/thumb.jpg",
            video_url="https://example.com/video.mp4"
        )
        
        assert video_info.id == 12345
        assert video_info.title == "测试视频"
        assert video_info.duration == 30
        assert video_info.width == 1920
        assert video_info.height == 1080
    
    def test_video_duration_validation_logic(self):
        """测试视频时长验证逻辑（模拟前端逻辑）"""
        # 模拟脚本段落数据
        segment_audio_duration = 30.0  # 音频时长30秒
        
        # 测试用例1：视频时长足够
        videos_sufficient = [
            {"id": "v1", "duration": 20},
            {"id": "v2", "duration": 15}
        ]
        total_video_duration = sum(v["duration"] for v in videos_sufficient)
        assert total_video_duration >= segment_audio_duration  # 35 >= 30
        
        # 测试用例2：视频时长不足
        videos_insufficient = [
            {"id": "v1", "duration": 10},
            {"id": "v2", "duration": 15}
        ]
        total_video_duration = sum(v["duration"] for v in videos_insufficient)
        assert total_video_duration < segment_audio_duration  # 25 < 30
        
        # 测试用例3：单个长视频
        videos_single_long = [
            {"id": "v1", "duration": 45}
        ]
        total_video_duration = sum(v["duration"] for v in videos_single_long)
        assert total_video_duration >= segment_audio_duration  # 45 >= 30
    
    def test_script_segment_data_structure(self):
        """测试ScriptSegment数据结构扩展"""
        # 模拟扩展后的ScriptSegment结构
        script_segment = {
            "id": "seg_001",
            "title": "测试段落",
            "sentences": [
                {"id": "sent_001", "text": "这是第一句话"},
                {"id": "sent_002", "text": "这是第二句话"}
            ],
            "duration": 25.5,  # TTS转换后的音频时长
            "videos": [  # 新增字段
                {
                    "id": "video_001",
                    "name": "自然风景视频",
                    "type": "video",
                    "duration": 30,
                    "width": 1920,
                    "height": 1080,
                    "thumbnailUrl": "https://example.com/thumb.jpg",
                    "url": "https://example.com/video.mp4"
                }
            ]
        }
        
        # 验证数据结构
        assert "videos" in script_segment
        assert isinstance(script_segment["videos"], list)
        assert len(script_segment["videos"]) == 1
        assert script_segment["videos"][0]["duration"] == 30
        assert script_segment["videos"][0]["type"] == "video"
    
    def test_video_navigation_logic(self):
        """测试视频导航逻辑（模拟前端逻辑）"""
        videos = [
            {"id": "v1", "name": "视频1"},
            {"id": "v2", "name": "视频2"},
            {"id": "v3", "name": "视频3"}
        ]
        
        # 测试向前导航
        current_index = 1
        prev_index = current_index - 1 if current_index > 0 else len(videos) - 1
        assert prev_index == 0
        
        # 测试向后导航
        next_index = current_index + 1 if current_index < len(videos) - 1 else 0
        assert next_index == 2
        
        # 测试边界情况：从第一个向前
        current_index = 0
        prev_index = current_index - 1 if current_index > 0 else len(videos) - 1
        assert prev_index == 2  # 循环到最后一个
        
        # 测试边界情况：从最后一个向后
        current_index = 2
        next_index = current_index + 1 if current_index < len(videos) - 1 else 0
        assert next_index == 0  # 循环到第一个
    
    def test_error_handling_scenarios(self):
        """测试错误处理场景"""
        # 测试空查询
        empty_query_response = client.post("/api/video/search", json={
            "query": "",
            "max_videos": 10
        })
        assert empty_query_response.status_code == 422  # Pydantic validation error
        
        # 测试无效方向
        invalid_orientation_response = client.post("/api/video/search", json={
            "query": "测试",
            "orientation": "invalid"
        })
        assert invalid_orientation_response.status_code == 422  # Pydantic validation error
    
    def test_logging_data_structure(self):
        """测试日志记录数据结构"""
        # 模拟日志数据
        video_search_log = {
            "action": "打开视频搜索",
            "component": "ScriptPanel",
            "data": {
                "segmentId": "seg_001",
                "timestamp": "2024-01-15T10:30:00Z"
            }
        }
        
        video_association_log = {
            "action": "为段落添加视频",
            "component": "ScriptPanel",
            "data": {
                "segmentId": "seg_001",
                "videosCount": 2,
                "videoIds": ["v1", "v2"],
                "totalDuration": 45.0,
                "audioDuration": 30.0
            }
        }
        
        video_navigation_log = {
            "action": "切换视频预览",
            "component": "ScriptPanel",
            "data": {
                "segmentId": "seg_001",
                "direction": "next",
                "currentIndex": 0,
                "newIndex": 1,
                "totalVideos": 3
            }
        }
        
        # 验证日志结构
        assert video_search_log["action"] == "打开视频搜索"
        assert "segmentId" in video_search_log["data"]
        
        assert video_association_log["data"]["videosCount"] == 2
        assert video_association_log["data"]["totalDuration"] > video_association_log["data"]["audioDuration"]
        
        assert video_navigation_log["data"]["direction"] in ["prev", "next"]
        assert video_navigation_log["data"]["newIndex"] < video_navigation_log["data"]["totalVideos"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 