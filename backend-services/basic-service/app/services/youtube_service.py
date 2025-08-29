#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import time
import re
import unicodedata
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, List
import yt_dlp
from app.logger import get_logger
from app.models.youtube_models import (
    YoutubeSearchRequest, YoutubeSearchResponse, YoutubeVideoInfo,
    YoutubeVideoDownloadRequest, YoutubeVideoDownloadResponse,
    YoutubeVideoInfoRequest, YoutubeVideoInfoResponse,
    YoutubeVideoDownloadAndUploadRequest, YoutubeVideoDownloadAndUploadResponse
)

logger = get_logger(__name__)


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
                search_limit = min(request.max_videos * 3, 50)  # 搜索3倍数量，但不超过50
                
            search_url = f"ytsearch{search_limit}:{request.query}"
            
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
            ydl_opts = {'quiet': True}
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

            # 构建格式选择器
            if request.video_quality == "best":
                format_selector = f"best[ext={request.format_type}]/best"
            elif request.video_quality == "worst":
                format_selector = f"worst[ext={request.format_type}]/worst"
            else:
                # 具体质量要求，如 720p, 1080p
                height = request.video_quality.replace('p', '')
                format_selector = f"best[height<={height}][ext={request.format_type}]/best[height<={height}]/best"

            # yt-dlp 配置
            ydl_opts = {
                'format': format_selector,
                'outtmpl': outtmpl,
                'retries': 3,
                'fragment_retries': 3,
                'writesubtitles': request.subtitle,
                'writeautomaticsub': request.subtitle,
                'progress_hooks': [self.progress_hook],
                'no_warnings': False,
                'ignoreerrors': False,
            }

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

            # 执行下载
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([request.url])
                
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

        except Exception as e:
            error_msg = f"视频下载失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeVideoDownloadResponse(
                success=False,
                message="视频下载失败",
                error=error_msg
            )

    async def download_and_upload_video(self, request: YoutubeVideoDownloadAndUploadRequest) -> YoutubeVideoDownloadAndUploadResponse:
        """
        下载YouTube视频并上传到Supabase
        
        Args:
            request: 下载并上传请求参数
            
        Returns:
            YoutubeVideoDownloadAndUploadResponse: 操作结果
        """
        from app.models.youtube_models import YoutubeVideoDownloadAndUploadResponse
        from app.services.supabase_service import supabase_service
        from datetime import datetime
        import tempfile
        import os
        import subprocess
        import json
        
        logger.info(f"开始下载并上传YouTube视频 - URL: {request.url}")
        
        try:
            # 第一步：下载YouTube视频
            download_request = YoutubeVideoDownloadRequest(
                url=request.url,
                video_quality=request.video_quality,
                audio_quality=request.audio_quality,
                format_type=request.format_type
            )
            
            logger.info("步骤1: 下载YouTube视频")
            download_result = self.download_video(download_request)
            
            if not download_result.success:
                logger.error(f"YouTube视频下载失败: {download_result.error}")
                return YoutubeVideoDownloadAndUploadResponse(
                    success=False,
                    message="YouTube视频下载失败",
                    error=download_result.error,
                    original_youtube_url=request.url
                )
            
            if not download_result.file_path or not os.path.exists(download_result.file_path):
                logger.error("下载的视频文件不存在")
                return YoutubeVideoDownloadAndUploadResponse(
                    success=False,
                    message="下载的视频文件不存在",
                    error="文件路径无效",
                    original_youtube_url=request.url
                )
            
            logger.info(f"YouTube视频下载成功: {download_result.file_path}")
            
            # 第二步：获取视频元数据
            logger.info("步骤2: 获取视频元数据")
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
                    
                    logger.info("成功获取视频元数据", {
                        "youtube_url": request.url,
                        "duration": duration,
                        "width": width,
                        "height": height
                    })
                else:
                    logger.warning("无法获取视频元数据", {
                        "youtube_url": request.url,
                        "ffprobe_error": result.stderr
                    })
                    video_metadata["ffprobe_success"] = False
                    
            except Exception as probe_error:
                logger.warning("获取视频元数据时出错", {
                    "youtube_url": request.url,
                    "error": str(probe_error)
                })
                video_metadata["ffprobe_error"] = str(probe_error)
            
            # 第三步：上传视频到Supabase
            logger.info("步骤3: 上传视频到Supabase")
            
            # 构建自定义文件名
            custom_filename = request.custom_filename
            if not custom_filename:
                # 从下载的文件路径中提取文件名并清理
                base_name = os.path.splitext(os.path.basename(download_result.file_path))[0]
                # 清理文件名，移除特殊字符和emoji
                sanitized_name = self.sanitize_filename(base_name)
                custom_filename = f"youtube_{sanitized_name}.{request.format_type}"
            
            # 构建bucket路径
            now = datetime.now()
            date_path = now.strftime("%Y/%m/%d")
            if request.task_id:
                bucket_path = f"video/youtube/{date_path}/task-{request.task_id}/{custom_filename}"
            else:
                bucket_path = f"video/youtube/{date_path}/{custom_filename}"
            
            upload_result = supabase_service.upload_file(
                local_file_path=download_result.file_path,
                bucket_path=bucket_path,
                content_type="video/mp4"
            )
            
            if not upload_result.get("success", False):
                error_msg = upload_result.get("message", "未知错误")
                logger.error(f"Supabase上传失败: {error_msg}")
                return YoutubeVideoDownloadAndUploadResponse(
                    success=False,
                    message="视频上传到Supabase失败",
                    error=error_msg,
                    original_youtube_url=request.url
                )
            
            video_url = upload_result.get("file_url", "")
            logger.info(f"视频成功上传到Supabase: {video_url}")
            
            # 第四步：生成缩略图（如果需要且有时长信息）
            thumbnail_url = None
            thumbnail_path = None
            
            if request.generate_thumbnail and duration is not None:
                logger.info("步骤4: 生成并上传缩略图")
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
                        # 上传缩略图到Supabase
                        thumb_result = supabase_service.upload_file(
                            local_file_path=thumbnail_path,
                            bucket_path=thumbnail_bucket_path,
                            content_type="image/jpeg"
                        )
                        
                        if thumb_result.get("success", False):
                            thumbnail_url = thumb_result.get("file_url", "")
                            logger.info("缩略图生成并上传成功", {
                                "thumbnail_url": thumbnail_url,
                                "youtube_url": request.url
                            })
                        else:
                            logger.warning("缩略图上传失败", {
                                "error": thumb_result.get("message", "未知错误"),
                                "youtube_url": request.url
                            })
                    else:
                        logger.warning("缩略图生成失败", {
                            "youtube_url": request.url,
                            "ffmpeg_error": result.stderr.decode() if result.stderr else "Unknown error"
                        })
                        
                except Exception as thumb_error:
                    logger.warning("生成缩略图时出错", {
                        "youtube_url": request.url,
                        "error": str(thumb_error)
                    })
            
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
            
            # 返回成功结果，包含完整的视频信息
            logger.info("YouTube视频下载并上传完成", {
                "youtube_url": request.url,
                "video_url": video_url,
                "thumbnail_url": thumbnail_url,
                "file_size": download_result.file_size,
                "duration": duration,
                "width": width,
                "height": height
            })
            
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
            error_msg = f"下载并上传过程中发生错误: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return YoutubeVideoDownloadAndUploadResponse(
                success=False,
                message="下载并上传过程中发生错误",
                error=error_msg,
                original_youtube_url=request.url
            )


# 创建全局YouTube服务实例
youtube_service = YouTubeService() 