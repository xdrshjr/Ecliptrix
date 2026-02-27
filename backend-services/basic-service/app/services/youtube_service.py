#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import re
import unicodedata
import hashlib
import asyncio
import random
from pathlib import Path
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor
import yt_dlp
from app.logger import get_logger
from app.config import get_settings
from app.models.youtube_models import (
    YoutubeSearchRequest, YoutubeSearchResponse, YoutubeVideoInfo,
    YoutubeVideoDownloadRequest, YoutubeVideoDownloadResponse,
    YoutubeVideoInfoRequest, YoutubeVideoInfoResponse,
    YoutubeVideoDownloadAndUploadRequest, YoutubeVideoDownloadAndUploadResponse
)

logger = get_logger(__name__)

# 获取配置并创建全局并发控制信号量
_settings = get_settings()
_max_concurrent_downloads = _settings.youtube.download.max_concurrent_downloads
_download_semaphore = asyncio.Semaphore(_max_concurrent_downloads)

logger.info(f"YouTube服务初始化 - 最大并发下载数: {_max_concurrent_downloads}")


async def retry_with_exponential_backoff(
    func,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    jitter: bool = True
):
    """
    带指数退避的重试装饰器
    
    Args:
        func: 要重试的异步函数
        max_retries: 最大重试次数
        base_delay: 基础延迟时间（秒）
        max_delay: 最大延迟时间（秒）
        backoff_factor: 退避因子
        jitter: 是否添加随机抖动
    
    Returns:
        函数执行结果
    """
    last_exception = None
    
    for attempt in range(max_retries + 1):
        try:
            logger.info(f"执行尝试 {attempt + 1}/{max_retries + 1}")
            return await func()
            
        except Exception as e:
            last_exception = e
            
            if attempt == max_retries:
                logger.error(f"所有重试尝试失败，最终错误: {str(e)}", exc_info=True)
                break
                
            # 计算延迟时间
            delay = min(base_delay * (backoff_factor ** attempt), max_delay)
            
            # 添加随机抖动以避免雷群效应
            if jitter:
                delay = delay * (0.5 + random.random() * 0.5)
            
            logger.warning(
                f"尝试 {attempt + 1} 失败: {str(e)}, "
                f"{delay:.2f}秒后重试 (剩余重试次数: {max_retries - attempt})"
            )
            
            await asyncio.sleep(delay)
    
    # 如果所有重试都失败，抛出最后一个异常
    raise last_exception


class YouTubeService:
    """
    YouTube视频服务类
    支持视频搜索、信息获取和下载功能
    基于yt-dlp实现
    """

    def __init__(self, output_dir: str = "./static/video/youtube"):
        """
        初始化YouTube服务
        
        Args:
            output_dir: 下载文件保存目录
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"YouTube服务初始化完成，下载目录: {self.output_dir}")

    def progress_hook(self, d: Dict[str, Any]) -> None:
        """下载进度回调函数"""
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', 'N/A')
            speed = d.get('_speed_str', 'N/A')
            logger.debug(f"下载进度: {percent} 速度: {speed}")
        elif d['status'] == 'finished':
            logger.info(f"下载完成: {d['filename']}")

    def _get_robust_ydl_options(self, base_opts: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        获取增强的yt-dlp配置选项，专门处理YouTube的nsig提取问题
        
        Args:
            base_opts: 基础配置选项
            
        Returns:
            Dict[str, Any]: 增强的配置选项
        """
        robust_opts = {
            'extract_flat': False,
            'no_warnings': False,
            'ignoreerrors': False,
            'retries': 5,
            'fragment_retries': 5,
            'socket_timeout': 30,
            'extractor_args': {
                'youtube': {
                    'skip': ['hls', 'dash'],  # 跳过可能有nsig问题的格式
                    'player_client': ['android', 'web', 'ios'],  # 尝试多个客户端
                    'max_comments': [0],  # 不提取评论
                    'comment_sort': ['top'],  # 如果需要评论，只要热门的
                }
            },
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-us,en;q=0.5',
                'Accept-Encoding': 'gzip,deflate',
                'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
                'Keep-Alive': '300',
                'Connection': 'keep-alive',
            }
        }
        
        if base_opts:
            robust_opts.update(base_opts)
            
        return robust_opts

    def sanitize_filename(self, title: str, max_length: int = 200) -> str:
        """
        文件名规范化函数，移除特殊字符、emoji和不安全字符
        将中文字符转换为ASCII安全的替代字符，确保云存储兼容性
        
        Args:
            title: 原始标题
            max_length: 最大文件名长度
            
        Returns:
            str: 规范化后的文件名
        """
        if not title or not title.strip():
            return "video"
            
        # 保存原始标题用于生成备用名称
        original_title = title.strip()
        
        # Unicode规范化，将组合字符转换为分解形式
        title = unicodedata.normalize('NFKD', title)
        
        # 移除emoji和其他符号字符，并处理中文字符
        # 只保留ASCII字母、数字、常见标点符号
        allowed_chars = []
        for char in title:
            # 获取字符的Unicode类别
            category = unicodedata.category(char)
            
            # 只保留ASCII范围内的安全字符
            if (ord(char) < 128 and  # ASCII范围内
                (category.startswith('L') or  # Letters
                 category.startswith('N') or  # Numbers
                 char in ' .-_()[]{}' or      # Safe punctuation
                 category == 'Zs')):         # Space separators
                allowed_chars.append(char)
            else:
                # 将非ASCII字符（包括中文）替换为下划线
                # 这确保了云存储的兼容性
                allowed_chars.append('_')
        
        title = ''.join(allowed_chars)
        
        # 移除或替换文件系统不支持的字符
        problematic_chars = r'[<>:"/\\|?*\x00-\x1f\x7f-\x9f]'
        title = re.sub(problematic_chars, '_', title)
        
        # 替换一些特殊字符为更合适的替代
        replacements = {
            '？': '_', '！': '_', '：': '_', '；': '_',
            '【': '[', '】': ']', '（': '(', '）': ')',
        }
        
        for old, new in replacements.items():
            title = title.replace(old, new)
        
        # 移除多余的空格和下划线
        title = re.sub(r'[\s_]+', '_', title).strip('_').strip()
        
        # 移除开头和结尾的点号（Windows系统不允许）
        title = title.strip('.')
        
        # 如果清理后为空或只有下划线，生成基于原始标题长度的备用名称
        if not title or title == '_':
            # 使用原始标题的哈希值生成唯一标识符
            import hashlib
            hash_obj = hashlib.md5(original_title.encode('utf-8'))
            hash_str = hash_obj.hexdigest()[:8]  # 取前8位
            title = f"video_{hash_str}"
            
        # 截断过长的文件名，预留扩展名和唯一标识符的空间
        max_base_length = max_length - 20  # 为 .mp4 和时间戳预留空间
        if len(title) > max_base_length:
            title = title[:max_base_length].rstrip('_').rstrip('.')
            
        return title

    def search_videos(self, request: YoutubeSearchRequest) -> YoutubeSearchResponse:
        """
        搜索YouTube视频
        
        Args:
            request: 搜索请求参数
            
        Returns:
            YoutubeSearchResponse: 搜索结果
        """
        logger.info(f"开始YouTube视频搜索 - 关键词: '{request.query}', 最大数量: {request.max_videos}")
        
        try:
            # 如果有过滤条件，搜索更多结果以便过滤
            search_limit = request.max_videos
            if any([request.min_duration, request.max_duration, request.min_views, request.max_views]):
                search_limit = min(request.max_videos * 3, 150)  # 搜索3倍数量，但不超过150
                
            search_url = f"ytsearch{search_limit}:{request.query}"
            
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,
                'default_search': 'ytsearch',
                'socket_timeout': 15,
                'retries': 1,
                'fragment_retries': 1,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_results = ydl.extract_info(search_url, download=False)
                
                videos = []
                if search_results and 'entries' in search_results:
                    for entry in search_results['entries']:
                        if entry:
                            try:
                                # 安全地处理可能为None的数值字段
                                duration = entry.get('duration')
                                if duration is None or not isinstance(duration, (int, float)):
                                    duration = 0
                                else:
                                    duration = int(duration)
                                
                                view_count = entry.get('view_count')
                                if view_count is None or not isinstance(view_count, (int, float)):
                                    view_count = 0
                                else:
                                    view_count = int(view_count)
                                
                                video_id = entry.get('id', '')
                                if not video_id:
                                    logger.warning(f"跳过没有ID的视频条目: {entry.get('title', 'Unknown')}")
                                    continue
                                
                                video_info = YoutubeVideoInfo(
                                    id=video_id,
                                    title=entry.get('title', 'Unknown'),
                                    url=f"https://www.youtube.com/watch?v={video_id}",
                                    duration=duration,
                                    uploader=entry.get('uploader', 'Unknown'),
                                    upload_date=entry.get('upload_date', 'Unknown'),
                                    view_count=view_count,
                                    thumbnail_url=entry.get('thumbnail', ''),
                                    description=entry.get('description', '')[:200] if entry.get('description') else ''
                                )
                                videos.append(video_info)
                                
                            except Exception as e:
                                logger.warning(f"处理视频条目时出错，跳过: {str(e)}, 条目: {entry.get('title', 'Unknown')}")
                                continue

                # 应用过滤条件
                filtered_videos = self._filter_videos(
                    videos, request.min_duration, request.max_duration, 
                    request.min_views, request.max_views
                )
                
                # 限制返回结果数量
                final_videos = filtered_videos[:request.max_videos]
                
                logger.info(f"YouTube搜索完成 - 找到: {len(final_videos)} 个视频")
                
                return YoutubeSearchResponse(
                    success=True,
                    videos=final_videos,
                    total_found=len(final_videos),
                    message=f"成功找到 {len(final_videos)} 个视频",
                    query=request.query
                )

        except Exception as e:
            error_msg = f"YouTube搜索失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeSearchResponse(
                success=False,
                videos=[],
                total_found=0,
                error=error_msg,
                query=request.query
            )

    def _filter_videos(
        self, 
        videos: List[YoutubeVideoInfo], 
        min_duration: Optional[int] = None,
        max_duration: Optional[int] = None, 
        min_views: Optional[int] = None,
        max_views: Optional[int] = None
    ) -> List[YoutubeVideoInfo]:
        """
        根据条件过滤视频列表
        
        Args:
            videos: 视频列表
            min_duration: 最小时长（秒）
            max_duration: 最大时长（秒）
            min_views: 最小播放量
            max_views: 最大播放量
            
        Returns:
            List[YoutubeVideoInfo]: 过滤后的视频列表
        """
        filtered = []
        
        for video in videos:
            # 时长过滤
            video_duration = video.duration or 0
            if min_duration is not None and video_duration < min_duration:
                continue
            if max_duration is not None and video_duration > max_duration:
                continue
                
            # 播放量过滤
            video_view_count = video.view_count or 0
            if min_views is not None and video_view_count < min_views:
                continue
            if max_views is not None and video_view_count > max_views:
                continue
                
            filtered.append(video)
            
        return filtered

    def get_video_info(self, request: YoutubeVideoInfoRequest) -> YoutubeVideoInfoResponse:
        """
        获取YouTube视频信息
        
        Args:
            request: 视频信息请求
            
        Returns:
            YoutubeVideoInfoResponse: 视频信息响应
        """
        logger.info(f"获取YouTube视频信息 - URL: {request.url}")
        
        try:
            base_opts = {'quiet': True}
            ydl_opts = self._get_robust_ydl_options(base_opts)
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(request.url, download=False)
                
                # 安全地处理可能为None的数值字段
                duration = info.get('duration')
                if duration is None or not isinstance(duration, (int, float)):
                    duration = 0
                else:
                    duration = int(duration)
                
                view_count = info.get('view_count')
                if view_count is None or not isinstance(view_count, (int, float)):
                    view_count = 0
                else:
                    view_count = int(view_count)
                
                video_info = YoutubeVideoInfo(
                    id=info.get('id', ''),
                    title=info.get('title', 'Unknown'),
                    url=request.url,
                    duration=duration,
                    uploader=info.get('uploader', 'Unknown'),
                    upload_date=info.get('upload_date', 'Unknown'),
                    view_count=view_count,
                    thumbnail_url=info.get('thumbnail', ''),
                    description=info.get('description', '')[:200] if info.get('description') else '',
                    width=info.get('width'),
                    height=info.get('height')
                )
                
                logger.info(f"成功获取视频信息 - 标题: {video_info.title}")
                
                return YoutubeVideoInfoResponse(
                    success=True,
                    video=video_info,
                    message="成功获取视频信息"
                )
                
        except Exception as e:
            error_msg = f"获取视频信息失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeVideoInfoResponse(
                success=False,
                error=error_msg
            )

    def download_video(self, request: YoutubeVideoDownloadRequest) -> YoutubeVideoDownloadResponse:
        """
        下载YouTube视频
        
        Args:
            request: 下载请求参数
            
        Returns:
            YoutubeVideoDownloadResponse: 下载结果
        """
        logger.info(f"开始下载YouTube视频 - URL: {request.url}")
        
        try:
            # 首先获取视频信息用于文件名生成
            info_request = YoutubeVideoInfoRequest(url=request.url)
            info_result = self.get_video_info(info_request)
            
            if not info_result.success or not info_result.video:
                return YoutubeVideoDownloadResponse(
                    success=False,
                    message="获取视频信息失败",
                    error="无法获取视频信息"
                )
                
            # 生成规范化的文件名
            original_title = info_result.video.title
            sanitized_title = self.sanitize_filename(original_title)
            
            # 添加时间戳确保唯一性
            timestamp = int(time.time())
            unique_filename = f"{sanitized_title}_{timestamp}.%(ext)s"
            
            # 构建输出文件名模板
            outtmpl = str(self.output_dir / unique_filename)

            # 构建更灵活的格式选择器，支持多种回退选项
            format_options = []
            
            if request.video_quality == "best":
                format_options = [
                    f"best[ext={request.format_type}]",
                    f"best[ext={request.format_type}][protocol^=http]",
                    "best[ext=mp4]",
                    "best[ext=webm]", 
                    "best",
                    "worst"  # 最后的回退选项
                ]
            elif request.video_quality == "worst":
                format_options = [
                    f"worst[ext={request.format_type}]",
                    f"worst[ext={request.format_type}][protocol^=http]",
                    "worst[ext=mp4]",
                    "worst[ext=webm]",
                    "worst"
                ]
            else:
                # 具体质量要求，如 720p, 1080p
                height = request.video_quality.replace('p', '')
                format_options = [
                    f"best[height<={height}][ext={request.format_type}]",
                    f"best[height<={height}][ext={request.format_type}][protocol^=http]",
                    f"best[height<={height}][ext=mp4]",
                    f"best[height<={height}][ext=webm]",
                    f"best[height<={height}]",
                    f"best[ext={request.format_type}]",
                    "best[ext=mp4]",
                    "best"
                ]
            
            format_selector = "/".join(format_options)

            # 使用增强的yt-dlp配置
            base_opts = {
                'format': format_selector,
                'outtmpl': outtmpl,
                'writesubtitles': request.subtitle,
                'writeautomaticsub': request.subtitle,
                'progress_hooks': [self.progress_hook],
            }
            ydl_opts = self._get_robust_ydl_options(base_opts)

            # 时间范围处理（需要ffmpeg）
            postprocessor_args = []
            if request.start_time or request.end_time or request.duration:
                if request.start_time:
                    postprocessor_args.extend(['-ss', request.start_time])
                if request.duration:
                    postprocessor_args.extend(['-t', request.duration])
                elif request.end_time:
                    postprocessor_args.extend(['-to', request.end_time])

                ydl_opts['postprocessors'] = [{
                    'key': 'FFmpegVideoConvertor',
                    'preferedformat': request.format_type,
                    'postprocessor_args': postprocessor_args
                }]

            # 执行下载，支持格式回退重试
            download_successful = False
            last_error = None
            
            # 首先尝试完整的格式选择器
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([request.url])
                    download_successful = True
            except Exception as e:
                last_error = str(e)
                logger.warning(f"主要格式下载失败，尝试回退格式: {last_error}")
                
                # 如果主要格式失败，尝试更简单的格式选择器
                fallback_formats = [
                    "best[ext=mp4]/best[ext=webm]/best",  # 只要mp4或webm
                    "best[protocol^=http]",  # 只要http协议
                    "best/worst"  # 任何可用格式
                ]
                
                for fallback_format in fallback_formats:
                    try:
                        logger.info(f"尝试回退格式: {fallback_format}")
                        fallback_opts = ydl_opts.copy()
                        fallback_opts['format'] = fallback_format
                        
                        with yt_dlp.YoutubeDL(fallback_opts) as ydl:
                            ydl.download([request.url])
                            download_successful = True
                            logger.info(f"回退格式下载成功: {fallback_format}")
                            break
                    except Exception as fallback_error:
                        last_error = str(fallback_error)
                        logger.warning(f"回退格式 {fallback_format} 也失败: {last_error}")
                        continue
            
            if download_successful:
                # 查找下载的文件
                downloaded_files = list(self.output_dir.glob(f"{sanitized_title}_{timestamp}.*"))
                if downloaded_files:
                    file_path = str(downloaded_files[0])
                    file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                    
                    logger.info(f"视频下载成功 - 文件: {file_path}")
                    
                    return YoutubeVideoDownloadResponse(
                        success=True,
                        message="视频下载成功",
                        file_path=file_path,
                        file_size=file_size
                    )
                else:
                    return YoutubeVideoDownloadResponse(
                        success=False,
                        message="下载完成但找不到文件",
                        error="文件未找到"
                    )
            else:
                return YoutubeVideoDownloadResponse(
                    success=False,
                    message="所有格式下载都失败",
                    error=f"最后错误: {last_error}"
                )

        except Exception as e:
            error_msg = f"视频下载失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeVideoDownloadResponse(
                success=False,
                message="视频下载失败",
                error=error_msg
            )

    async def download_video_async(self, request: YoutubeVideoDownloadRequest) -> YoutubeVideoDownloadResponse:
        """
        异步下载YouTube视频（使用线程池执行同步下载）
        
        Args:
            request: 下载请求参数
            
        Returns:
            YoutubeVideoDownloadResponse: 下载结果
        """
        logger.info(f"异步下载YouTube视频 - URL: {request.url}")
        
        # 使用线程池执行同步的下载操作
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                # 在线程池中执行同步下载
                download_result = await loop.run_in_executor(
                    executor, 
                    self.download_video, 
                    request
                )
                return download_result
            except Exception as e:
                error_msg = f"异步视频下载失败: {str(e)}"
                logger.error(error_msg, exc_info=True)
                return YoutubeVideoDownloadResponse(
                    success=False,
                    message="异步视频下载失败",
                    error=error_msg
                )

    async def download_and_upload_video(self, request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
        """
        下载YouTube视频并上传到存储服务
        支持并发控制（最多5个并发）和自动重试（最多3次）
        
        Args:
            request: 下载并上传请求参数
            
        Returns:
            YoutubeVideoDownloadAndUploadResponse: 操作结果
        """
        from app.models.youtube_models import YoutubeVideoDownloadAndUploadResponse
        from app.services.storage_service import storage_service
        from datetime import datetime
        import tempfile
        import os
        import subprocess
        import json

        # 获取信号量状态信息
        semaphore_available = _download_semaphore._value
        try:
            # 安全地获取等待队列长度
            if hasattr(_download_semaphore, '_waiters') and _download_semaphore._waiters is not None:
                semaphore_waiters = len(_download_semaphore._waiters)
            else:
                semaphore_waiters = 0
        except (AttributeError, TypeError):
            semaphore_waiters = 0
        
        logger.info(f"YouTube视频下载请求 - URL: {request.url}, "
                   f"并发控制状态: 可用槽位={semaphore_available}, 等待队列={semaphore_waiters}")
        
        # 使用信号量控制并发
        async with _download_semaphore:
            current_concurrent = _max_concurrent_downloads - _download_semaphore._value
            logger.info(f"🚀 获得下载槽位 - URL: {request.url}, "
                       f"当前并发数: {current_concurrent}/{_max_concurrent_downloads}, "
                       f"剩余槽位: {_download_semaphore._value}")
            
            # 使用重试机制执行下载和上传
            async def download_and_upload_with_retry():
                return await self._download_and_upload_internal(request)
            
            try:
                # 从配置读取重试参数
                max_retries = _settings.youtube.download.max_retries
                base_delay = float(_settings.youtube.download.retry_delay)
                
                result = await retry_with_exponential_backoff(
                    download_and_upload_with_retry,
                    max_retries=max_retries,
                    base_delay=base_delay,
                    max_delay=60.0
                )
                
                logger.info(f"YouTube视频下载并上传成功 - URL: {request.url}, "
                           f"视频URL: {result.video_url}")
                return result
                
            except Exception as e:
                error_msg = f"YouTube视频下载并上传失败（所有重试均失败）: {str(e)}"
                logger.error(error_msg, exc_info=True)
                return YoutubeVideoDownloadAndUploadResponse(
                    success=False,
                    message=error_msg,
                    error=error_msg,
                    original_youtube_url=request.url
                )
            finally:
                logger.info(f"🔓 释放下载槽位 - URL: {request.url}, "
                           f"释放后可用槽位: {_download_semaphore._value + 1}")

    async def _download_and_upload_internal(self, request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
        """
        内部下载和上传实现（用于重试机制）
        
        Args:
            request: 下载并上传请求参数
            
        Returns:
            YoutubeVideoDownloadAndUploadResponse: 操作结果
        """
        from app.models.youtube_models import YoutubeVideoDownloadAndUploadResponse
        from app.services.storage_service import storage_service
        from datetime import datetime
        import tempfile
        import os
        import subprocess
        import json

        start_time = time.time()
        logger.info(f"开始内部下载流程 - URL: {request.url}")
        
        try:
            # 第一步：下载YouTube视频
            download_request = YoutubeVideoDownloadRequest(
                url=request.url,
                video_quality=request.video_quality,
                audio_quality=request.audio_quality,
                format_type=request.format_type
            )
            
            step_start = time.time()
            logger.info(f"步骤1: 开始下载YouTube视频 - URL: {request.url}")
            download_result = await self.download_video_async(download_request)
            step_duration = time.time() - step_start
            logger.info(f"步骤1: 视频下载完成，耗时: {step_duration:.2f}秒")
            
            if not download_result.success:
                error_msg = f"YouTube视频下载失败: {download_result.error}"
                logger.error(error_msg)
                raise Exception(error_msg)
            
            if not download_result.file_path or not os.path.exists(download_result.file_path):
                error_msg = "下载的视频文件不存在或路径无效"
                logger.error(error_msg)
                raise Exception(error_msg)
            
            logger.info(f"YouTube视频下载成功: {download_result.file_path}, "
                       f"文件大小: {download_result.file_size} bytes")
            
            # 第二步：获取视频元数据
            step_start = time.time()
            logger.info(f"步骤2: 开始获取视频元数据 - URL: {request.url}")
            duration = None
            width = None
            height = None
            video_metadata = {
                "original_youtube_url": request.url,
                "download_time": datetime.now().isoformat(),
                "file_size": download_result.file_size
            }
            
            try:
                # 使用ffprobe获取视频信息
                cmd = [
                    'ffprobe', '-v', 'quiet', '-print_format', 'json',
                    '-show_format', '-show_streams', download_result.file_path
                ]
                
                # 明确指定UTF-8编码，避免Windows系统上的GBK编码问题
                result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
                
                if result.returncode == 0:
                    probe_data = json.loads(result.stdout)
                    
                    # 查找视频流
                    for stream in probe_data.get('streams', []):
                        if stream.get('codec_type') == 'video':
                            width = stream.get('width')
                            height = stream.get('height')
                            break
                    
                    # 获取时长
                    format_data = probe_data.get('format', {})
                    duration_str = format_data.get('duration')
                    if duration_str:
                        duration = float(duration_str)
                    
                    video_metadata.update({
                        "width": width,
                        "height": height,
                        "duration": duration,
                        "ffprobe_success": True
                    })
                    
                    logger.info(f"成功获取视频元数据 - 时长: {duration}s, "
                               f"分辨率: {width}x{height}")
                else:
                    logger.warning(f"无法获取视频元数据 - ffprobe错误: {result.stderr}")
                    video_metadata["ffprobe_success"] = False
                    
            except Exception as probe_error:
                logger.warning(f"获取视频元数据时出错: {str(probe_error)}")
                video_metadata["ffprobe_error"] = str(probe_error)
            
            step_duration = time.time() - step_start
            logger.info(f"步骤2: 视频元数据获取完成，耗时: {step_duration:.2f}秒")
            
            # 第三步：上传视频到存储服务
            step_start = time.time()
            logger.info(f"步骤3: 开始上传视频到存储服务 - URL: {request.url}")

            # 构建自定义文件名
            custom_filename = request.custom_filename
            if not custom_filename:
                base_name = os.path.splitext(os.path.basename(download_result.file_path))[0]
                sanitized_name = self.sanitize_filename(base_name)
                custom_filename = f"youtube_{sanitized_name}.{request.format_type}"

            with open(download_result.file_path, "rb") as f:
                file_data = f.read()

            upload_result = await storage_service.upload_file(
                file_data=file_data,
                filename=custom_filename,
                content_type="video/mp4",
                folder="video",
                user_id="anonymous",
                task_id=request.task_id,
            )

            if not upload_result.get("success", False):
                error_msg = upload_result.get("message", "未知错误")
                logger.error(f"存储服务上传失败: {error_msg}")
                raise Exception(f"视频上传到存储服务失败: {error_msg}")

            video_url = upload_result.get("file_url", "")
            step_duration = time.time() - step_start
            logger.info(f"步骤3: 视频成功上传到存储服务，耗时: {step_duration:.2f}秒, URL: {video_url}")
            
            # 第四步：生成缩略图（如果需要且有时长信息）
            thumbnail_url = None
            thumbnail_path = None
            
            if request.generate_thumbnail and duration is not None:
                step_start = time.time()
                logger.info(f"步骤4: 开始生成并上传缩略图 - URL: {request.url}")
                try:
                    # 生成缩略图
                    thumbnail_filename = f"thumb_{os.path.splitext(custom_filename)[0]}.jpg"
                    thumbnail_bucket_path = bucket_path.replace(custom_filename, thumbnail_filename)
                    
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as thumb_file:
                        thumbnail_path = thumb_file.name
                    
                    # 使用ffmpeg生成缩略图（在视频中间位置）
                    thumbnail_time = duration / 2 if duration > 2 else 1
                    
                    cmd = [
                        'ffmpeg', '-i', download_result.file_path, '-ss', str(thumbnail_time),
                        '-vframes', '1', '-q:v', '2', '-y', thumbnail_path
                    ]
                    
                    result = subprocess.run(cmd, capture_output=True, timeout=30)
                    
                    if result.returncode == 0 and os.path.exists(thumbnail_path):
                        # 上传缩略图到存储服务
                        with open(thumbnail_path, "rb") as f:
                            thumb_data = f.read()

                        thumb_result = await storage_service.upload_file(
                            file_data=thumb_data,
                            filename=thumbnail_filename,
                            content_type="image/jpeg",
                            folder="video",
                            user_id="anonymous",
                            task_id=request.task_id,
                        )

                        if thumb_result.get("success", False):
                            thumbnail_url = thumb_result.get("file_url", "")
                            step_duration = time.time() - step_start
                            logger.info(f"步骤4: 缩略图生成并上传成功，耗时: {step_duration:.2f}秒, URL: {thumbnail_url}")
                        else:
                            logger.warning(f"缩略图上传失败: {thumb_result.get('message', '未知错误')}")
                    else:
                        ffmpeg_error = result.stderr.decode() if result.stderr else "Unknown error"
                        logger.warning(f"缩略图生成失败: {ffmpeg_error}")
                        
                except Exception as thumb_error:
                    logger.warning(f"生成缩略图时出错: {str(thumb_error)}")
                    
            else:
                logger.info("跳过缩略图生成（未启用或无时长信息）")
            
            # 清理临时文件
            try:
                if os.path.exists(download_result.file_path):
                    os.remove(download_result.file_path)
                    logger.info(f"已清理临时下载文件: {download_result.file_path}")
                
                if thumbnail_path and os.path.exists(thumbnail_path):
                    os.remove(thumbnail_path)
                    logger.info(f"已清理临时缩略图文件: {thumbnail_path}")
                    
            except Exception as cleanup_error:
                logger.warning(f"清理临时文件失败: {cleanup_error}")
            
            # 记录总体完成情况
            total_duration = time.time() - start_time
            logger.info(f"YouTube视频下载并上传完成 - 总耗时: {total_duration:.2f}秒, "
                       f"文件大小: {download_result.file_size} bytes, "
                       f"分辨率: {width}x{height}, 时长: {duration}s")
            
            return YoutubeVideoDownloadAndUploadResponse(
                success=True,
                message="YouTube视频下载并上传成功",
                video_url=video_url,
                thumbnail_url=thumbnail_url,
                file_size=download_result.file_size,
                duration=duration,
                width=width,
                height=height,
                original_youtube_url=request.url
            )
            
        except Exception as e:
            total_duration = time.time() - start_time
            error_msg = f"内部下载流程失败（耗时: {total_duration:.2f}秒）: {str(e)}"
            logger.error(error_msg, exc_info=True)
            # 重新抛出异常以便重试机制处理
            raise Exception(error_msg)


# 创建全局YouTube服务实例
youtube_service = YouTubeService() 