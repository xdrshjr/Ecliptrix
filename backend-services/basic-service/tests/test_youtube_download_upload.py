#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
YouTube视频下载并上传功能测试脚本
"""

import asyncio
import json
from app.services.youtube_service import youtube_service
from app.models.youtube_models import YoutubeVideoDownloadAndUploadRequest
from app.logger import get_logger

logger = get_logger(__name__)


async def test_youtube_download_and_upload():
    """测试YouTube视频下载并上传功能"""
    
    # 测试用的YouTube视频URL（使用一个短视频进行测试）
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # Rick Roll - 经典测试视频
    
    logger.info("开始测试YouTube视频下载并上传功能")
    
    try:
        # 创建请求对象
        request = YoutubeVideoDownloadAndUploadRequest(
            url=test_url,
            task_id="test-task-001",
            video_quality="720p",
            format_type="mp4",
            generate_thumbnail=True,
            custom_filename="test_video"
        )
        
        logger.info(f"测试请求参数: {request.model_dump()}")
        
        # 执行下载并上传
        result = await youtube_service.download_and_upload_video(request)
        
        # 输出结果
        logger.info("测试结果:")
        logger.info(f"成功: {result.success}")
        logger.info(f"消息: {result.message}")
        
        if result.success:
            logger.info(f"视频URL: {result.video_url}")
            logger.info(f"缩略图URL: {result.thumbnail_url}")
            logger.info(f"文件大小: {result.file_size} 字节")
            logger.info(f"视频时长: {result.duration} 秒")
            logger.info(f"视频尺寸: {result.width}x{result.height}")
            logger.info(f"原始YouTube URL: {result.original_youtube_url}")
            
            # 验证必要字段
            assert result.video_url is not None, "视频URL不能为空"
            assert result.file_size is not None, "文件大小不能为空"
            
            logger.info("✅ 测试通过：所有必要字段都已正确返回")
            
        else:
            logger.error(f"测试失败: {result.error}")
            
    except Exception as e:
        logger.error(f"测试过程中发生异常: {str(e)}", exc_info=True)


async def test_invalid_url():
    """测试无效URL的处理"""
    
    logger.info("开始测试无效URL处理")
    
    try:
        request = YoutubeVideoDownloadAndUploadRequest(
            url="https://invalid-url.com/video",
            task_id="test-task-002"
        )
        
        result = await youtube_service.download_and_upload_video(request)
        
        # 应该返回失败结果
        assert not result.success, "无效URL应该返回失败结果"
        assert result.error is not None, "失败结果应该包含错误信息"
        
        logger.info("✅ 无效URL测试通过")
        
    except Exception as e:
        logger.error(f"无效URL测试异常: {str(e)}", exc_info=True)


async def main():
    """主测试函数"""
    logger.info("=" * 50)
    logger.info("YouTube视频下载并上传功能测试")
    logger.info("=" * 50)
    
    # 测试1: 正常下载并上传
    await test_youtube_download_and_upload()
    
    print("\n" + "-" * 30 + "\n")
    
    # 测试2: 无效URL处理
    await test_invalid_url()
    
    logger.info("=" * 50)
    logger.info("测试完成")
    logger.info("=" * 50)


if __name__ == "__main__":
    asyncio.run(main()) 