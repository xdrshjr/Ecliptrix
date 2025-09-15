"""
Test video understanding script generation with frontend analysis data.
"""

import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.video_understanding_script_service import VideoUnderstandingScriptService
from app.models.video_understanding_script_models import (
    VideoUnderstandingScriptRequest,
    VideoItem,
    ScriptGenerationParameters
)


class TestVideoUnderstandingScriptWithFrontendAnalysis:
    """Test cases for VideoUnderstandingScriptService with frontend analysis data."""

    @pytest.fixture
    def mock_video_with_frontend_analysis(self):
        """Create a mock video with frontend analysis data."""
        return VideoItem(
            id="video_001",
            name="测试视频",
            type="video",
            url="https://example.com/video.mp4",
            duration=30.0,
            analysisData={
                "success": True,
                "video_url": "https://example.com/video.mp4",
                "total_frames_extracted": 5,
                "video_duration": 30.0,
                "frame_analyses": [
                    {
                        "frame_number": 0,
                        "timestamp": 0.0,
                        "analysis": "画面显示一个阳光明媚的公园场景，有绿色的草地和蓝天白云，整体氛围非常舒适宜人。"
                    },
                    {
                        "frame_number": 1,
                        "timestamp": 6.0,
                        "analysis": "场景切换到室内，一位女性正在厨房准备食物，动作熟练，表情专注。"
                    },
                    {
                        "frame_number": 2,
                        "timestamp": 12.0,
                        "analysis": "镜头聚焦在精美的食物上，色彩丰富，摆盘精致，让人食欲大增。"
                    }
                ],
                "processing_time": 8.5,
                "timestamp": "2024-01-15T10:30:00Z",
                "message": "Successfully analyzed 5 frames"
            }
        )

    @pytest.fixture
    def mock_request_with_frontend_analysis(self, mock_video_with_frontend_analysis):
        """Create a mock request with frontend analysis data."""
        return VideoUnderstandingScriptRequest(
            taskId="test_task_frontend_analysis",
            selectedVideos=[mock_video_with_frontend_analysis],
            referenceText="请生成关于美食制作的脚本，突出食材的新鲜和制作工艺的精细。",
            parameters=ScriptGenerationParameters(
                language="chinese",
                segmentCount=2,
                analysisDepth="detailed",
                includeVisualElements=True,
                includeAudioAnalysis=True
            )
        )

    def test_convert_frontend_analysis_to_result(self, mock_video_with_frontend_analysis):
        """Test converting frontend analysis data to VideoAnalysisResult."""
        service = VideoUnderstandingScriptService()
        parameters = ScriptGenerationParameters()
        
        result = service._convert_frontend_analysis_to_result(
            mock_video_with_frontend_analysis,
            mock_video_with_frontend_analysis.analysisData,
            parameters
        )
        
        # Verify basic properties
        assert result.videoId == "video_001"
        assert result.videoName == "测试视频"
        assert result.estimatedDuration == 30.0
        
        # Verify content description was generated
        assert result.contentDescription != ""
        assert "公园" in result.contentDescription or "厨房" in result.contentDescription
        
        # Verify visual elements were extracted
        assert len(result.visualElements) > 0
        
        # Verify key topics were extracted
        assert len(result.keyTopics) > 0
        
        # Verify frames data
        assert result.frames is not None
        assert len(result.frames) <= 5  # Should limit to first 5 frames
        
        # Verify frame analysis truncation
        for frame in result.frames:
            assert len(frame["analysis"]) <= 200

    @patch('httpx.AsyncClient')
    async def test_generate_script_with_frontend_analysis(
        self, 
        mock_httpx_client,
        mock_request_with_frontend_analysis
    ):
        """Test script generation using frontend analysis data."""
        # Mock LLM response
        mock_llm_response = {
            "choices": [{
                "message": {
                    "content": json.dumps([
                        {
                            "id": "segment-1",
                            "title": "美食制作开场",
                            "sentences": [
                                {"id": "s1", "text": "在这个阳光明媚的日子里，我们来到了美丽的公园。"},
                                {"id": "s2", "text": "接下来让我们走进厨房，开始今天的美食制作之旅。"}
                            ],
                            "video_ids": ["video_001"],
                            "keywords": ["美食制作", "厨房", "公园", "阳光"]
                        },
                        {
                            "id": "segment-2",
                            "title": "精美食物展示",
                            "sentences": [
                                {"id": "s3", "text": "经过精心制作，这道美食终于完成了。"},
                                {"id": "s4", "text": "色彩丰富的摆盘展现了制作工艺的精细。"}
                            ],
                            "video_ids": ["video_001"],
                            "keywords": ["精美食物", "摆盘", "工艺", "色彩"]
                        }
                    ])
                }
            }]
        }
        
        # Setup mock client
        mock_response = MagicMock()
        mock_response.json.return_value = mock_llm_response
        mock_response.raise_for_status.return_value = None
        
        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response
        mock_httpx_client.return_value.__aenter__.return_value = mock_client_instance
        
        # Create service instance
        service = VideoUnderstandingScriptService()
        
        # Generate script
        result = await service.generate_script(mock_request_with_frontend_analysis)
        
        # Verify result structure
        assert "segments" in result
        assert "metadata" in result
        
        segments = result["segments"]
        metadata = result["metadata"]
        
        # Verify segments
        assert len(segments) == 2
        
        # Verify first segment
        first_segment = segments[0]
        assert first_segment.title == "美食制作开场"
        assert len(first_segment.sentences) == 2
        assert len(first_segment.videos) == 1
        assert first_segment.videos[0].id == "video_001"
        assert "美食制作" in first_segment.keywords
        
        # Verify second segment
        second_segment = segments[1]
        assert second_segment.title == "精美食物展示"
        assert len(second_segment.sentences) == 2
        assert "精美食物" in second_segment.keywords
        
        # Verify metadata
        assert metadata["processedVideoCount"] == 1
        assert metadata["generatedSegmentCount"] == 2
        assert metadata["videoAnalysisResultsCount"] == 1
        assert metadata["language"] == "chinese"
        assert metadata["analysisDepth"] == "detailed"
        
        # Verify LLM was called with frontend analysis data
        mock_client_instance.post.assert_called_once()
        call_args = mock_client_instance.post.call_args
        
        # Verify the request contains frontend analysis information
        request_body = call_args[1]["json"]
        assert "messages" in request_body
        user_message = request_body["messages"][1]["content"]
        
        # Should contain analysis information from frontend
        assert "公园" in user_message or "厨房" in user_message
        assert "阳光明媚" in user_message or "食物" in user_message

    def test_frontend_analysis_priority_over_storage(self):
        """Test that frontend analysis data takes priority over storage data."""
        service = VideoUnderstandingScriptService()
        
        # Create video with frontend analysis
        video_with_frontend = VideoItem(
            id="video_priority_test",
            name="优先级测试视频",
            type="video",
            url="https://example.com/priority_test.mp4",
            duration=25.0,
            analysisData={
                "success": True,
                "video_url": "https://example.com/priority_test.mp4",
                "total_frames_extracted": 3,
                "video_duration": 25.0,
                "frame_analyses": [
                    {
                        "frame_number": 0,
                        "timestamp": 0.0,
                        "analysis": "这是来自前端的分析数据，应该被优先使用。"
                    }
                ]
            }
        )
        
        parameters = ScriptGenerationParameters()
        
        # Convert using frontend analysis
        result = service._convert_frontend_analysis_to_result(
            video_with_frontend,
            video_with_frontend.analysisData,
            parameters
        )
        
        # Verify it used frontend analysis
        assert result.videoId == "video_priority_test"
        assert result.estimatedDuration == 25.0
        assert "前端的分析数据" in result.contentDescription

    def test_fallback_when_no_frontend_analysis(self):
        """Test fallback behavior when no frontend analysis data is provided."""
        service = VideoUnderstandingScriptService()
        
        # Create video without frontend analysis
        video_without_frontend = VideoItem(
            id="video_no_frontend",
            name="无前端分析视频",
            type="video",
            url="https://example.com/no_frontend.mp4",
            duration=20.0
            # No analysisData field
        )
        
        parameters = ScriptGenerationParameters()
        
        # Should perform basic analysis when no frontend data
        result = service._perform_basic_video_analysis(video_without_frontend, parameters)
        
        # Verify basic analysis result
        assert result.videoId == "video_no_frontend"
        assert result.videoName == "无前端分析视频"
        assert result.estimatedDuration == 20.0
        assert len(result.keyTopics) > 0  # Should have default topics
        assert result.contentDescription != ""  # Should have default description 