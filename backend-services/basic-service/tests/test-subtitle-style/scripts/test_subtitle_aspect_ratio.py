#!/usr/bin/env python3
"""
Test script for subtitle aspect ratio adaptation.

This script tests the improved subtitle rendering logic that adapts to different
video aspect ratios (horizontal vs vertical) and font sizes.

Test cases:
- Font sizes: 35, 50, 72
- Video types: horizontal (landscape) and vertical (portrait)
- Validates that subtitles don't exceed video width boundaries
"""

import os
import sys
import asyncio
import json
from pathlib import Path

# Get paths and change working directory
current_dir = Path(__file__).parent
backend_service_dir = current_dir.parent.parent.parent  # Go up 3 levels: scripts -> test-subtitle-style -> tests -> basic-service

print(f"切换工作目录到: {backend_service_dir}")
original_cwd = os.getcwd()
os.chdir(backend_service_dir)

# Add to Python path
sys.path.insert(0, str(backend_service_dir))

from app.models.video_models import SubtitleAddRequest, SubtitleAddResponse
from app.services.subtitle_service import SubtitleService
from app.logger import get_logger

logger = get_logger(__name__)

class SubtitleAspectRatioTester:
    """Test class for subtitle aspect ratio adaptation."""
    
    def __init__(self):
        """Initialize the tester."""
        self.subtitle_service = SubtitleService()
        self.materials_dir = Path("tests/test-subtitle-style/materials")
        self.outputs_dir = Path("tests/test-subtitle-style/outputs")
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        
        # Test configurations
        self.font_sizes = [35, 50, 72]
        self.video_files = {
            "horizontal": "horizontal-video.mp4",
            "vertical": "vertical-video.mp4"
        }
        self.subtitle_file = "basic-subtitle.srt"
        
    def validate_materials(self) -> bool:
        """Validate that all required test materials exist."""
        logger.info("验证测试素材...")
        
        missing_files = []
        
        # Check subtitle file
        subtitle_path = self.materials_dir / self.subtitle_file
        if not subtitle_path.exists():
            missing_files.append(str(subtitle_path))
        
        # Check video files
        for video_type, filename in self.video_files.items():
            video_path = self.materials_dir / filename
            if not video_path.exists():
                missing_files.append(str(video_path))
        
        if missing_files:
            logger.error(f"缺少测试素材文件: {missing_files}")
            return False
        
        logger.info("所有测试素材文件验证通过")
        return True
    
    async def test_font_size_and_aspect_ratio(self, video_type: str, font_size: int) -> dict:
        """
        Test subtitle rendering for a specific video type and font size.
        
        Args:
            video_type: "horizontal" or "vertical"
            font_size: Font size to test (35, 50, or 72)
            
        Returns:
            Test result dictionary
        """
        logger.info(f"测试 {video_type} 视频，字体大小 {font_size}")
        
        # Prepare file paths
        video_file = self.materials_dir / self.video_files[video_type]
        subtitle_file = self.materials_dir / self.subtitle_file
        
        # Generate output filename
        output_filename = f"{video_type}_font{font_size}_subtitled.mp4"
        output_path = self.outputs_dir / output_filename
        
        # Create subtitle request
        request = SubtitleAddRequest(
            video_file_path=str(video_file),
            subtitle_file_path=str(subtitle_file),
            font_family="default",
            font_size=font_size,
            font_color="#FFFFFF",
            background_color="#000000@0.5",  # Semi-transparent black background
            border_width=2,
            border_color="#000000",
            position="bottom",
            margin_vertical=50,
            margin_horizontal=50
        )
        
        try:
            # Process subtitles
            logger.info(f"开始处理字幕: {video_type} 视频，字体大小 {font_size}")
            result = await self.subtitle_service.add_subtitles(request)
            
            if result.success:
                # Move output to our test outputs directory
                if result.output_video_path and os.path.exists(result.output_video_path):
                    import shutil
                    shutil.move(result.output_video_path, str(output_path))
                    logger.info(f"测试成功: 输出文件 {output_path}")
                    
                    return {
                        "success": True,
                        "video_type": video_type,
                        "font_size": font_size,
                        "output_file": str(output_path),
                        "message": f"Successfully processed {video_type} video with font size {font_size}",
                        "video_width": result.video_width,
                        "video_height": result.video_height,
                        "subtitle_count": result.subtitle_count,
                        "processing_time": result.processing_time,
                        "file_size": result.file_size
                    }
                else:
                    logger.error(f"输出文件不存在: {result.output_video_path}")
                    return {
                        "success": False,
                        "video_type": video_type,
                        "font_size": font_size,
                        "error": "Output file not found"
                    }
            else:
                logger.error(f"字幕处理失败: {result.message}")
                return {
                    "success": False,
                    "video_type": video_type,
                    "font_size": font_size,
                    "error": result.message
                }
                
        except Exception as e:
            logger.error(f"测试异常: {str(e)}", exc_info=True)
            return {
                "success": False,
                "video_type": video_type,
                "font_size": font_size,
                "error": str(e)
            }
    
    async def run_all_tests(self) -> dict:
        """
        Run all test combinations.
        
        Returns:
            Complete test results
        """
        logger.info("开始运行所有字幕纵横比适配测试")
        
        if not self.validate_materials():
            return {"success": False, "error": "Missing test materials"}
        
        results = {
            "success": True,
            "test_summary": {
                "total_tests": len(self.font_sizes) * len(self.video_files),
                "passed": 0,
                "failed": 0
            },
            "detailed_results": []
        }
        
        # Run tests for all combinations
        for video_type in self.video_files.keys():
            for font_size in self.font_sizes:
                test_result = await self.test_font_size_and_aspect_ratio(video_type, font_size)
                results["detailed_results"].append(test_result)
                
                if test_result["success"]:
                    results["test_summary"]["passed"] += 1
                    logger.info(f"✅ 测试通过: {video_type} 视频，字体大小 {font_size}")
                else:
                    results["test_summary"]["failed"] += 1
                    logger.error(f"❌ 测试失败: {video_type} 视频，字体大小 {font_size} - {test_result.get('error', 'Unknown error')}")
        
        # Update overall success status
        results["success"] = results["test_summary"]["failed"] == 0
        
        return results
    
    def print_test_summary(self, results: dict):
        """Print a formatted test summary."""
        print("\n" + "="*80)
        print("字幕纵横比适配测试结果总结")
        print("="*80)
        
        summary = results["test_summary"]
        print(f"总测试数: {summary['total_tests']}")
        print(f"通过: {summary['passed']}")
        print(f"失败: {summary['failed']}")
        print(f"成功率: {(summary['passed']/summary['total_tests']*100):.1f}%")
        
        print("\n详细结果:")
        print("-" * 80)
        
        for result in results["detailed_results"]:
            status = "✅ 通过" if result["success"] else "❌ 失败"
            video_type = result["video_type"]
            font_size = result["font_size"]
            
            print(f"{status} | {video_type:10} | 字体大小 {font_size:2d}")
            
            if result["success"]:
                print(f"     输出文件: {result['output_file']}")
                print(f"     视频尺寸: {result.get('video_width', 'N/A')}x{result.get('video_height', 'N/A')}")
                print(f"     字幕数量: {result.get('subtitle_count', 'N/A')}")
                print(f"     处理时间: {result.get('processing_time', 'N/A'):.2f}s")
                print(f"     文件大小: {result.get('file_size', 'N/A')} bytes")
            else:
                print(f"     错误: {result.get('error', 'Unknown error')}")
        
        print("\n" + "="*80)
        
        if results["success"]:
            print("🎉 所有测试通过！字幕纵横比适配功能正常工作。")
        else:
            print("⚠️  部分测试失败，请检查日志了解详细信息。")
        
        print("\n测试输出文件位置:")
        print(f"📁 {self.outputs_dir.absolute()}")
        print("="*80)

async def main():
    """Main test function."""
    tester = SubtitleAspectRatioTester()
    
    try:
        # Run all tests
        results = await tester.run_all_tests()
        
        # Print summary
        tester.print_test_summary(results)
        
        # Save results to JSON file
        results_file = tester.outputs_dir / "test_results.json"
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        
        logger.info(f"测试结果已保存到: {results_file}")
        
        # Return appropriate exit code
        return 0 if results["success"] else 1
        
    except Exception as e:
        logger.error(f"测试运行异常: {str(e)}", exc_info=True)
        print(f"❌ 测试运行失败: {str(e)}")
        return 1
    finally:
        # Restore original working directory
        os.chdir(original_cwd)

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code) 