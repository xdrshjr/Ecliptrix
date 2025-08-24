#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
YouTube服务测试脚本
用于验证YouTube搜索和信息获取功能是否正常工作
"""

import asyncio
import sys
import os

# 添加项目路径到sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.services.youtube_service import youtube_service
from app.models.youtube_models import YoutubeSearchRequest, YoutubeVideoInfoRequest


async def test_youtube_search():
    """测试YouTube搜索功能"""
    print("=" * 50)
    print("测试YouTube搜索功能")
    print("=" * 50)
    
    # 创建搜索请求
    search_request = YoutubeSearchRequest(
        query="python tutorial",
        max_videos=5,
        orientation="mixed"
    )
    
    print(f"搜索关键词: {search_request.query}")
    print(f"最大结果数: {search_request.max_videos}")
    print(f"视频方向: {search_request.orientation}")
    print()
    
    # 执行搜索
    print("开始搜索...")
    result = youtube_service.search_videos(search_request)
    
    if result.success:
        print(f"✅ 搜索成功！找到 {result.total_found} 个视频")
        print()
        
        for i, video in enumerate(result.videos[:3], 1):  # 只显示前3个结果
            print(f"视频 {i}:")
            print(f"  标题: {video.title}")
            print(f"  上传者: {video.uploader}")
            print(f"  时长: {video.duration} 秒")
            print(f"  播放量: {video.view_count:,}")
            print(f"  URL: {video.url}")
            print()
    else:
        print(f"❌ 搜索失败: {result.error}")
    
    return result


async def test_youtube_info():
    """测试YouTube视频信息获取功能"""
    print("=" * 50)
    print("测试YouTube视频信息获取功能")
    print("=" * 50)
    
    # 使用一个知名的YouTube视频URL进行测试
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # Rick Roll
    
    info_request = YoutubeVideoInfoRequest(url=test_url)
    
    print(f"测试URL: {test_url}")
    print()
    
    # 获取视频信息
    print("获取视频信息...")
    result = youtube_service.get_video_info(info_request)
    
    if result.success and result.video:
        video = result.video
        print("✅ 获取视频信息成功！")
        print()
        print(f"视频ID: {video.id}")
        print(f"标题: {video.title}")
        print(f"上传者: {video.uploader}")
        print(f"时长: {video.duration} 秒")
        print(f"播放量: {video.view_count:,}")
        print(f"上传日期: {video.upload_date}")
        print(f"描述: {video.description[:100]}...")
        print(f"缩略图: {video.thumbnail_url}")
    else:
        print(f"❌ 获取视频信息失败: {result.error}")
    
    return result


async def test_service_health():
    """测试服务健康状态"""
    print("=" * 50)
    print("测试服务健康状态")
    print("=" * 50)
    
    try:
        import yt_dlp
        print("✅ yt-dlp 已安装")
        print(f"版本: {yt_dlp.version.__version__}")
        
        # 测试基本的yt-dlp功能
        ydl_opts = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # 简单测试，不实际下载
            print("✅ yt-dlp 初始化成功")
            
    except ImportError:
        print("❌ yt-dlp 未安装")
        return False
    except Exception as e:
        print(f"❌ yt-dlp 测试失败: {str(e)}")
        return False
    
    return True


async def main():
    """主测试函数"""
    print("YouTube服务测试开始")
    print("=" * 50)
    
    # 测试服务健康状态
    health_ok = await test_service_health()
    if not health_ok:
        print("❌ 服务健康检查失败，退出测试")
        return
    
    print()
    
    # 测试搜索功能
    search_result = await test_youtube_search()
    
    print()
    
    # 测试视频信息获取功能
    info_result = await test_youtube_info()
    
    print()
    print("=" * 50)
    print("测试总结")
    print("=" * 50)
    
    if search_result.success:
        print("✅ YouTube搜索功能正常")
    else:
        print("❌ YouTube搜索功能异常")
    
    if info_result.success:
        print("✅ YouTube信息获取功能正常")
    else:
        print("❌ YouTube信息获取功能异常")
    
    if search_result.success and info_result.success:
        print()
        print("🎉 所有测试通过！YouTube服务运行正常")
    else:
        print()
        print("⚠️  部分测试失败，请检查网络连接和yt-dlp安装")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n测试被用户中断")
    except Exception as e:
        print(f"\n测试过程中发生错误: {str(e)}")
        import traceback
        traceback.print_exc() 