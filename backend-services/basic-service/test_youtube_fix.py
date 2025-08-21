#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
YouTube搜索修复测试脚本
"""

import sys
import os

# 添加项目路径到sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.services.youtube_service import youtube_service
from app.models.youtube_models import YoutubeSearchRequest


def test_youtube_search_fix():
    """测试YouTube搜索修复"""
    print("=" * 50)
    print("测试YouTube搜索修复")
    print("=" * 50)
    
    # 创建搜索请求
    search_request = YoutubeSearchRequest(
        query="cat",
        max_videos=5,
        orientation="mixed"
    )
    
    print(f"搜索关键词: {search_request.query}")
    print(f"最大结果数: {search_request.max_videos}")
    print()
    
    # 执行搜索
    print("开始搜索...")
    try:
        result = youtube_service.search_videos(search_request)
        
        if result.success:
            print(f"✅ 搜索成功！找到 {result.total_found} 个视频")
            print()
            
            for i, video in enumerate(result.videos[:3], 1):  # 只显示前3个结果
                print(f"视频 {i}:")
                print(f"  ID: {video.id}")
                print(f"  标题: {video.title}")
                print(f"  上传者: {video.uploader}")
                print(f"  时长: {video.duration} 秒")
                print(f"  播放量: {video.view_count:,}")
                print(f"  URL: {video.url}")
                print(f"  缩略图: {video.thumbnail_url}")
                print()
        else:
            print(f"❌ 搜索失败: {result.error}")
            return False
            
    except Exception as e:
        print(f"❌ 搜索过程中发生异常: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    return True


if __name__ == "__main__":
    print("YouTube搜索修复测试开始")
    print()
    
    success = test_youtube_search_fix()
    
    print()
    print("=" * 50)
    if success:
        print("🎉 测试通过！修复成功")
    else:
        print("❌ 测试失败，需要进一步调试") 