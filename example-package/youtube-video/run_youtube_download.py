#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import argparse
import json
import threading
import re
import unicodedata
import hashlib
from pathlib import Path
import yt_dlp
from typing import Optional, Dict, Any, List


class YouTubeDownloader:
    """
    稳健的YouTube视频下载器
    支持多种格式、质量选择和时间范围下载
    新增关键词搜索功能
    """

    def __init__(self, output_dir: str = "./downloads"):
        """
        初始化下载器

        Args:
            output_dir: 下载文件保存目录
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def progress_hook(self, d: Dict[str, Any]) -> None:
        """下载进度回调函数"""
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', 'N/A')
            speed = d.get('_speed_str', 'N/A')
            print(f"\r下载进度: {percent} 速度: {speed}", end='', flush=True)
        elif d['status'] == 'finished':
            print(f"\n✅ 下载完成: {d['filename']}")

    def sanitize_filename(self, title: str, max_length: int = 200) -> str:
        """
        文件名规范化函数
        
        Args:
            title: 原始标题
            max_length: 最大文件名长度
            
        Returns:
            str: 规范化后的文件名
        """
        if not title or not title.strip():
            return "video"
            
        # Unicode规范化，将组合字符转换为分解形式
        title = unicodedata.normalize('NFKD', title)
        
        # 移除或替换文件系统不支持的字符
        # Windows: < > : " | ? * /
        # 添加其他可能有问题的字符
        problematic_chars = r'[<>:"/\\|?*\x00-\x1f\x7f-\x9f]'
        title = re.sub(problematic_chars, '_', title)
        
        # 替换一些特殊字符为更合适的替代
        replacements = {
            '？': '_',
            '！': '_', 
            '：': '_',
            '；': '_',
            '【': '[',
            '】': ']',
            '（': '(',
            '）': ')',
        }
        
        for old, new in replacements.items():
            title = title.replace(old, new)
        
        # 移除多余的空格和下划线
        title = re.sub(r'[\s_]+', '_', title).strip('_').strip()
        
        # 移除开头和结尾的点号（Windows系统不允许）
        title = title.strip('.')
        
        # 确保不为空
        if not title:
            title = "video"
            
        # 截断过长的文件名，预留扩展名和唯一标识符的空间
        max_base_length = max_length - 20  # 为 .mp4 和时间戳预留空间
        if len(title) > max_base_length:
            title = title[:max_base_length].rstrip('_').rstrip('.')
            
        return title

    def search_videos(
            self,
            query: str,
            max_results: int = 20,
            language: str = 'zh',
            region: str = 'CN',
            min_duration: Optional[int] = None,
            max_duration: Optional[int] = None,
            min_views: Optional[int] = None,
            max_views: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索YouTube视频

        Args:
            query: 搜索关键词
            max_results: 最大结果数量
            language: 搜索语言
            region: 搜索地区
            min_duration: 最小时长（秒）
            max_duration: 最大时长（秒）
            min_views: 最小播放量
            max_views: 最大播放量

        Returns:
            List[Dict]: 视频信息列表
        """
        try:
            # 如果有过滤条件，搜索更多结果以便过滤
            search_limit = max_results
            if any([min_duration, max_duration, min_views, max_views]):
                search_limit = min(max_results * 3, 50)  # 搜索3倍数量，但不超过50
                
            search_url = f"ytsearch{search_limit}:{query}"
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,
                'default_search': 'ytsearch',
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_results = ydl.extract_info(search_url, download=False)
                
                videos = []
                if search_results and 'entries' in search_results:
                    for entry in search_results['entries']:
                        if entry:
                            video_info = {
                                'id': entry.get('id', ''),
                                'title': entry.get('title', 'Unknown'),
                                'url': f"https://www.youtube.com/watch?v={entry.get('id', '')}",
                                'duration': entry.get('duration', 0),
                                'uploader': entry.get('uploader', 'Unknown'),
                                'upload_date': entry.get('upload_date', 'Unknown'),
                                'view_count': entry.get('view_count', 0),
                                'thumbnail_url': entry.get('thumbnail', ''),
                                'description': entry.get('description', '')[:200] if entry.get('description') else ''
                            }
                            videos.append(video_info)

                # 应用过滤条件
                filtered_videos = self._filter_videos(
                    videos, min_duration, max_duration, min_views, max_views
                )
                
                # 限制返回结果数量
                return filtered_videos[:max_results]

        except Exception as e:
            return []

    def _filter_videos(
        self, 
        videos: List[Dict[str, Any]], 
        min_duration: Optional[int] = None,
        max_duration: Optional[int] = None, 
        min_views: Optional[int] = None,
        max_views: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        根据条件过滤视频列表
        
        Args:
            videos: 视频列表
            min_duration: 最小时长（秒）
            max_duration: 最大时长（秒）
            min_views: 最小播放量
            max_views: 最大播放量
            
        Returns:
            List[Dict]: 过滤后的视频列表
        """
        filtered = []
        
        for video in videos:
            # 时长过滤
            duration = video.get('duration', 0)
            if min_duration is not None and duration < min_duration:
                continue
            if max_duration is not None and duration > max_duration:
                continue
                
            # 播放量过滤
            view_count = video.get('view_count', 0)
            if min_views is not None and view_count < min_views:
                continue
            if max_views is not None and view_count > max_views:
                continue
                
            filtered.append(video)
            
        return filtered

    def download_video(
            self,
            url: str,
            video_quality: str = "best",
            audio_quality: str = "best",
            format_type: str = "mp4",
            start_time: Optional[str] = None,
            end_time: Optional[str] = None,
            duration: Optional[str] = None,
            subtitle: bool = False,
            max_retries: int = 3
    ) -> bool:
        """
        下载YouTube视频

        Args:
            url: YouTube视频URL
            video_quality: 视频质量 ('best', 'worst', '720p', '1080p', etc.)
            audio_quality: 音频质量 ('best', 'worst', '128', '256', etc.)
            format_type: 输出格式 ('mp4', 'webm', 'mkv', etc.)
            start_time: 开始时间 (格式: "00:01:30" 或 "90")
            end_time: 结束时间 (格式: "00:05:00" 或 "300")
            duration: 持续时间 (格式: "00:03:30" 或 "210")
            subtitle: 是否下载字幕
            max_retries: 最大重试次数

        Returns:
            bool: 下载是否成功
        """
        try:
            # 首先获取视频信息用于文件名生成
            info_result = self.get_video_info(url)
            if not info_result:
                return False
                
            # 生成规范化的文件名
            original_title = info_result.get('title', 'video')
            sanitized_title = self.sanitize_filename(original_title)
            
            # 添加时间戳确保唯一性
            timestamp = int(time.time())
            unique_filename = f"{sanitized_title}_{timestamp}.%(ext)s"
            
            # 构建输出文件名模板
            outtmpl = str(self.output_dir / unique_filename)

            # 构建格式选择器
            if video_quality == "best":
                format_selector = f"best[ext={format_type}]/best"
            elif video_quality == "worst":
                format_selector = f"worst[ext={format_type}]/worst"
            else:
                # 具体质量要求，如 720p, 1080p
                height = video_quality.replace('p', '')
                format_selector = f"best[height<={height}][ext={format_type}]/best[height<={height}]/best"

            # yt-dlp 配置
            ydl_opts = {
                'format': format_selector,
                'outtmpl': outtmpl,
                'retries': max_retries,
                'fragment_retries': max_retries,
                'writesubtitles': subtitle,
                'writeautomaticsub': subtitle,
                'progress_hooks': [self.progress_hook],
                'no_warnings': False,
                'ignoreerrors': False,
            }

            # 时间范围处理（需要ffmpeg）
            postprocessor_args = []
            if start_time or end_time or duration:
                if start_time:
                    postprocessor_args.extend(['-ss', start_time])
                if duration:
                    postprocessor_args.extend(['-t', duration])
                elif end_time:
                    postprocessor_args.extend(['-to', end_time])

                ydl_opts['postprocessors'] = [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': format_type,
                    'postprocessor_args': postprocessor_args
                }]

            # 执行下载
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # 开始下载
                ydl.download([url])
                return True

        except Exception as e:
            return False

    def get_video_info(self, url: str) -> Optional[Dict[str, Any]]:
        """
        获取视频信息而不下载

        Args:
            url: YouTube视频URL

        Returns:
            Dict: 视频信息字典
        """
        try:
            ydl_opts = {'quiet': True}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    'id': info.get('id', ''),
                    'title': info.get('title', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'view_count': info.get('view_count', 0),
                    'uploader': info.get('uploader', 'Unknown'),
                    'upload_date': info.get('upload_date', 'Unknown'),
                    'thumbnail': info.get('thumbnail', ''),
                    'description': info.get('description', '')[:200] if info.get('description') else ''
                }
        except Exception as e:
            return None


def main():
    """主函数 - 支持命令行参数"""
    parser = argparse.ArgumentParser(description='YouTube视频下载器')
    
    # 操作类型
    parser.add_argument('--info', type=str, help='获取视频信息')
    parser.add_argument('--search', type=str, help='搜索视频')
    parser.add_argument('--download', type=str, help='下载视频')
    
    # 搜索参数
    parser.add_argument('--max-results', type=int, default=20, help='最大搜索结果数')
    parser.add_argument('--language', type=str, default='zh', help='搜索语言')
    parser.add_argument('--region', type=str, default='CN', help='搜索地区')
    
    # 新增搜索过滤参数
    parser.add_argument('--min-duration', type=int, help='最小时长（秒）')
    parser.add_argument('--max-duration', type=int, help='最大时长（秒）')
    parser.add_argument('--min-views', type=int, help='最小播放量')
    parser.add_argument('--max-views', type=int, help='最大播放量')
    
    # 下载参数
    parser.add_argument('--quality', type=str, default='720p', help='视频质量')
    parser.add_argument('--format', type=str, default='mp4', help='输出格式')
    parser.add_argument('--output', type=str, default='./downloads', help='输出目录')
    parser.add_argument('--subtitle', action='store_true', help='下载字幕文件')
    
    args = parser.parse_args()
    
    # 创建下载器实例
    downloader = YouTubeDownloader(output_dir=args.output)
    
    try:
        if args.info:
            # 获取视频信息
            info = downloader.get_video_info(args.info)
            if info:
                print(json.dumps(info, ensure_ascii=False, indent=2))
            else:
                print(json.dumps({"error": "Failed to get video info"}, ensure_ascii=False))
                sys.exit(1)
                
        elif args.search:
            # 搜索视频
            videos = downloader.search_videos(
                query=args.search,
                max_results=args.max_results,
                language=args.language,
                region=args.region,
                min_duration=args.min_duration,
                max_duration=args.max_duration,
                min_views=args.min_views,
                max_views=args.max_views
            )
            print(json.dumps({"videos": videos}, ensure_ascii=False, indent=2))
            
        elif args.download:
            # 下载视频
            success = downloader.download_video(
                url=args.download,
                video_quality=args.quality,
                format_type=args.format,
                subtitle=args.subtitle
            )
            if success:
                print(json.dumps({"success": True, "message": "Download completed"}, ensure_ascii=False))
            else:
                print(json.dumps({"error": "Download failed"}, ensure_ascii=False))
                sys.exit(1)
        else:
            parser.print_help()
            
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    # 检查依赖
    try:
        import yt_dlp
    except ImportError:
        print(json.dumps({"error": "Missing dependency: yt-dlp. Please run: pip install yt-dlp"}, ensure_ascii=False))
        sys.exit(1)

    # 运行主程序
    try:
        main()
    except KeyboardInterrupt:
        print(json.dumps({"error": "User interrupted"}, ensure_ascii=False))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)