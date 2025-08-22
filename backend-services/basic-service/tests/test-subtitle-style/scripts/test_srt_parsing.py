#!/usr/bin/env python3
"""
Simple test script to verify SRT parsing functionality.
"""

import os
import sys
from pathlib import Path

# Get paths and change working directory
current_dir = Path(__file__).parent
backend_service_dir = current_dir.parent.parent.parent  # Go up 3 levels: scripts -> test-subtitle-style -> tests -> basic-service

print(f"切换工作目录到: {backend_service_dir}")
original_cwd = os.getcwd()
os.chdir(backend_service_dir)

# Add to Python path
sys.path.insert(0, str(backend_service_dir))

from app.services.subtitle_service import SubtitleService
from app.logger import get_logger

logger = get_logger(__name__)

def test_srt_parsing():
    """Test SRT file parsing."""
    try:
        subtitle_service = SubtitleService()
        materials_dir = Path("tests/test-subtitle-style/materials")
        srt_file = materials_dir / "basic-subtitle.srt"
        
        print(f"测试SRT文件解析: {srt_file}")
        
        # Read and display file content
        with open(srt_file, 'r', encoding='utf-8') as f:
            content = f.read()
        print("SRT文件内容:")
        print("-" * 40)
        print(content)
        print("-" * 40)
        
        # Parse the SRT file
        subtitles = subtitle_service._parse_srt_file(str(srt_file))
        
        print(f"\n解析结果: 找到 {len(subtitles)} 个字幕条目")
        
        for i, subtitle in enumerate(subtitles):
            print(f"字幕 {i+1}:")
            print(f"  索引: {subtitle.index}")
            print(f"  开始时间: {subtitle.start_time}")
            print(f"  结束时间: {subtitle.end_time}")
            print(f"  文本: {subtitle.text}")
            
            # Test time conversion
            start_seconds = subtitle_service._convert_time_to_seconds(subtitle.start_time)
            end_seconds = subtitle_service._convert_time_to_seconds(subtitle.end_time)
            print(f"  开始时间(秒): {start_seconds}")
            print(f"  结束时间(秒): {end_seconds}")
            print()
        
        return len(subtitles) > 0
        
    except Exception as e:
        logger.error(f"测试失败: {str(e)}", exc_info=True)
        return False
    finally:
        # Restore original working directory
        os.chdir(original_cwd)

if __name__ == "__main__":
    success = test_srt_parsing()
    if success:
        print("✅ SRT解析测试通过")
        sys.exit(0)
    else:
        print("❌ SRT解析测试失败")
        sys.exit(1) 