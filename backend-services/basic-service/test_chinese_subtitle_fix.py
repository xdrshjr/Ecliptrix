#!/usr/bin/env python3
"""
测试Ubuntu中文字幕乱码修复效果的脚本

Usage:
    python test_chinese_subtitle_fix.py
"""

import os
import sys
import platform
import logging

# 添加项目路径到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.subtitle_service import SubtitleService
from app.logger import get_logger

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = get_logger(__name__)

def test_chinese_character_detection():
    """测试中文字符检测功能"""
    print("\n=== 测试中文字符检测功能 ===")
    
    service = SubtitleService()
    
    test_cases = [
        ("Hello World", False, "纯英文"),
        ("你好世界", True, "纯中文"),
        ("Hello 世界", True, "中英混合"),
        ("测试字幕效果", True, "中文句子"),
        ("123456", False, "纯数字"),
        ("Hello! 你好！", True, "中英标点混合"),
        ("", False, "空字符串"),
    ]
    
    for text, expected, description in test_cases:
        result = service._contains_chinese(text)
        status = "✅" if result == expected else "❌"
        print(f"{status} {description}: '{text}' -> {result} (期望: {expected})")

def test_font_path_selection():
    """测试字体路径选择功能"""
    print(f"\n=== 测试字体路径选择功能 (系统: {platform.system()}) ===")
    
    service = SubtitleService()
    
    test_cases = [
        ("", "default", "空文本 + 默认字体"),
        ("Hello World", "default", "英文 + 默认字体"),
        ("你好世界", "default", "中文 + 默认字体"),
        ("Hello 世界", "sans-serif", "中英混合 + 无衬线字体"),
        ("测试字幕", "serif", "中文 + 衬线字体"),
        ("Code test", "monospace", "英文 + 等宽字体"),
    ]
    
    for text, font_family, description in test_cases:
        print(f"\n--- {description} ---")
        font_path = service._get_font_path(font_family, text)
        
        if font_path:
            font_exists = os.path.exists(font_path)
            status = "✅" if font_exists else "❌"
            print(f"{status} 找到字体: {font_path}")
            if not font_exists:
                print("   ⚠️  字体文件不存在！")
        else:
            print("❌ 未找到合适的字体")

def test_ubuntu_chinese_fonts():
    """测试Ubuntu系统中文字体可用性"""
    if platform.system().lower() != "linux":
        print(f"\n⚠️  当前系统是 {platform.system()}，跳过Ubuntu字体测试")
        return
        
    print("\n=== 测试Ubuntu中文字体可用性 ===")
    
    chinese_fonts = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/opentype/source-han-sans/SourceHanSansCN-Regular.otf",
        "/usr/share/fonts/truetype/source-han-sans/SourceHanSansCN-Regular.ttf",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "/usr/share/fonts/truetype/arphic/ukai.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    ]
    
    available_fonts = []
    missing_fonts = []
    
    for font_path in chinese_fonts:
        if os.path.exists(font_path):
            available_fonts.append(font_path)
            print(f"✅ {font_path}")
        else:
            missing_fonts.append(font_path)
            print(f"❌ {font_path}")
    
    print(f"\n📊 字体统计:")
    print(f"   可用字体: {len(available_fonts)}")
    print(f"   缺失字体: {len(missing_fonts)}")
    
    if not available_fonts:
        print("\n⚠️  警告: 系统中没有找到任何中文字体！")
        print("   建议安装中文字体:")
        print("   sudo apt-get install fonts-noto-cjk fonts-wqy-microhei")
    else:
        print(f"\n✅ 系统已安装 {len(available_fonts)} 个中文字体，可以正常显示中文字幕")

def test_font_priority():
    """测试字体优先级逻辑"""
    print(f"\n=== 测试字体优先级逻辑 ===")
    
    service = SubtitleService()
    
    # 测试中文文本
    print("\n--- 中文文本字体选择 ---")
    chinese_font = service._get_font_path("default", "这是中文测试")
    print(f"中文文本选择的字体: {chinese_font}")
    
    # 测试英文文本  
    print("\n--- 英文文本字体选择 ---")
    english_font = service._get_font_path("default", "This is English test")
    print(f"英文文本选择的字体: {english_font}")
    
    # 比较字体选择
    if chinese_font and english_font:
        if chinese_font != english_font:
            print("✅ 字体优先级逻辑正常工作：中英文选择了不同的字体")
        else:
            print("ℹ️  中英文选择了相同的字体（这可能是正常的，取决于系统字体配置）")

def main():
    """主测试函数"""
    print("🔧 Ubuntu中文字幕乱码修复测试")
    print("=" * 50)
    
    try:
        test_chinese_character_detection()
        test_font_path_selection()
        test_ubuntu_chinese_fonts()
        test_font_priority()
        
        print("\n" + "=" * 50)
        print("✅ 测试完成！")
        print("\n📋 修复说明:")
        print("   1. 增加了中文字符检测功能")
        print("   2. 优化了Ubuntu系统字体优先级")
        print("   3. 增强了日志记录和错误提示")
        print("   4. 当检测到中文字符时，优先使用中文字体")
        
        if platform.system().lower() == "linux":
            print("\n💡 Ubuntu系统建议:")
            print("   如果仍然出现中文乱码，请安装中文字体:")
            print("   sudo apt-get install fonts-noto-cjk fonts-wqy-microhei")
            
    except Exception as e:
        logger.error(f"测试过程中出现错误: {str(e)}", exc_info=True)
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main()) 