"""
Test video understanding script generation functionality.
"""

import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.video_understanding_script_service import VideoUnderstandingScriptService
from app.models.video_understanding_script_models import (
    VideoUnderstandingScriptRequest,
    VideoItem,
    ScriptGenerationParameters,
    VideoAnalysisResult
)


class TestVideoUnderstandingScriptService:
    """Test cases for VideoUnderstandingScriptService."""

    def test_create_script_example_single_video(self):
        """Test script example creation for single video."""
        service = VideoUnderstandingScriptService()
        parameters = ScriptGenerationParameters(segmentCount=1)
        
        example = service._create_script_example(parameters)
        parsed_example = json.loads(example)
        
        assert "segments" in parsed_example
        assert len(parsed_example["segments"]) == 1
        assert "video_ids" in parsed_example["segments"][0]
        assert isinstance(parsed_example["segments"][0]["video_ids"], list)
        assert len(parsed_example["segments"][0]["video_ids"]) == 1

    def test_create_script_example_multiple_videos(self):
        """Test script example creation for multiple videos with multi-video association."""
        service = VideoUnderstandingScriptService()
        parameters = ScriptGenerationParameters(segmentCount=3)
        
        example = service._create_script_example(parameters)
        parsed_example = json.loads(example)
        
        assert "segments" in parsed_example
        assert len(parsed_example["segments"]) == 3
        
        # Check that the third segment has multiple video associations
        third_segment = parsed_example["segments"][2]
        assert "video_ids" in third_segment
        assert len(third_segment["video_ids"]) == 2  # Multi-video association example
        assert third_segment["title"] == "综合内容展示"

    def test_fallback_script_segments_single_video_per_segment(self):
        """Test fallback script generation with single video per segment."""
        service = VideoUnderstandingScriptService()
        
        # Mock analysis results
        analysis_results = [
            VideoAnalysisResult(
                videoId="video_001",
                videoName="测试视频1",
                keyTopics=["主题1", "主题2"],
                contentDescription="测试描述1",
                estimatedDuration=30.0
            ),
            VideoAnalysisResult(
                videoId="video_002", 
                videoName="测试视频2",
                keyTopics=["主题3", "主题4"],
                contentDescription="测试描述2",
                estimatedDuration=25.0
            )
        ]
        
        parameters = ScriptGenerationParameters(segmentCount=2)
        task_id = "test_task"
        
        segments = service._create_fallback_script_segments(
            analysis_results, parameters, task_id
        )
        
        assert len(segments) == 2
        
        # First segment should have one video
        assert len(segments[0].videos) == 1
        assert segments[0].videos[0].id == "video_001"
        assert segments[0].duration == 30.0
        
        # Second segment should have one video
        assert len(segments[1].videos) == 1
        assert segments[1].videos[0].id == "video_002"
        assert segments[1].duration == 25.0

    def test_fallback_script_segments_multiple_videos_per_segment(self):
        """Test fallback script generation with multiple videos per segment."""
        service = VideoUnderstandingScriptService()
        
        # Mock analysis results - 4 videos, 2 segments
        analysis_results = [
            VideoAnalysisResult(
                videoId=f"video_{i:03d}",
                videoName=f"测试视频{i}",
                keyTopics=[f"主题{i}A", f"主题{i}B"],
                contentDescription=f"测试描述{i}",
                estimatedDuration=10.0 + i
            ) for i in range(1, 5)
        ]
        
        parameters = ScriptGenerationParameters(segmentCount=2)
        task_id = "test_task"
        
        segments = service._create_fallback_script_segments(
            analysis_results, parameters, task_id
        )
        
        assert len(segments) == 2
        
        # First segment should have 2 videos (videos 1-2)
        assert len(segments[0].videos) == 2
        assert segments[0].videos[0].id == "video_001"
        assert segments[0].videos[1].id == "video_002"
        assert segments[0].duration == 23.0  # (10.0+1) + (10.0+2) = 11.0 + 12.0 = 23.0
        assert "综合内容展示" in segments[0].title
        
        # Second segment should have 2 videos (videos 3-4)
        assert len(segments[1].videos) == 2
        assert segments[1].videos[0].id == "video_003"
        assert segments[1].videos[1].id == "video_004"
        assert segments[1].duration == 27.0  # (10.0+3) + (10.0+4) = 13.0 + 14.0 = 27.0

    def test_parse_generated_script_with_video_ids(self):
        """Test parsing LLM generated script with video_ids format."""
        service = VideoUnderstandingScriptService()
        
        # Mock analysis results
        analysis_results = [
            VideoAnalysisResult(
                videoId="video_001",
                videoName="测试视频1",
                estimatedDuration=30.0
            ),
            VideoAnalysisResult(
                videoId="video_002",
                videoName="测试视频2", 
                estimatedDuration=25.0
            )
        ]
        
        # Mock LLM response with multiple video associations
        generated_content = """{
            "segments": [
                {
                    "title": "综合分析",
                    "sentences": [
                        "这些视频展现了丰富的内容。",
                        "通过对比分析可以看出不同的特点。"
                    ],
                    "video_ids": ["video_001", "video_002"],
                    "keywords": ["综合", "分析", "对比"]
                }
            ]
        }"""
        
        parameters = ScriptGenerationParameters()
        task_id = "test_task"
        
        segments = service._parse_generated_script(
            generated_content, analysis_results, parameters, task_id, None
        )
        
        assert len(segments) == 1
        segment = segments[0]
        
        # Should have both videos associated
        assert len(segment.videos) == 2
        assert segment.videos[0].id == "video_001"
        assert segment.videos[1].id == "video_002"
        assert segment.title == "综合分析"
        assert len(segment.sentences) == 2

    def test_parse_generated_script_backward_compatibility(self):
        """Test parsing LLM generated script with old video_id format."""
        service = VideoUnderstandingScriptService()
        
        # Mock analysis results
        analysis_results = [
            VideoAnalysisResult(
                videoId="video_001",
                videoName="测试视频1",
                estimatedDuration=30.0
            )
        ]
        
        # Mock LLM response with old single video_id format
        generated_content = """{
            "segments": [
                {
                    "title": "单视频分析",
                    "sentences": [
                        "这个视频展现了精彩内容。"
                    ],
                    "video_id": "video_001",
                    "keywords": ["内容", "分析"]
                }
            ]
        }"""
        
        parameters = ScriptGenerationParameters()
        task_id = "test_task"
        
        segments = service._parse_generated_script(
            generated_content, analysis_results, parameters, task_id, None
        )
        
        assert len(segments) == 1
        segment = segments[0]
        
        # Should still work with old format
        assert len(segment.videos) == 1
        assert segment.videos[0].id == "video_001"
        assert segment.title == "单视频分析"

    @pytest.mark.asyncio
    async def test_generate_script_integration(self):
        """Integration test for script generation with mocked LLM."""
        service = VideoUnderstandingScriptService()
        
        # Mock the LLM API call
        mock_response_data = {
            "choices": [{
                "message": {
                    "content": """{
                        "segments": [
                            {
                                "title": "多视频综合分析",
                                "sentences": [
                                    "这些视频共同展现了完整的故事。",
                                    "不同角度的呈现形成了良好的互补。"
                                ],
                                "video_ids": ["video_001", "video_002"],
                                "keywords": ["综合", "分析", "互补"]
                            }
                        ]
                    }"""
                }
            }]
        }
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_response_data
            
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            
            # Create request
            request = VideoUnderstandingScriptRequest(
                taskId="test_task",
                selectedVideos=[
                    VideoItem(id="video_001", name="测试视频1", type="video", duration=30.0),
                    VideoItem(id="video_002", name="测试视频2", type="video", duration=25.0)
                ],
                referenceText="测试参考文本",
                parameters=ScriptGenerationParameters(segmentCount=1)
            )
            
            # Mock video analysis storage to return None (no existing analysis)
            with patch('app.services.video_understanding_script_service.video_analysis_storage') as mock_storage:
                mock_storage.get_video_analysis.return_value = None
                
                result = await service.generate_script(request)
                
                assert "segments" in result
                assert len(result["segments"]) == 1
                
                segment = result["segments"][0]
                assert segment["title"] == "多视频综合分析"
                assert len(segment["videos"]) == 2
                assert segment["videos"][0]["id"] == "video_001"
                assert segment["videos"][1]["id"] == "video_002"


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 