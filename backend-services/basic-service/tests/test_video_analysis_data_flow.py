"""
Test script to verify video analysis data flow from frontend to LLM.
This test simulates the complete data flow to ensure frame_analyses are properly transmitted.
"""

import pytest
import json
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime

from app.models.ai_mixed_editing_models import (
    MaterialItemModel, 
    AIMixedEditingRequest,
    VideoAnalysisMetadata,
    VideoFrameAnalysis
)
from app.services.ai_mixed_editing_service import AIMixedEditingService


class TestVideoAnalysisDataFlow:
    """Test the complete data flow of video analysis from frontend to LLM."""
    
    def setup_method(self):
        """Set up test fixtures."""
        # Mock settings
        with patch('app.services.ai_mixed_editing_service.settings') as mock_settings:
            mock_***REMOVED*** = "test-api-key"
            mock_settings.video_cut_llm_api_url = "https://test-api.com"
            mock_settings.video_cut_llm_model = "test-model"
            mock_settings.debug = True  # Enable debug logging
            
            self.service = AIMixedEditingService()
    
    def test_frontend_data_structure_compatibility(self):
        """Test that frontend video analysis data structure is compatible with backend models."""
        
        # This simulates the data structure that would come from frontend
        frontend_video_analysis_data = {
            "video_url": "https://example.com/test_video.mp4",
            "total_frames_extracted": 3,
            "video_duration": 15.0,
            "frame_analyses": [
                {
                    "frame_number": 0,
                    "timestamp": 0.0,
                    "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：\n\n1. 猫咪特征：橙色长毛，看起来很舒适",
                    "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0000_0.00s.jpg"
                },
                {
                    "frame_number": 1,
                    "timestamp": 5.0,
                    "analysis": "画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。猫咪的表情很放松，眼睛半闭着，看起来很惬意。整个画面充满了温暖的色调，给人一种宁静祥和的感觉。",
                    "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0001_5.00s.jpg"
                },
                {
                    "frame_number": 2,
                    "timestamp": 10.0,
                    "analysis": "最后一帧显示猫咪已经完全放松下来，蜷缩在沙发的一角。它的尾巴优雅地环绕着身体，眼睛完全闭上，显然已经进入了午睡状态。背景中可以看到一些家居装饰，营造出一个温馨的家庭环境。",
                    "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0002_10.00s.jpg"
                }
            ],
            "processing_time": 25.3,
            "analysis_timestamp": "2025-09-11T08:30:00.000Z"
        }
        
        # Test that the data can be parsed by our models
        try:
            video_analysis = VideoAnalysisMetadata(**frontend_video_analysis_data)
            assert video_analysis is not None
            assert len(video_analysis.frame_analyses) == 3
            assert video_analysis.frame_analyses[0].frame_number == 0
            assert video_analysis.frame_analyses[0].timestamp == 0.0
            assert "橙色的长毛猫" in video_analysis.frame_analyses[0].analysis
            assert video_analysis.frame_analyses[0].frame_path is not None
            print("✅ Frontend data structure is compatible with backend models")
        except Exception as e:
            pytest.fail(f"Failed to parse frontend video analysis data: {str(e)}")
    
    def test_material_with_video_analysis_data(self):
        """Test MaterialItemModel with video analysis data in metadata."""
        
        # Simulate a material item with video analysis data as it would come from frontend
        material_data = {
            "id": "video_001",
            "name": "测试视频.mp4",
            "type": "video",
            "format": "mp4",
            "size": 1024000,
            "duration": 15.0,
            "width": 1920,
            "height": 1080,
            "url": "https://example.com/test_video.mp4",
            "thumbnailUrl": "https://example.com/thumb.jpg",
            "description": "测试视频",
            "tags": ["测试", "猫咪"],
            "metadata": {
                "video_analysis": {
                    "video_url": "https://example.com/test_video.mp4",
                    "total_frames_extracted": 2,
                    "video_duration": 15.0,
                    "frame_analyses": [
                        {
                            "frame_number": 0,
                            "timestamp": 0.0,
                            "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：\n\n1. 猫咪特征：橙色长毛，看起来很舒适",
                            "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0000_0.00s.jpg"
                        },
                        {
                            "frame_number": 1,
                            "timestamp": 7.5,
                            "analysis": "画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。猫咪的表情很放松，眼睛半闭着，看起来很惬意。",
                            "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0001_7.50s.jpg"
                        }
                    ],
                    "processing_time": 20.5,
                    "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                }
            },
            "createdAt": "2025-09-11T08:00:00.000Z"
        }
        
        # Test that the material can be created and parsed
        try:
            material = MaterialItemModel(**material_data)
            assert material is not None
            assert material.id == "video_001"
            assert "video_analysis" in material.metadata
            print("✅ Material with video analysis data created successfully")
            
            # Test extracting video analysis data
            analysis_data = self.service._extract_video_analysis_data(material)
            assert analysis_data is not None
            assert len(analysis_data.frame_analyses) == 2
            assert analysis_data.frame_analyses[0].frame_number == 0
            assert "橙色的长毛猫" in analysis_data.frame_analyses[0].analysis
            print("✅ Video analysis data extracted successfully from material")
            
        except Exception as e:
            pytest.fail(f"Failed to create material with video analysis data: {str(e)}")
    
    def test_prompt_generation_with_video_analysis(self):
        """Test that LLM prompt includes video analysis data correctly."""
        
        # Create material with video analysis data
        material_with_analysis = MaterialItemModel(
            id="video_001",
            name="猫咪休息视频.mp4",
            type="video",
            format="mp4",
            size=2048000,
            duration=15.0,
            width=1920,
            height=1080,
            url="https://example.com/cat_video.mp4",
            description="一只橙色猫咪在沙发上休息的视频",
            tags=["猫咪", "休息", "沙发"],
            metadata={
                "video_analysis": {
                    "video_url": "https://example.com/cat_video.mp4",
                    "total_frames_extracted": 3,
                    "video_duration": 15.0,
                    "frame_analyses": [
                        {
                            "frame_number": 0,
                            "timestamp": 0.0,
                            "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：\n\n1. 猫咪特征：橙色长毛，看起来很舒适，正在享受阳光的温暖。它的姿态很放松，四肢自然地伸展着。",
                            "frame_path": "/tmp/frame_0.jpg"
                        },
                        {
                            "frame_number": 1,
                            "timestamp": 7.5,
                            "analysis": "画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。猫咪的表情很放松，眼睛半闭着，看起来很惬意。整个画面充满了温暖的色调。",
                            "frame_path": "/tmp/frame_1.jpg"
                        },
                        {
                            "frame_number": 2,
                            "timestamp": 15.0,
                            "analysis": "最后一帧显示猫咪已经完全放松下来，蜷缩在沙发的一角。它的尾巴优雅地环绕着身体，眼睛完全闭上，显然已经进入了午睡状态。背景中可以看到温馨的家居装饰。",
                            "frame_path": "/tmp/frame_2.jpg"
                        }
                    ],
                    "processing_time": 30.2,
                    "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                }
            },
            createdAt="2025-09-11T08:00:00.000Z"
        )
        
        # Create material without analysis for comparison
        material_without_analysis = MaterialItemModel(
            id="audio_001",
            name="轻松背景音乐.mp3",
            type="audio",
            format="mp3",
            size=512000,
            duration=30.0,
            url="https://example.com/bg_music.mp3",
            description="轻松的背景音乐",
            createdAt="2025-09-11T08:00:00.000Z"
        )
        
        materials = [material_with_analysis, material_without_analysis]
        
        # Generate prompt
        prompt = self.service._format_materials_for_prompt(materials)
        
        # Verify that video analysis data is included in the prompt
        assert "视频解析数据:" in prompt, "视频解析数据标题应该在提示词中"
        assert "总帧数: 3" in prompt, "总帧数信息应该在提示词中"
        assert "视频时长: 15.00秒" in prompt, "视频时长信息应该在提示词中"
        assert "帧解析内容:" in prompt, "帧解析内容标题应该在提示词中"
        
        # Check that all frames are included
        assert "帧0 (0.00s):" in prompt, "第一帧信息应该在提示词中"
        assert "帧1 (7.50s):" in prompt, "第二帧信息应该在提示词中"
        assert "帧2 (15.00s):" in prompt, "第三帧信息应该在提示词中"
        
        # Check that frame analysis content is included (should be truncated to 200 chars)
        assert "橙色的长毛猫" in prompt, "帧分析内容应该在提示词中"
        assert "伸懒腰" in prompt, "帧分析内容应该在提示词中"
        assert "午睡状态" in prompt, "帧分析内容应该在提示词中"
        
        # Check that audio material is also included
        assert "轻松背景音乐.mp3" in prompt, "音频素材应该也在提示词中"
        
        print("✅ LLM prompt correctly includes video analysis data")
        print("\n=== Generated Prompt Sample ===")
        print(prompt[:1000] + "..." if len(prompt) > 1000 else prompt)
        print("=" * 50)
    
    def test_frame_analysis_truncation(self):
        """Test that long frame analysis descriptions are properly truncated to 200 characters."""
        
        # Create a very long analysis description
        very_long_analysis = "这是一个非常详细的视频帧分析描述，" * 20  # This will be much longer than 200 chars
        
        truncated = self.service._truncate_frame_analysis(very_long_analysis)
        
        # Should be exactly 200 characters
        assert len(truncated) == 200, f"截断后的长度应该是200字符，实际是{len(truncated)}"
        assert truncated.endswith("..."), "截断后的文本应该以...结尾"
        assert truncated == very_long_analysis[:197] + "...", "截断逻辑应该正确"
        
        print("✅ Frame analysis truncation works correctly")
    
    def test_complete_request_simulation(self):
        """Test a complete AI mixed editing request with video analysis data."""
        
        # Simulate a complete request as it would come from frontend
        request_data = {
            "taskId": "test_task_with_analysis",
            "materials": [
                {
                    "id": "video_001",
                    "name": "猫咪视频.mp4",
                    "type": "video",
                    "format": "mp4",
                    "size": 3145728,
                    "duration": 20.0,
                    "width": 1920,
                    "height": 1080,
                    "url": "https://example.com/cat_video.mp4",
                    "thumbnailUrl": "https://example.com/thumb.jpg",
                    "description": "可爱的橙色猫咪在家中休息",
                    "tags": ["猫咪", "宠物", "休息"],
                    "metadata": {
                        "video_analysis": {
                            "video_url": "https://example.com/cat_video.mp4",
                            "total_frames_extracted": 4,
                            "video_duration": 20.0,
                            "frame_analyses": [
                                {
                                    "frame_number": 0,
                                    "timestamp": 0.0,
                                    "analysis": "这张图片展示了一只橙色的长毛猫在沙发上休息的场景。以下是对图片内容的详细描述：\n\n1",
                                    "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0000_0.00s.jpg"
                                },
                                {
                                    "frame_number": 1,
                                    "timestamp": 5.0,
                                    "analysis": "画面显示猫咪正在伸懒腰，阳光透过窗户洒在它的毛发上，营造出温馨的家居氛围。",
                                    "frame_path": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\frames_video_b442469d_a7d9c8e5\\frame_0001_5.00s.jpg"
                                }
                            ],
                            "processing_time": 18.7,
                            "analysis_timestamp": "2025-09-11T08:30:00.000Z"
                        }
                    },
                    "createdAt": "2025-09-11T08:00:00.000Z"
                }
            ]
        }
        
        # Test that the request can be parsed
        try:
            request = AIMixedEditingRequest(**request_data)
            assert request is not None
            assert request.taskId == "test_task_with_analysis"
            assert len(request.materials) == 1
            
            material = request.materials[0]
            assert material.type == "video"
            assert "video_analysis" in material.metadata
            
            # Test that video analysis data can be extracted
            analysis_data = self.service._extract_video_analysis_data(material)
            assert analysis_data is not None
            assert len(analysis_data.frame_analyses) == 2
            
            print("✅ Complete request with video analysis data processed successfully")
            
        except Exception as e:
            pytest.fail(f"Failed to process complete request: {str(e)}")


if __name__ == "__main__":
    # Run the tests
    test_instance = TestVideoAnalysisDataFlow()
    test_instance.setup_method()
    
    print("🧪 Running Video Analysis Data Flow Tests...\n")
    
    try:
        test_instance.test_frontend_data_structure_compatibility()
        test_instance.test_material_with_video_analysis_data()
        test_instance.test_prompt_generation_with_video_analysis()
        test_instance.test_frame_analysis_truncation()
        test_instance.test_complete_request_simulation()
        
        print("\n🎉 All tests passed! Video analysis data flow is working correctly.")
        
    except Exception as e:
        print(f"\n❌ Test failed: {str(e)}")
        raise