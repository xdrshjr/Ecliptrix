#!/usr/bin/env python3
"""
Test script to validate subtitle width doesn't exceed video boundaries.

This script calculates the actual pixel width of rendered subtitles and compares
it with the available video width to ensure no overflow occurs.
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

def calculate_text_width(text: str, font_size: int, char_width_factor: float = 0.8) -> float:
    """
    Calculate estimated text width in pixels.
    
    Args:
        text: Text to measure
        font_size: Font size in pixels
        char_width_factor: Character width factor (0.8 for Chinese, 0.6 for Latin)
        
    Returns:
        Estimated text width in pixels
    """
    return len(text) * font_size * char_width_factor

def test_subtitle_width_validation():
    """Test that subtitles don't exceed video width boundaries."""
    
    subtitle_service = SubtitleService()
    
    # Test configurations
    test_cases = [
        {
            "video_type": "horizontal",
            "video_width": 1920,
            "video_height": 1080,
            "margin_horizontal": 50
        },
        {
            "video_type": "vertical", 
            "video_width": 360,
            "video_height": 640,
            "margin_horizontal": 50
        }
    ]
    
    font_sizes = [35, 50, 72]
    test_texts = [
        "大家好欢迎来到今天的视频教程",
        "今天我们要学习如何使用这个强大的视频编辑工具",
        "这个工具可以帮助我们快速创建专业级的视频内容"
    ]
    
    print("字幕宽度验证测试")
    print("=" * 80)
    
    all_passed = True
    
    for test_case in test_cases:
        video_type = test_case["video_type"]
        video_width = test_case["video_width"]
        video_height = test_case["video_height"]
        margin_horizontal = test_case["margin_horizontal"]
        
        available_width = video_width - (2 * margin_horizontal)
        
        print(f"\n📺 {video_type.upper()} 视频 ({video_width}x{video_height})")
        print(f"   可用宽度: {available_width}px (总宽度 {video_width}px - 边距 {margin_horizontal*2}px)")
        print("-" * 60)
        
        for font_size in font_sizes:
            # Calculate max line width using the service method
            max_chars = subtitle_service._calculate_max_line_width(
                video_width, font_size, margin_horizontal, video_height
            )
            
            print(f"\n🔤 字体大小 {font_size}px:")
            print(f"   最大字符数: {max_chars}")
            
            # Test each text with wrapping
            for i, original_text in enumerate(test_texts, 1):
                wrapped_lines = subtitle_service._wrap_text(original_text, max_chars)
                
                print(f"\n   测试文本 {i}: '{original_text}'")
                print(f"   换行结果: {len(wrapped_lines)} 行")
                
                max_line_width_pixels = 0
                for j, line in enumerate(wrapped_lines, 1):
                    # Calculate pixel width for Chinese characters
                    char_width_factor = 0.8 if video_width < video_height else 0.6
                    line_width_pixels = calculate_text_width(line, font_size, char_width_factor)
                    max_line_width_pixels = max(max_line_width_pixels, line_width_pixels)
                    
                    status = "✅" if line_width_pixels <= available_width else "❌"
                    print(f"     第{j}行: '{line}' ({len(line)}字符, ~{line_width_pixels:.1f}px) {status}")
                
                # Check if any line exceeds available width
                if max_line_width_pixels > available_width:
                    print(f"   ❌ 超出宽度! 最大行宽 {max_line_width_pixels:.1f}px > 可用宽度 {available_width}px")
                    all_passed = False
                else:
                    print(f"   ✅ 宽度合适! 最大行宽 {max_line_width_pixels:.1f}px <= 可用宽度 {available_width}px")
    
    print("\n" + "=" * 80)
    if all_passed:
        print("🎉 所有测试通过！字幕宽度控制正常工作。")
        return True
    else:
        print("⚠️  部分测试失败！字幕可能超出视频边界。")
        return False

def main():
    """Main test function."""
    try:
        success = test_subtitle_width_validation()
        return 0 if success else 1
    except Exception as e:
        logger.error(f"测试运行异常: {str(e)}", exc_info=True)
        print(f"❌ 测试运行失败: {str(e)}")
        return 1
    finally:
        # Restore original working directory
        os.chdir(original_cwd)

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code) 