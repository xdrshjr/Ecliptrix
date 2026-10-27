"""
Test suite for AI Mixed Editing with Video Analysis integration.
Tests the new functionality that integrates video analysis data into AI mixed editing.
"""

import pytest
import json
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime
from typing import List, Dict, Any

# Import the models and services to test
from app.models.ai_mixed_editing_models import (
    MaterialItemModel, 
    VideoAnalysisMetadata, 
    VideoFrameAnalysis,
    AIMixedEditingRequest
)
from app.services.ai_mixed_editing_service import AIMixedEditingService
from app.services.video_analysis_storage_service import VideoAnalysisStorageService
from app.models.video_analysis import VideoAnalysisResponse, FrameAnalysis


class TestVideoAnalysisStorageService:
    """Test video analysis storage service functionality."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.storage_service = VideoAnalysisStorageService()
        self.sample_frame_analyses = [
            FrameAnalysis(
                frame_number=0,
                timestamp=0.0,
                analysis="这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：\n\n1. 猫咪特征：橙色长毛，看起来很舒适",
                frame_path="/tmp/frame_0.jpg"
            ),
            FrameAnalysis(
                frame_number=1,
                timestamp=5.0,
                analysis="画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。猫咪的表情很放松，眼睛半闭着。",
                frame_path="/tmp/frame_1.jpg"
            )
        ]
        
        self.sample_analysis_response = VideoAnalysisResponse(
            success=True,
            video_url="https://example.com/test_video.mp4",
            total_frames_extracted=2,
            video_duration=10.0,
            frame_analyses=self.sample_frame_analyses,
            processing_time=15.5,
            timestamp=datetime.now(),
            message="Analysis completed successfully"
        )
    
    def test_store_and_retrieve_analysis_result(self):
        """Test storing and retrieving video analysis results."""
        # Test storing
        result = self.storage_service.store_analysis_result(self.sample_analysis_response)
        assert result is True
        
        # Test retrieving
        stored_data = self.storage_service.get_analysis_result(self.sample_analysis_response.video_url)
        assert stored_data is not None
        assert stored_data.video_url == self.sample_analysis_response.video_url
        assert stored_data.total_frames_extracted == 2
        assert stored_data.video_duration == 10.0
        assert len(stored_data.frame_analyses) == 2
        
        # Test frame analysis data
        assert stored_data.frame_analyses[0].frame_number == 0
        assert stored_data.frame_analyses[0].timestamp == 0.0
        assert "橙色的长毛猫" in stored_data.frame_analyses[0].analysis
        
        assert stored_data.frame_analyses[1].frame_number == 1
        assert stored_data.frame_analyses[1].timestamp == 5.0
        assert "伸懒腰" in stored_data.frame_analyses[1].analysis
    
    def test_has_analysis_result(self):
        """Test checking if analysis result exists."""
        # Initially should not exist
        assert self.storage_service.has_analysis_result(self.sample_analysis_response.video_url) is False
        
        # Store and check again
        self.storage_service.store_analysis_result(self.sample_analysis_response)
        assert self.storage_service.has_analysis_result(self.sample_analysis_response.video_url) is True
    
    def test_remove_analysis_result(self):
        """Test removing analysis results."""
        # Store first
        self.storage_service.store_analysis_result(self.sample_analysis_response)
        assert self.storage_service.has_analysis_result(self.sample_analysis_response.video_url) is True
        
        # Remove
        result = self.storage_service.remove_analysis_result(self.sample_analysis_response.video_url)
        assert result is True
        assert self.storage_service.has_analysis_result(self.sample_analysis_response.video_url) is False
        
        # Try to remove non-existent
        result = self.storage_service.remove_analysis_result("non-existent-url")
        assert result is False
    
    def test_clear_all_analysis_results(self):
        """Test clearing all analysis results."""
        # Store multiple results
        self.storage_service.store_analysis_result(self.sample_analysis_response)
        
        # Create another sample
        another_response = VideoAnalysisResponse(
            success=True,
            video_url="https://example.com/another_video.mp4",
            total_frames_extracted=1,
            video_duration=5.0,
            frame_analyses=[self.sample_frame_analyses[0]],
            processing_time=8.0,
            timestamp=datetime.now(),
            message="Analysis completed"
        )
        self.storage_service.store_analysis_result(another_response)
        
        # Clear all
        count = self.storage_service.clear_all_analysis_results()
        assert count == 2
        
        # Verify cleared
        assert self.storage_service.has_analysis_result(self.sample_analysis_response.video_url) is False
        assert self.storage_service.has_analysis_result(another_response.video_url) is False
    
    def test_get_cache_stats(self):
        """Test getting cache statistics."""
        # Initially empty
        stats = self.storage_service.get_cache_stats()
        assert stats["total_entries"] == 0
        assert stats["total_frames"] == 0
        
        # Store data
        self.storage_service.store_analysis_result(self.sample_analysis_response)
        
        # Check stats
        stats = self.storage_service.get_cache_stats()
        assert stats["total_entries"] == 1
        assert stats["total_frames"] == 2


class TestAIMixedEditingVideoAnalysisIntegration:
    """Test AI Mixed Editing service with video analysis integration."""
    
    def setup_method(self):
        """Set up test fixtures."""
        with patch('app.services.ai_mixed_editing_service.settings') as mock_settings:
            mock_settings.video_cut_llm_api_key = "test-api-key"
            mock_settings.video_cut_llm_api_url = "https://test-api.com"
            mock_settings.video_cut_llm_model = "test-model"
            mock_settings.debug = False
            
            self.service = AIMixedEditingService()
        
        # Sample materials
        self.video_material_with_analysis = MaterialItemModel(
            id="video_001",
            name="测试视频.mp4",
            type="video",
            format="mp4",
            size=1024000,
            duration=10.0,
            width=1920,
            height=1080,
            url="https://example.com/test_video.mp4",
            thumbnailUrl="https://example.com/thumb.jpg",
            description="测试视频",
            tags=["测试"],
            metadata={
                "video_analysis": {
                    "video_url": "https://example.com/test_video.mp4",
                    "total_frames_extracted": 2,
                    "video_duration": 10.0,
                    "frame_analyses": [
                        {
                            "frame_number": 0,
                            "timestamp": 0.0,
                            "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：猫咪特征：橙色长毛，看起来很舒适，正在享受阳光"
                        },
                        {
                            "frame_number": 1,
                            "timestamp": 5.0,
                            "analysis": "画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。猫咪的表情很放松，眼睛半闭着，看起来很惬意"
                        }
                    ],
                    "processing_time": 15.5,
                    "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                }
            },
            createdAt="2025-09-11T08:00:00.000Z"
        )
        
        self.video_material_without_analysis = MaterialItemModel(
            id="video_002",
            name="普通视频.mp4",
            type="video",
            format="mp4",
            size=2048000,
            duration=15.0,
            width=1920,
            height=1080,
            url="https://example.com/normal_video.mp4",
            description="普通视频",
            createdAt="2025-09-11T08:00:00.000Z"
        )
        
        self.audio_material = MaterialItemModel(
            id="audio_001",
            name="背景音乐.mp3",
            type="audio",
            format="mp3",
            size=512000,
            duration=20.0,
            url="https://example.com/audio.mp3",
            description="背景音乐",
            createdAt="2025-09-11T08:00:00.000Z"
        )
    
    def test_truncate_frame_analysis(self):
        """Test frame analysis truncation functionality."""
        # Test short analysis (no truncation)
        short_analysis = "这是一个短描述"
        result = self.service._truncate_frame_analysis(short_analysis)
        assert result == short_analysis
        
        # Test long analysis (should be truncated)
        long_analysis = "这是一个非常长的分析描述" * 20  # Create a long string
        result = self.service._truncate_frame_analysis(long_analysis, max_length=50)
        assert len(result) == 50
        assert result.endswith("...")
        assert result == long_analysis[:47] + "..."
        
        # Test exactly 200 characters (default max_length)
        analysis_200 = "x" * 200
        result = self.service._truncate_frame_analysis(analysis_200)
        assert result == analysis_200
        
        # Test 201 characters (should be truncated to 200)
        analysis_201 = "x" * 201
        result = self.service._truncate_frame_analysis(analysis_201)
        assert len(result) == 200
        assert result == "x" * 197 + "..."
    
    def test_extract_video_analysis_data_from_metadata(self):
        """Test extracting video analysis data from material metadata."""
        # Test with analysis data in metadata
        analysis_data = self.service._extract_video_analysis_data(self.video_material_with_analysis)
        assert analysis_data is not None
        assert analysis_data.video_url == "https://example.com/test_video.mp4"
        assert analysis_data.total_frames_extracted == 2
        assert analysis_data.video_duration == 10.0
        assert len(analysis_data.frame_analyses) == 2
        
        # Test without analysis data
        analysis_data = self.service._extract_video_analysis_data(self.video_material_without_analysis)
        assert analysis_data is None
        
        # Test non-video material
        analysis_data = self.service._extract_video_analysis_data(self.audio_material)
        assert analysis_data is None
    
    @patch('app.services.ai_mixed_editing_service.video_analysis_storage')
    def test_extract_video_analysis_data_from_storage(self, mock_storage):
        """Test extracting video analysis data from storage service."""
        # Mock storage service to return analysis data
        mock_analysis = VideoAnalysisMetadata(
            video_url="https://example.com/normal_video.mp4",
            total_frames_extracted=3,
            video_duration=15.0,
            frame_analyses=[
                VideoFrameAnalysis(
                    frame_number=0,
                    timestamp=0.0,
                    analysis="存储的分析数据"
                )
            ],
            processing_time=12.0,
            analysis_timestamp="2025-09-11T08:30:00.000Z"
        )
        mock_storage.get_analysis_result.return_value = mock_analysis
        
        # Test extracting from storage
        analysis_data = self.service._extract_video_analysis_data(self.video_material_without_analysis)
        assert analysis_data is not None
        assert analysis_data.video_url == "https://example.com/normal_video.mp4"
        assert analysis_data.total_frames_extracted == 3
        
        # Verify storage was called with correct URL
        mock_storage.get_analysis_result.assert_called_once_with("https://example.com/normal_video.mp4")
    
    def test_format_materials_for_prompt_with_video_analysis(self):
        """Test formatting materials with video analysis data for LLM prompt."""
        materials = [self.video_material_with_analysis, self.audio_material]
        
        prompt = self.service._format_materials_for_prompt(materials)
        
        # Check that video analysis data is included
        assert "视频解析数据:" in prompt
        assert "总帧数: 2" in prompt
        assert "视频时长: 10.00秒" in prompt
        assert "帧解析内容:" in prompt
        assert "帧0 (0.00s):" in prompt
        assert "帧1 (5.00s):" in prompt
        assert "橙色的长毛猫" in prompt
        assert "伸懒腰" in prompt
        
        # Check that audio material is also included
        assert "<audio_materials>" in prompt
        assert "背景音乐.mp3" in prompt
    
    def test_format_materials_for_prompt_without_video_analysis(self):
        """Test formatting materials without video analysis data."""
        materials = [self.video_material_without_analysis, self.audio_material]
        
        prompt = self.service._format_materials_for_prompt(materials)
        
        # Check that video is included but without analysis data
        assert "普通视频.mp4" in prompt
        assert "视频解析数据:" not in prompt
        assert "帧解析内容:" not in prompt
        
        # Check that audio material is still included
        assert "<audio_materials>" in prompt
        assert "背景音乐.mp3" in prompt
    
    def test_format_materials_truncates_long_frame_analysis(self):
        """Test that long frame analysis descriptions are properly truncated."""
        # Create material with very long analysis
        long_analysis_material = MaterialItemModel(
            id="video_long",
            name="长分析视频.mp4",
            type="video",
            format="mp4",
            size=1024000,
            duration=10.0,
            width=1920,
            height=1080,
            url="https://example.com/long_video.mp4",
            metadata={
                "video_analysis": {
                    "video_url": "https://example.com/long_video.mp4",
                    "total_frames_extracted": 1,
                    "video_duration": 10.0,
                    "frame_analyses": [
                        {
                            "frame_number": 0,
                            "timestamp": 0.0,
                            "analysis": "这是一个非常非常长的分析描述" * 20  # Very long text
                        }
                    ],
                    "processing_time": 10.0,
                    "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                }
            },
            createdAt="2025-09-11T08:00:00.000Z"
        )
        
        materials = [long_analysis_material]
        prompt = self.service._format_materials_for_prompt(materials)
        
        # Find the frame analysis line in the prompt
        lines = prompt.split('\n')
        frame_line = next((line for line in lines if "帧0 (0.00s):" in line), None)
        assert frame_line is not None
        
        # Extract the analysis part after the frame info
        analysis_part = frame_line.split("帧0 (0.00s): ")[1]
        
        # Should be truncated to 200 characters
        assert len(analysis_part) <= 200
        assert analysis_part.endswith("...")


class TestVideoAnalysisIntegrationEndToEnd:
    """End-to-end integration tests."""
    
    @pytest.fixture
    def sample_request_data(self):
        """Sample request data for testing."""
        return {
            "taskId": "test_task_123",
            "materials": [
                {
                    "id": "video_001",
                    "name": "测试视频.mp4",
                    "type": "video",
                    "format": "mp4",
                    "size": 1024000,
                    "duration": 10.0,
                    "width": 1920,
                    "height": 1080,
                    "url": "https://example.com/test_video.mp4",
                    "description": "测试视频",
                    "metadata": {
                        "video_analysis": {
                            "video_url": "https://example.com/test_video.mp4",
                            "total_frames_extracted": 2,
                            "video_duration": 10.0,
                            "frame_analyses": [
                                {
                                    "frame_number": 0,
                                    "timestamp": 0.0,
                                    "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。"
                                }
                            ],
                            "processing_time": 15.5,
                            "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                        }
                    },
                    "createdAt": "2025-09-11T08:00:00.000Z"
                }
            ]
        }
    
    def test_request_validation_with_video_analysis(self, sample_request_data):
        """Test that requests with video analysis data validate correctly."""
        request = AIMixedEditingRequest(**sample_request_data)
        
        assert request.taskId == "test_task_123"
        assert len(request.materials) == 1
        
        material = request.materials[0]
        assert material.id == "video_001"
        assert material.type == "video"
        assert "video_analysis" in material.metadata
        
        # Verify video analysis structure
        video_analysis = material.metadata["video_analysis"]
        assert video_analysis["video_url"] == "https://example.com/test_video.mp4"
        assert video_analysis["total_frames_extracted"] == 2
        assert len(video_analysis["frame_analyses"]) == 1


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])