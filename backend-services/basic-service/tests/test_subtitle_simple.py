#!/usr/bin/env python3
"""
简化的字幕添加功能测试脚本
只测试核心功能，不测试API端点
"""

import os
import sys
import asyncio
import logging
from pathlib import Path

# 添加当前目录到Python路径
sys.path.insert(0, os.path.dirname(__file__))

from app.models import SubtitleAddRequest
from app.services import SubtitleService

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def check_test_files():
    """检查测试文件是否存在"""
    video_path = "../datas/merge/video-1.mp4"
    subtitle_path = "../datas/merge/basic-01.srt"
    
    logger.info("检查测试文件...")
    
    if not os.path.exists(video_path):
        logger.error(f"❌ 视频文件不存在: {video_path}")
        return False, None, None
    
    if not os.path.exists(subtitle_path):
        logger.error(f"❌ 字幕文件不存在: {subtitle_path}")
        return False, None, None
    
    video_size = os.path.getsize(video_path)
    subtitle_size = os.path.getsize(subtitle_path)
    
    logger.info(f"✅ 测试文件检查通过:")
    logger.info(f"   视频文件: {video_path} ({video_size:,} 字节)")
    logger.info(f"   字幕文件: {subtitle_path} ({subtitle_size:,} 字节)")
    
    return True, video_path, subtitle_path


def test_service_initialization():
    """测试服务初始化"""
    logger.info("测试服务初始化...")
    
    try:
        service = SubtitleService()
        logger.info("✅ SubtitleService 初始化成功")
        return True, service
    except Exception as e:
        logger.error(f"❌ SubtitleService 初始化失败: {str(e)}")
        return False, None


def test_srt_parsing(service, subtitle_path):
    """测试SRT文件解析"""
    logger.info("测试SRT文件解析...")
    
    try:
        subtitles = service._parse_srt_file(subtitle_path)
        
        if not subtitles:
            logger.error("❌ 没有解析到字幕条目")
            return False
        
        logger.info(f"✅ 成功解析 {len(subtitles)} 条字幕:")
        for i, subtitle in enumerate(subtitles):
            logger.info(f"   {i+1}. {subtitle.start_time}->{subtitle.end_time}: {subtitle.text[:30]}...")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ SRT解析失败: {str(e)}")
        return False


def test_video_properties(service, video_path):
    """测试视频属性获取"""
    logger.info("测试视频属性获取...")
    
    try:
        width, height, fps = service._get_video_properties(video_path)
        
        if width is None or height is None or fps is None:
            logger.error("❌ 无法获取视频属性")
            return False, None, None, None
        
        logger.info(f"✅ 视频属性获取成功: {width}x{height} @ {fps}fps")
        return True, width, height, fps
        
    except Exception as e:
        logger.error(f"❌ 视频属性获取失败: {str(e)}")
        return False, None, None, None


def test_font_detection(service):
    """测试字体检测"""
    logger.info("测试字体检测...")
    
    try:
        font_path = service._get_font_path("default", "测试中文字符")
        
        if font_path:
            logger.info(f"✅ 找到字体文件: {font_path}")
        else:
            logger.warning("⚠️ 未找到字体文件，将使用系统默认字体")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ 字体检测失败: {str(e)}")
        return False


async def test_subtitle_addition(service, video_path, subtitle_path):
    """测试字幕添加功能"""
    logger.info("测试字幕添加功能...")
    
    try:
        # 创建请求
        request = SubtitleAddRequest(
            video_file_path=video_path,
            subtitle_file_path=subtitle_path,
            font_size=24,
            font_color="#FFFFFF",
            background_color="#000000",
            border_width=2,
            border_color="#000000",
            position="bottom",
            margin_vertical=50,
            margin_horizontal=40
        )
        
        logger.info("开始处理字幕...")
        result = await service.add_subtitles(request)
        
        if result.success:
            logger.info("✅ 字幕添加成功!")
            logger.info(f"   输出文件: {result.output_video_path}")
            logger.info(f"   视频尺寸: {result.video_width}x{result.video_height}")
            logger.info(f"   字幕数量: {result.subtitle_count}")
            logger.info(f"   处理时间: {result.processing_time:.2f}秒")
            logger.info(f"   文件大小: {result.file_size:,}字节")
            
            # 验证输出文件
            if os.path.exists(result.output_video_path):
                logger.info("✅ 输出文件验证通过")
                return True
            else:
                logger.error("❌ 输出文件不存在")
                return False
        else:
            logger.error(f"❌ 字幕添加失败: {result.message}")
            return False
            
    except Exception as e:
        logger.error(f"❌ 字幕添加过程中出现异常: {str(e)}")
        return False


async def main():
    """主测试函数"""
    logger.info("=" * 60)
    logger.info("字幕添加功能简化测试")
    logger.info("=" * 60)
    
    # 测试步骤
    tests_passed = 0
    total_tests = 6
    
    # 1. 检查测试文件
    files_ok, video_path, subtitle_path = check_test_files()
    if files_ok:
        tests_passed += 1
    else:
        logger.error("测试文件检查失败，无法继续测试")
        return False
    
    # 2. 测试服务初始化
    service_ok, service = test_service_initialization()
    if service_ok:
        tests_passed += 1
    else:
        logger.error("服务初始化失败，无法继续测试")
        return False
    
    # 3. 测试SRT解析
    if test_srt_parsing(service, subtitle_path):
        tests_passed += 1
    
    # 4. 测试视频属性获取
    props_ok, width, height, fps = test_video_properties(service, video_path)
    if props_ok:
        tests_passed += 1
    
    # 5. 测试字体检测
    if test_font_detection(service):
        tests_passed += 1
    
    # 6. 测试字幕添加
    if await test_subtitle_addition(service, video_path, subtitle_path):
        tests_passed += 1
    
    # 测试结果
    logger.info("\n" + "=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    logger.info(f"通过测试: {tests_passed}/{total_tests}")
    
    if tests_passed == total_tests:
        logger.info("🎉 所有测试通过!")
        return True
    else:
        logger.warning(f"⚠️ {total_tests - tests_passed} 个测试失败")
        return False


if __name__ == "__main__":
    """运行测试"""
    try:
        result = asyncio.run(main())
        
        print("\n" + "=" * 60)
        if result:
            print("🎉 测试成功完成!")
            print("字幕添加功能工作正常，可以开始使用API接口。")
        else:
            print("💥 测试失败!")
            print("请检查上面的错误信息并修复问题。")
        print("=" * 60)
        
        sys.exit(0 if result else 1)
        
    except KeyboardInterrupt:
        print("\n⚠️ 测试被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 测试过程中发生意外错误: {str(e)}")
        sys.exit(1) 