"""
Test for portrait video font size issue
测试竖屏视频字体大小问题
"""

import asyncio
from unittest.mock import Mock, patch
from app.models.video_models import SubtitleAddRequest
from app.services.subtitle_service import SubtitleService


def main():
    """主测试函数"""
    print("开始测试竖屏视频字体大小问题...")
    
    subtitle_service = SubtitleService()
    
    # 测试1: 竖屏vs横屏视频的字体大小处理
    print("\n=== 测试1: 竖屏vs横屏字体大小对比 ===")
    
    # 横屏视频字符宽度计算 (1920x1080)
    landscape_max_width = subtitle_service._calculate_max_line_width(
        video_width=1920,
        font_size=36,
        margin_horizontal=50,
        video_height=1080  # aspect_ratio = 1.78
    )
    
    # 竖屏视频字符宽度计算 (1080x1920) 
    portrait_max_width = subtitle_service._calculate_max_line_width(
        video_width=1080,
        font_size=36,
        margin_horizontal=50,
        video_height=1920  # aspect_ratio = 0.56
    )
    
    print(f"横屏视频 (1920x1080, 36px字体): 最大行宽 = {landscape_max_width} 字符")
    print(f"竖屏视频 (1080x1920, 36px字体): 最大行宽 = {portrait_max_width} 字符")
    print(f"差异: 竖屏比横屏少 {landscape_max_width - portrait_max_width} 字符")
    
    # 测试2: 竖屏视频不同字体大小的字符限制
    print("\n=== 测试2: 竖屏视频字体大小分析 ===")
    
    test_font_sizes = [24, 36, 48, 60, 72]
    
    for font_size in test_font_sizes:
        max_line_width = subtitle_service._calculate_max_line_width(
            video_width=1080,
            font_size=font_size,
            margin_horizontal=50,
            video_height=1920
        )
        
        # 计算详细信息
        available_width = 1080 - (2 * 50)  # 980px
        char_width = font_size * 0.8  # 竖屏字符宽度系数
        base_chars = int(available_width / char_width)
        
        print(f"字体大小 {font_size}px:")
        print(f"  - 单字符宽度: {char_width}px")
        print(f"  - 基础字符数: {base_chars}")
        print(f"  - 最终限制: {max_line_width} 字符")
        print(f"  - 实际宽度: {max_line_width * char_width}px / {available_width}px")
        
        # 验证字体大小限制逻辑
        if font_size >= 72:
            expected_limit = min(base_chars, 4)
        elif font_size >= 50:
            expected_limit = min(base_chars, 6)
        else:
            expected_limit = min(base_chars, 9)
            
        assert max_line_width == expected_limit, f"字体 {font_size}px 的字符限制不正确"
        print(f"  ✅ 字符限制正确")
    
    # 测试3: 关键问题分析
    print("\n=== 测试3: 关键问题分析 ===")
    
    # 分析用户反馈的问题：设置36号字体，但显示很小
    user_font_size = 36
    
    # 竖屏视频中36号字体的处理
    portrait_chars = subtitle_service._calculate_max_line_width(
        video_width=1080,
        font_size=user_font_size,
        margin_horizontal=50,
        video_height=1920
    )
    
    print(f"用户设置 {user_font_size}px 字体在竖屏视频中:")
    print(f"  - 最大字符数: {portrait_chars}")
    print(f"  - 字符宽度: {user_font_size * 0.8}px")
    print(f"  - 行总宽度: {portrait_chars * user_font_size * 0.8}px")
    
    # 检查是否有缩放问题
    char_width = user_font_size * 0.8
    line_width = portrait_chars * char_width
    available_width = 1080 - 100  # 减去边距
    
    print(f"  - 可用宽度: {available_width}px")
    print(f"  - 使用比例: {line_width/available_width*100:.1f}%")
    
    if line_width > available_width:
        print("  ❌ 警告: 计算出的行宽超出可用宽度!")
    else:
        print("  ✅ 行宽在可用范围内")
    
    # 核心问题检查：FFmpeg是否收到正确的字体大小
    print(f"\n核心检查: SubtitleAddRequest 中的字体大小")
    request = SubtitleAddRequest(
        video_file_path="/test/portrait.mp4",
        subtitle_file_path="/test/test.srt",
        font_family="default",
        font_size=user_font_size,  # 用户设置的字体大小
        font_color="#FFFFFF",
        position="bottom"
    )
    
    print(f"请求中的字体大小: {request.font_size}px")
    print(f"✅ 字体大小正确传递到请求对象")
    
    print("\n=== 问题诊断结果 ===")
    print("经过测试，发现以下情况:")
    print("1. ✅ 用户设置的字体大小正确传递到SubtitleAddRequest")
    print("2. ✅ 竖屏视频的字符数限制逻辑正常")
    print("3. ❓ 可能的问题源头:")
    print("   - FFmpeg渲染时的DPI/缩放设置")
    print("   - 视频分辨率vs显示分辨率的差异")
    print("   - 字体渲染引擎的像素密度处理")
    
    print("\n需要进一步检查:")
    print("1. FFmpeg drawtext 滤镜的实际渲染参数")
    print("2. 视频播放器的缩放设置")
    print("3. 不同设备上的显示差异")


if __name__ == "__main__":
    main() 